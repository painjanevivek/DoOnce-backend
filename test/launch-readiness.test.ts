import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLaunchReadiness, type LaunchReadinessManifest } from "../src/release/launch-readiness.js";

const automated = ["source-verification", "security-diff", "dependency-container-scan", "migration-rehearsal", "restore-drill", "rollback-rehearsal", "extension-release-candidate"] as const;
const external = ["extension-publisher-approval", "infrastructure-provider-selection", "legal-policy-approval", "support-incident-ownership", "pricing-package-evidence"] as const;

function manifest(status: "passed" | "pending" = "passed"): LaunchReadinessManifest {
  return {
    schemaVersion: 1,
    releaseId: "beta-2026-08-24",
    backendCommit: "a".repeat(40),
    frontendCommit: "b".repeat(40),
    gates: [
      ...automated.map((id) => ({ id, type: "automated" as const, status, evidenceReference: "release/evidence/automated.json", recordedAt: "2026-08-24T12:00:00.000Z" })),
      ...external.map((id) => ({ id, type: "external" as const, status, owner: "Accountable Owner", evidenceReference: "release/evidence/external.json", recordedAt: "2026-08-24T12:00:00.000Z" })),
    ],
  };
}

test("passes only when every automated and external gate has dated evidence", () => {
  assert.deepEqual(evaluateLaunchReadiness(manifest()), { ready: true, blockers: [] });
});

test("keeps a release blocked while real approvals are pending", () => {
  const result = evaluateLaunchReadiness(manifest("pending"));
  assert.equal(result.ready, false);
  assert.equal(result.blockers.length, 12);
  assert.match(result.blockers[0]!.reason, /pending real evidence/);
});

test("rejects missing, duplicate, unknown, and ownerless gates", () => {
  const value = manifest();
  value.gates = value.gates.filter((gate) => gate.id !== "security-diff");
  value.gates.push(value.gates[0]!, { id: "legal-policy-approval", type: "external", status: "passed", evidenceReference: "legal/approval", recordedAt: "2026-08-24T12:00:00.000Z" });
  (value.gates as unknown[]).push({ id: "founder-feels-ready", type: "external", status: "passed" });
  const result = evaluateLaunchReadiness(value);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(({ gate }) => gate === "security-diff"));
  assert.ok(result.blockers.some(({ reason }) => reason === "Gate is duplicated."));
  assert.ok(result.blockers.some(({ reason }) => reason === "Unknown launch gate is not permitted."));
});
