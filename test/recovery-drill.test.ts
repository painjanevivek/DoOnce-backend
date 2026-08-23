import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRecoveryDrill, type RecoveryDrillEvidence } from "../src/operations/recovery-drill.js";

const base: RecoveryDrillEvidence = {
  drillId: "queue-worker-restart-2026-08-24",
  fault: "queue",
  startedAt: "2026-08-24T10:00:00.000Z",
  finishedAt: "2026-08-24T10:03:00.000Z",
  events: [
    { sequence: 1, kind: "fault-injected" },
    { sequence: 2, kind: "paused" },
    { sequence: 3, kind: "checkpointed" },
    { sequence: 4, kind: "resumed" },
    { sequence: 5, kind: "side-effect", sideEffectKey: "download:weekly-report" },
  ],
};

test("accepts ordered recovery evidence with one occurrence per side effect", () => {
  assert.deepEqual(evaluateRecoveryDrill(base), { passed: true, issues: [] });
});

test("rejects duplicate effects and missing storage restore integrity", () => {
  const result = evaluateRecoveryDrill({
    ...base,
    fault: "storage",
    events: [...base.events, { sequence: 6, kind: "side-effect", sideEffectKey: "download:weekly-report" }],
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.issues, ["drill.duplicate-side-effect", "drill.restore-integrity-unverified"]);
});

test("requires matching restore checksums for database and storage drills", () => {
  const checksum = "a".repeat(64);
  const result = evaluateRecoveryDrill({
    ...base,
    fault: "database",
    expectedRestoreChecksum: checksum,
    observedRestoreChecksum: checksum,
    events: [...base.events, { sequence: 6, kind: "restore-verified" }],
  });
  assert.equal(result.passed, true);
});
