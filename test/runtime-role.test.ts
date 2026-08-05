import assert from "node:assert/strict";
import test from "node:test";
import { assertRuntimeDatabaseRole } from "../src/database/runtime-role.js";

test("accepts a non-superuser role that cannot bypass row-level security", async () => {
  await assert.doesNotReject(() => assertRuntimeDatabaseRole({
    query: async () => ({ rows: [{ is_superuser: false, bypasses_rls: false }] }),
  }));
});

test("rejects a database role that can bypass tenant row-level security", async () => {
  await assert.rejects(
    () => assertRuntimeDatabaseRole({ query: async () => ({ rows: [{ is_superuser: false, bypasses_rls: true }] }) }),
    /non-superuser role without BYPASSRLS/,
  );
});
