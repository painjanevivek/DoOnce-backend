import assert from "node:assert/strict";
import test from "node:test";
import { withTenantTransaction } from "../src/database/tenant-context.js";
import type { SqlClient } from "../src/database/migrator.js";

class FakeSqlClient implements SqlClient {
  public readonly calls: Array<{ sql: string; values?: readonly unknown[] }> = [];

  public async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
    this.calls.push({ sql, ...(values ? { values } : {}) });
    return { rows: [] };
  }
}

test("sets tenant and user context inside one transaction", async () => {
  const client = new FakeSqlClient();
  const result = await withTenantTransaction(client, {
    tenantId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
  }, async () => "done");

  assert.equal(result, "done");
  assert.deepEqual(client.calls.map((call) => call.sql), [
    "BEGIN",
    "SELECT set_config('app.tenant_id', $1, true)",
    "SELECT set_config('app.user_id', $1, true)",
    "COMMIT",
  ]);
  assert.deepEqual(client.calls[1]?.values, ["11111111-1111-4111-8111-111111111111"]);
});

test("rolls back tenant context when scoped work fails", async () => {
  const client = new FakeSqlClient();
  await assert.rejects(() => withTenantTransaction(client, {
    tenantId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
  }, async () => { throw new Error("boom"); }));
  assert.equal(client.calls.at(-1)?.sql, "ROLLBACK");
});
