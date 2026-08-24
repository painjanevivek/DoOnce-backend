import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { applyMigrations, createMigration, migrationSetSha256, readMigrations, type SqlClient } from "../src/database/migrator.js";
import { assertAppliedMigrationSet } from "../src/database/migration-readiness.js";

class FakeSqlClient implements SqlClient {
  readonly calls: { sql: string; values?: readonly unknown[] }[] = [];
  appliedRows: { id: string; checksum: string }[] = [];
  failOn?: string;

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }> {
    this.calls.push({ sql, ...(values === undefined ? {} : { values }) });
    if (this.failOn && sql.includes(this.failOn)) throw new Error("migration failed");
    if (sql === "SELECT id, checksum FROM schema_migrations") return { rows: this.appliedRows as T[] };
    if (sql.startsWith("INSERT INTO schema_migrations") && values) {
      this.appliedRows.push({ id: values[0] as string, checksum: values[1] as string });
    }
    return { rows: [] };
  }
}

test("applies pending migrations in a single transaction", async () => {
  const client = new FakeSqlClient();
  const migrations = [createMigration("001_first.sql", "SELECT 1"), createMigration("002_second.sql", "SELECT 2")];

  await applyMigrations(client, migrations);

  assert.deepEqual(client.appliedRows.map((row) => row.id), ["001_first.sql", "002_second.sql"]);
  assert.equal(client.calls.some((call) => call.sql === "BEGIN"), true);
  assert.equal(client.calls.some((call) => call.sql === "COMMIT"), true);
});

test("refuses a migration whose applied checksum changed", async () => {
  const migration = createMigration("001_first.sql", "SELECT 1");
  const client = new FakeSqlClient();
  client.appliedRows = [{ id: migration.id, checksum: "different" }];

  await assert.rejects(() => applyMigrations(client, [migration]), /was changed after it was applied/);
});

test("rolls back all pending migrations when one fails", async () => {
  const client = new FakeSqlClient();
  client.failOn = "SELECT 2";

  await assert.rejects(() => applyMigrations(client, [
    createMigration("001_first.sql", "SELECT 1"),
    createMigration("002_second.sql", "SELECT 2"),
  ]), /migration failed/);

  assert.equal(client.calls.some((call) => call.sql === "ROLLBACK"), true);
  assert.equal(client.calls.some((call) => call.sql === "COMMIT"), false);
});

test("discovers both hyphenated and underscored migration names", async () => {
  const migrations = await readMigrations(path.join(process.cwd(), "database", "migrations"));
  assert.equal(migrations.length, 26);
  assert.ok(migrations.some(({ id }) => id === "024_attended_run_authorization.sql"));
  assert.ok(migrations.some(({ id }) => id === "025_run_release_identity.sql"));
  assert.ok(migrations.some(({ id }) => id === "026_capture_runtime_grants.sql"));
});

test("computes a platform-stable migration-set checksum and verifies the applied set", async () => {
  const first = createMigration("001_first.sql", "SELECT 1\r\n");
  const second = createMigration("002_second.sql", "SELECT 2\n");
  assert.equal(first.checksum, createMigration(first.id, "SELECT 1\n").checksum);
  const expected = migrationSetSha256([first, second]);
  const client = {
    query: async () => ({ rows: [{ id: second.id, checksum: second.checksum }, { id: first.id, checksum: first.checksum }] }),
  } satisfies SqlClient;
  await assertAppliedMigrationSet(client, expected);
  await assert.rejects(() => assertAppliedMigrationSet(client, "0".repeat(64)), /does not match/);
});
