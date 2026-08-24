import assert from "node:assert/strict";
import test from "node:test";
import { createPendingMvpPromotionManifest, evaluateMvpPromotionManifest, type MvpPromotionManifest } from "../src/release/mvp-promotion-evidence.js";

const input = {
  release: {
    releaseId: "mvp-rc-1",
    deploymentId: "pilot-20260824-1",
    environment: "production-pilot",
    backendCommit: "a".repeat(40),
    frontendCommit: "b".repeat(40),
    extensionId: "a".repeat(32),
    extensionVersion: "0.4.0",
    extensionPackageSha256: "c".repeat(64),
    migrationSetSha256: "d".repeat(64),
    workflowChecksum: "e".repeat(64),
    chromeVersion: "140.0.7339.81",
  },
  charterSha256: "f".repeat(64),
  minimumTimeSavedSeconds: 300,
  pilotIds: ["pilot-alpha", "pilot-bravo", "pilot-charlie"],
};

test("creates exactly three fail-closed participant records bound to the smoke release", () => {
  const manifest = createPendingMvpPromotionManifest(input);
  const result = evaluateMvpPromotionManifest(manifest);
  assert.equal(manifest.participants.length, 3);
  assert.equal(new Set(manifest.participants.map(({ pilotId }) => pilotId)).size, 3);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(({ subject }) => subject === "smoke-gate"));
  assert.ok(result.blockers.some(({ subject }) => subject === "decision"));
  assert.equal(result.blockers.filter(({ reason }) => /pending real-user/.test(reason)).length, 3);
});

test("promotes only three users with release-bound runs, comprehension, safe pauses, value, and founder evidence", () => {
  const manifest = passingManifest();
  const result = evaluateMvpPromotionManifest(manifest);
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.ok(result.participantMetrics.every(({ medianTimeSavedSeconds }) => medianTimeSavedSeconds === 420));
});

test("rejects carried evidence, developer intervention, unsafe uncertainty, leakage, and failed value", () => {
  const manifest = passingManifest();
  manifest.participants[0]!.productionRuns![1]!.contextSha256 = "0".repeat(64);
  manifest.participants[0]!.productionRuns![1]!.developerIntervened = true;
  manifest.participants[1]!.productionRuns![2]!.sensitiveDataLeakage = true;
  manifest.participants[1]!.uncertaintyObservations = [{
    id: "popup-1",
    outcome: "continued-unsafe",
    evidenceReference: "evidence:popup-1",
    recordedAt: "2026-08-24T12:00:00.000Z",
  }];
  manifest.participants[2]!.baselineDurationSeconds = 700;
  const result = evaluateMvpPromotionManifest(manifest);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(({ reason }) => /not bound/.test(reason)));
  assert.ok(result.blockers.some(({ reason }) => /intervention-free/.test(reason)));
  assert.ok(result.blockers.some(({ reason }) => /safely-paused/.test(reason)));
  assert.ok(result.blockers.some(({ reason }) => /below the charter threshold/.test(reason)));
});

test("rejects missing, duplicate, unknown, and unsigned participant evidence", () => {
  const manifest = passingManifest();
  manifest.participants[1]!.pilotId = manifest.participants[0]!.pilotId;
  Object.assign(manifest.participants[0]!, { rawUserFeedback: "not allowed in the promotion manifest" });
  manifest.participants.pop();
  manifest.decision.owner = undefined;
  const result = evaluateMvpPromotionManifest(manifest);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(({ reason }) => /exactly three/.test(reason)));
  assert.ok(result.blockers.some(({ reason }) => /duplicated/.test(reason)));
  assert.ok(result.blockers.some(({ reason }) => /unknown field/.test(reason)));
  assert.ok(result.blockers.some(({ reason }) => /owner record/.test(reason)));
});

function passingManifest(): MvpPromotionManifest {
  const manifest = createPendingMvpPromotionManifest(input);
  manifest.smokeGate = {
    status: "passed",
    contextSha256: manifest.smokeGate.contextSha256,
    evidenceReference: "evidence:smoke-manifest",
    recordedAt: "2026-08-24T12:00:00.000Z",
  };
  manifest.participants = manifest.participants.map((participant, participantIndex) => ({
    ...participant,
    status: "passed",
    observer: "Pilot Observer",
    recordedAt: "2026-08-24T12:00:00.000Z",
    consentEvidenceReference: `evidence:${participant.pilotId}:consent`,
    expectationEvidenceReference: `evidence:${participant.pilotId}:expectation`,
    baselineDurationSeconds: 900,
    historicalErrorRatePercent: 5,
    productionRuns: [0, 1, 2].map((runIndex) => ({
      runId: `${participantIndex + 1}0000000-0000-4000-8000-${String(runIndex + 1).padStart(12, "0")}`,
      stage: runIndex === 0 ? "first-production" as const : "repeat-production" as const,
      contextSha256: participant.contextSha256,
      verified: true,
      developerIntervened: false,
      sensitiveDataLeakage: false,
      activeDurationSeconds: 480 + (runIndex - 1) * 30,
      elapsedDurationSeconds: 510 + (runIndex - 1) * 30,
      supportDurationSeconds: 0,
      approvalEvidenceReference: `evidence:${participant.pilotId}:approval-${runIndex + 1}`,
      receiptEvidenceReference: `evidence:${participant.pilotId}:receipt-${runIndex + 1}`,
      recordedAt: `2026-08-2${4 + runIndex}T12:00:00.000Z`,
    })),
    comprehension: {
      authorizedDomainAndTask: true,
      excludedData: true,
      freshApproval: true,
      safePause: true,
      disableAndReport: true,
      evidenceReference: `evidence:${participant.pilotId}:comprehension`,
    },
    uncertaintyObservations: [],
    safePauseEvidenceReference: `evidence:${participant.pilotId}:safe-pause`,
    leakageReviewReference: `evidence:${participant.pilotId}:leakage-review`,
  }));
  manifest.decision = {
    status: "go",
    owner: "Founder Owner",
    recordedAt: "2026-08-27T12:00:00.000Z",
    evidenceReference: "evidence:founder-go",
    launchReadinessEvidenceReference: "evidence:launch-readiness",
    capabilityMatrixEvidenceReference: "evidence:capability-matrix",
  };
  return manifest;
}
