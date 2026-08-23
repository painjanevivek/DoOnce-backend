import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { PostgresBetaStore } from "../src/beta/postgres-beta-store.js";

const user: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };

test("enrolls only an active workflow whose definition matches the attended wedge", async () => {
  const queries: string[] = [];
  const pool = { connect: async () => ({
    query: async (sql: string) => { queries.push(sql); return { rows: [] }; },
    release() {},
  }) } as unknown as Pool;
  const store = new PostgresBetaStore(pool);

  const enrolled = await store.enroll(user, {
    id: "33333333-3333-4333-8333-333333333333",
    workflowId: "44444444-4444-4444-8444-444444444444",
    taskCategory: "report-download",
    baselineDurationSeconds: 600,
    baselineErrorRatePercent: 2,
  });

  assert.equal(enrolled, undefined);
  const insert = queries.find((sql) => sql.startsWith("INSERT INTO beta_workflow_enrollments"));
  assert.match(insert ?? "", /active_version\.status = 'active'/);
  assert.match(insert ?? "", /jsonb_array_length\(active_version\.definition->'allowedDomains'\) = 1/);
  assert.match(insert ?? "", /step->>'action' = 'download'/);
  assert.match(insert ?? "", /successCriteria/);
});
