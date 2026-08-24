import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { PostgresCaptureStore } from "../src/capture/postgres-capture-store.js";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { PostgresRunStore } from "../src/runner/postgres-run-store.js";
import { RunApprovalRejectedError, RunService } from "../src/runner/run-service.js";
import { mvpPolicyFromEnvironment } from "../src/system/mvp-policy.js";

const adminUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

test("persists consent under RLS and consumes one bound approval atomically", { skip: !adminUrl || !appUrl }, async () => {
  const admin = new Pool({ connectionString: adminUrl });
  const runtime = new Pool({ connectionString: appUrl });
  const tenantId = randomUUID();
  const userId = randomUUID();
  const workflowId = randomUUID();
  const stepId = randomUUID();
  const assertionId = randomUUID();
  const origin = "https://reports.example.test";
  const spec: WorkflowSpec = {
    schemaVersion: 1,
    format: "doonce.workflow-spec.v1",
    title: "Download approved report",
    allowedDomains: ["reports.example.test"],
    inputs: [],
    steps: [{ id: stepId, action: "download", name: "Download report", expectedOutcome: "The report downloads.", target: { domain: "reports.example.test", path: "/reports", locator: { schemaVersion: 1, primary: { strategy: "capture-id", value: "download-report", confidence: 1 }, fallbacks: [] } } }],
    successCriteria: [{ id: assertionId, name: "Report exists", kind: "file-downloaded", fileNamePattern: "report-*.csv", minBytes: 1, maxBytes: 10_000_000 }],
  };
  const user: AuthenticatedUser = { tenantId, userId, email: `runner-${userId}@example.test`, role: "runner" };
  const releaseIdentity = {
    schemaVersion: 1 as const, deploymentId: "mvp-postgres-proof", environment: "integration", backendCommit: "a".repeat(40), frontendCommit: "b".repeat(40), backendImageDigest: `sha256:${"c".repeat(64)}`, frontendImageDigest: `sha256:${"d".repeat(64)}`, extensionId: "a".repeat(32), extensionVersion: "0.4.0", extensionPackageSha256: "e".repeat(64), protocolSchemaSha256: "f".repeat(64), migrationSetSha256: "1".repeat(64),
  };

  try {
    await admin.query("INSERT INTO tenants (id, name) VALUES ($1, 'Phase 2 integration')", [tenantId]);
    await admin.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'not-a-real-password')", [userId, user.email]);
    await admin.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'runner')", [tenantId, userId]);
    await admin.query("INSERT INTO workflows (id, tenant_id, owner_id, title, active_version) VALUES ($1, $2, $3, $4, 1)", [workflowId, tenantId, userId, spec.title]);
    await admin.query("INSERT INTO workflow_versions (workflow_id, version, tenant_id, status, definition, created_by, published_at, schema_version, source) VALUES ($1, 1, $2, 'active', $3::jsonb, $4, now(), 1, 'workflow-spec-v1')", [workflowId, tenantId, JSON.stringify(spec), userId]);

    const captures = new PostgresCaptureStore(runtime);
    await captures.grantOriginConsent(user, origin);
    const consent = await admin.query<{ revoked_at: Date | null }>("SELECT revoked_at FROM capture_origin_consents WHERE tenant_id = $1 AND user_id = $2 AND origin = $3", [tenantId, userId, origin]);
    assert.equal(consent.rows.length, 1);
    assert.equal(consent.rows[0]?.revoked_at, null);

    const policy = mvpPolicyFromEnvironment({ DOONCE_MVP_MODE: "true", DOONCE_PILOT_ALLOWED_ORIGIN: origin });
    const runs = new RunService(new PostgresRunStore(runtime), 45_000, undefined, undefined, policy, { workflowChangesEnabled: true, killSwitchActive: false }, releaseIdentity);
    const approval = await runs.approve(user, { workflowId, inputs: {}, extensionVersion: "0.4.0" });
    const attempts = await Promise.allSettled([
      runs.create(user, { workflowId, inputs: {}, idempotencyKey: `race:${randomUUID()}`, approvalToken: approval.approvalToken }),
      runs.create(user, { workflowId, inputs: {}, idempotencyKey: `race:${randomUUID()}`, approvalToken: approval.approvalToken }),
    ]);
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);
    const rejected = attempts.find(({ status }) => status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof RunApprovalRejectedError);

    const approvalRow = await admin.query<{ consumed_at: Date | null; run_id: string | null; extension_version: string }>("SELECT consumed_at, run_id, extension_version FROM run_approval_challenges WHERE tenant_id = $1", [tenantId]);
    assert.ok(approvalRow.rows[0]?.consumed_at);
    assert.ok(approvalRow.rows[0]?.run_id);
    assert.equal(approvalRow.rows[0]?.extension_version, "0.4.0");
    const runRow = await admin.query<{ release_identity: typeof releaseIdentity }>("SELECT release_identity FROM workflow_runs WHERE id = $1", [approvalRow.rows[0]!.run_id]);
    assert.deepEqual(runRow.rows[0]?.release_identity, releaseIdentity);
  } finally {
    await admin.query("DELETE FROM tenants WHERE id = $1", [tenantId]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => undefined);
    await Promise.all([runtime.end(), admin.end()]);
  }
});
