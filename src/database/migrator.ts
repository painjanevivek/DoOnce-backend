import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export interface Migration {
  id: string;
  sql: string;
  checksum: string;
}

export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

export async function readMigrations(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && /^\d{3}_[a-z0-9-]+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(names.map(async (id) => createMigration(id, await readFile(path.join(directory, id), "utf8"))));
}

export async function applyMigrations(client: SqlClient, migrations: readonly Migration[]): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = await client.query<{ id: string; checksum: string }>("SELECT id, checksum FROM schema_migrations");
  const appliedChecksums = new Map(applied.rows.map((migration) => [migration.id, migration.checksum]));
  const pending = migrations.filter((migration) => {
    const appliedChecksum = appliedChecksums.get(migration.id);
    if (appliedChecksum && appliedChecksum !== migration.checksum) {
      throw new Error(`Migration ${migration.id} was changed after it was applied.`);
    }
    return !appliedChecksum;
  });

  if (pending.length === 0) return;

  await client.query("BEGIN");
  try {
    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)", [migration.id, migration.checksum]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function createMigration(id: string, sql: string): Migration {
  return {
    id,
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  };
}
