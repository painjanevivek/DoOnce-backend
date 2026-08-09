import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { StepResult } from "../src/contracts/protocol.js";
import { PostgresRunStore } from "../src/runner/postgres-run-store.js";

const user: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "runner@example.test", role: "runner" };
const runId = "33333333-3333-4333-8333-333333333333";
const stepResults: StepResult[] = [
  { schemaVersion: 1, stepId: "44444444-4444-4444-8444-444444444444", status: "verified", startedAt: "2026-08-09T00:00:00.000Z", finishedAt: "2026-08-09T00:00:01.000Z" },
  { schemaVersion: 1, stepId: "55555555-5555-4555-8555-555555555555", status: "failed", reasonCode: "assertion.failed", startedAt: "2026-08-09T00:00:01.000Z", finishedAt: "2026-08-09T00:00:02.000Z" },
];

test("persists checkpoint step results in one bounded bulk upsert", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const runRow = { id: runId, workflow_id: "66666666-6666-4666-8666-666666666666", workflow_version: 2, workflow_checksum: "a".repeat(64), mode: "test", status: "running", executor: "extension", requested_at: "2026-08-09T00:00:00.000Z", started_at: "2026-08-09T00:00:00.000Z", finished_at: null, cancel_requested: false, current_step_index: 2, step_results: stepResults, extension_version: "0.4.0", lease_expires_at: "2026-08-09T00:01:00.000Z", result: null, request_digest: "b".repeat(64), checkpoint: null };
  const store = new PostgresRunStore(poolWithQuery(async (sql, values) => {
    queries.push({ sql, values });
    return sql.startsWith("UPDATE workflow_runs SET current_step_index") ? { rows: [runRow] } : { rows: [] };
  }));

  const run = await store.checkpoint(user, runId, "c".repeat(64), { currentStepIndex: 2, stepResults, variables: {} }, "2026-08-09T00:01:00.000Z");

  assert.equal(run?.currentStepIndex, 2);
  const upserts = queries.filter(({ sql }) => sql.includes("jsonb_to_recordset"));
  assert.equal(upserts.length, 1);
  assert.ok(upserts[0]?.sql.includes("ON CONFLICT (run_id, step_id)"));
  const rows = JSON.parse(String(upserts[0]?.values?.[2])) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.sequence), [0, 1]);
  assert.ok(queries.some(({ sql, values }) => sql.includes("set_config('app.tenant_id'") && values?.[0] === user.tenantId));
});

function poolWithQuery(query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>): Pool {
  return { connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
}
