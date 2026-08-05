import assert from "node:assert/strict";
import test from "node:test";
import { applyMigrations, createMigration, type SqlClient } from "../src/database/migrator.js";

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
