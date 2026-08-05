import assert from "node:assert/strict";
import test from "node:test";
import { manualRunReliabilityMinimum, summarizeRunHealth } from "../src/runner/run-health.js";
import type { RunReceipt } from "../src/runner/run-receipt.js";

function receipt(index: number, outcome: RunReceipt["outcome"], workflowVersion = 1, pauseReason?: string): RunReceipt {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    tenantId: "10000000-0000-4000-8000-000000000001",
    workflowId: "20000000-0000-4000-8000-000000000001",
    workflowVersion,
    actorId: "30000000-0000-4000-8000-000000000001",
    outcome,
    ...(pauseReason ? { pauseReason } : {}),
    stepOutcomes: [],
    startedAt: "2026-08-05T00:00:00.000Z",
    finishedAt: "2026-08-05T00:00:00.000Z",
  };
}

test("summarizes only one version and requires fifty recent manual runs for reliability evidence", () => {
  const receipts = [
    ...Array.from({ length: 45 }, (_, index) => receipt(index, "completed")),
    ...Array.from({ length: 5 }, (_, index) => receipt(index + 45, "paused", 1, "slow-network")),
    receipt(51, "completed", 2),
  ];

  assert.deepEqual(summarizeRunHealth(receipts, 1), {
    workflowVersion: 1,
    sampleSize: manualRunReliabilityMinimum,
    completedRuns: 45,
    pausedRuns: 5,
    successRate: 90,
    pauseReasons: { "slow-network": 5 },
    meetsManualReliabilityThreshold: true,
  });
  assert.equal(summarizeRunHealth(receipts, 2).meetsManualReliabilityThreshold, false);
});
