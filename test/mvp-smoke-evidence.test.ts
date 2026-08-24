import assert from "node:assert/strict";
import test from "node:test";
import { createPendingMvpSmokeManifest, evaluateMvpSmokeManifest, mvpSmokeCases } from "../src/release/mvp-smoke-evidence.js";

const context = {
  releaseId: "mvp-rc-1",
  deploymentId: "staging-20260824-1",
  environment: "staging",
  backendCommit: "a".repeat(40),
  frontendCommit: "b".repeat(40),
  extensionId: "a".repeat(32),
  extensionVersion: "0.4.0",
  extensionPackageSha256: "c".repeat(64),
  migrationSetSha256: "d".repeat(64),
  workflowChecksum: "e".repeat(64),
  chromeVersion: "140.0.7339.81",
};

test("creates a complete fail-closed smoke manifest for one immutable release", () => {
  const manifest = createPendingMvpSmokeManifest(context);
  const pending = evaluateMvpSmokeManifest(manifest);
  assert.equal(manifest.results.length, mvpSmokeCases.length);
  assert.equal(pending.ready, false);
  assert.equal(pending.blockers.length, mvpSmokeCases.length);
  assert.ok(pending.blockers.every(({ reason }) => /pending/.test(reason)));
});

test("passes only when every positive and negative case has matching evidence", () => {
  const manifest = createPendingMvpSmokeManifest(context);
  manifest.results = manifest.results.map((result) => ({
    ...result,
    status: "passed",
    observedOutcome: mvpSmokeCases.find(({ id }) => id === result.id)!.expectedOutcome,
    tester: "Release Operator",
    recordedAt: "2026-08-24T12:00:00.000Z",
    evidenceReference: `evidence:${result.id}`,
  }));
  assert.deepEqual(evaluateMvpSmokeManifest(manifest), { ready: true, contextSha256: manifest.results[0]!.contextSha256, blockers: [] });

  manifest.results.find(({ id }) => id === "failure.changed-page")!.observedOutcome = "completed";
  const unsafe = evaluateMvpSmokeManifest(manifest);
  assert.equal(unsafe.ready, false);
  assert.ok(unsafe.blockers.some(({ case: id, reason }) => id === "failure.changed-page" && /Expected paused/.test(reason)));
});

test("rejects duplicate, unknown, release-mismatched, and unclassified evidence", () => {
  const manifest = createPendingMvpSmokeManifest(context);
  manifest.results[0] = { ...manifest.results[0]!, status: "failed", failureClass: "unclassified" };
  manifest.results[1] = { ...manifest.results[1]!, contextSha256: "f".repeat(64) };
  Object.assign(manifest.results[2]!, { rawPageContent: "must not be accepted" });
  manifest.results.push({ ...manifest.results[2]!, id: "lifecycle.clean-install" });
  manifest.results.push({ ...manifest.results[3]!, id: "unknown.case" as never });
  const result = evaluateMvpSmokeManifest(manifest);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(({ case: id }) => id === "lifecycle.clean-install"));
  assert.ok(result.blockers.some(({ reason }) => /not bound/.test(reason)));
  assert.ok(result.blockers.some(({ reason }) => /unknown field/.test(reason)));
  assert.ok(result.blockers.some(({ case: id, reason }) => id === "manifest" && /Unknown/.test(reason)));
});
