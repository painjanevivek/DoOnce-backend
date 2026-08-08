import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { PostgresCanonicalWorkflowStore } from "../src/workflow/postgres-canonical-workflow-store.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

const user = {
  tenantId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  userId: "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  role: "owner",
} as AuthenticatedUser;
const workflowId = "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
const spec = validProtocolFixtures.WorkflowSpec as WorkflowSpec;

test("stores a canonical draft with schema provenance inside tenant context", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresCanonicalWorkflowStore(poolWithQuery(async (sql, values) => {
    queries.push({ sql, values });
    return sql.startsWith("INSERT INTO workflow_versions") ? { rows: [{ definition_checksum: "a".repeat(64) }] } : { rows: [] };
  }));

  const draft = await store.createDraft(user, workflowId, spec);

  assert.equal(draft.checksum, "a".repeat(64));
  const versionInsert = queries.find(({ sql }) => sql.startsWith("INSERT INTO workflow_versions"));
  assert.ok(versionInsert?.sql.includes("schema_version, source"));
  assert.ok(versionInsert?.sql.includes("'workflow-spec-v1'"));
  assert.deepEqual(JSON.parse(String(versionInsert?.values?.[2])), spec);
  assert.ok(queries.some(({ sql, values }) => sql.includes("set_config('app.tenant_id'") && values?.[0] === user.tenantId));
});

test("loads only the latest schema-v1 draft through tenant context", async () => {
  const queries: string[] = [];
  const store = new PostgresCanonicalWorkflowStore(poolWithQuery(async (sql) => {
    queries.push(sql);
    return sql.startsWith("SELECT version") ? { rows: [{ version: 3, definition: spec, definition_checksum: "b".repeat(64) }] } : { rows: [] };
  }));

  const draft = await store.findDraft(user, workflowId);

  assert.equal(draft?.version, 3);
  const select = queries.find((sql) => sql.startsWith("SELECT version"));
  assert.ok(select?.includes("schema_version = 1"));
  assert.ok(select?.includes("status = 'draft'"));
  assert.ok(select?.includes("ORDER BY version DESC LIMIT 1"));
});

function poolWithQuery(query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>): Pool {
  return { connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
}
