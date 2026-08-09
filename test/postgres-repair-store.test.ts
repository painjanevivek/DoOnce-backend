import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { PostgresRepairStore } from "../src/repair/postgres-repair-store.js";
import type { RepairProposalRecord } from "../src/repair/repair-service.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

const user: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };
const workflow = validProtocolFixtures.WorkflowSpec as WorkflowSpec;
const proposal = proposalRow();

test("accepts an active-version repair only by inserting a separate draft", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresRepairStore(poolWithQuery(async (sql, values) => {
    queries.push({ sql, values });
    if (sql === "SELECT * FROM repair_proposals WHERE id = $1 FOR UPDATE") return { rows: [proposal] };
    if (sql.startsWith("SELECT status, definition_checksum")) return { rows: [{ status: "active", definition_checksum: "a".repeat(64) }] };
    if (sql.startsWith("SELECT version FROM workflow_versions")) return { rows: [] };
    if (sql.startsWith("SELECT COALESCE(max(version)")) return { rows: [{ version: 2 }] };
    if (sql.startsWith("SELECT proposals.*")) return { rows: [{ ...proposal, status: "accepted", accepted_draft_version: 2, effectiveness: "unmeasured" }] };
    return { rows: [] };
  }));
  const result = await store.accept(user, proposal.id, workflow);
  assert.equal(result.status, "accepted");
  assert.ok(queries.some(({ sql }) => sql.startsWith("INSERT INTO workflow_versions") && sql.includes("'draft'")));
  assert.equal(queries.some(({ sql }) => sql.startsWith("UPDATE workflow_versions SET definition")), false);
  assert.ok(queries.some(({ sql, values }) => sql.startsWith("INSERT INTO workflow_audit_events") && values?.includes("workflow.repair_accepted")));
  assert.ok(queries.some(({ sql, values }) => sql.includes("set_config('app.tenant_id'") && values?.[0] === user.tenantId));
});

function proposalRow(): RepairProposalRecord & Record<string, unknown> { const oldStep = workflow.steps[0]!; const proposedStep = structuredClone(oldStep); if ("target" in proposedStep && "locator" in proposedStep.target) proposedStep.target.locator.primary = { strategy: "text", value: "Export report", confidence: .82 }; return { id: "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", workflowId: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", runId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", baseVersion: 1, baseChecksum: "a".repeat(64), status: "pending", failureCategory: "locator-not-found", causeSummary: "The locator changed.", failedStepId: oldStep.id, oldStep, proposedStep, changedFields: [`steps.${oldStep.id}.target.locator`], evidence: { reasonCode: "locator.missing", candidateCount: 1, screenshotArtifactIds: [], precedingStepIds: [] }, confidence: .82, requiredTestPlan: ["Test the draft."], provider: "deterministic", model: "semantic-locator-v1", createdAt: "2026-08-09T00:00:00.000Z", effectiveness: "unmeasured", workflow_id: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", run_id: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", base_version: 1, base_checksum: "a".repeat(64), failure_category: "locator-not-found", cause_summary: "The locator changed.", failed_step_id: oldStep.id, old_step: oldStep, proposed_step: proposedStep, changed_fields: [`steps.${oldStep.id}.target.locator`], required_test_plan: ["Test the draft."], accepted_draft_version: null, rejected_reason: null, created_at: "2026-08-09T00:00:00.000Z" }; }
function poolWithQuery(query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>): Pool { return { connect: async () => ({ query, release: () => undefined }) } as unknown as Pool; }
