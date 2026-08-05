import assert from "node:assert/strict";
import test from "node:test";
import { createRunReceipt } from "../src/runner/run-receipt.js";

const base = { tenantId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", workflowId: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", workflowVersion: 1, actorId: "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", outcome: "paused" as const, pauseReason: "Page changed unexpectedly.", stepOutcomes: [{ stepId: "step-1", outcome: "paused" as const }], startedAt: "2026-08-05T00:00:00.000Z" };

test("creates a redacted immutable receipt shape", () => {
  const receipt = createRunReceipt(base, "2026-08-05T00:01:00.000Z");
  assert.match(receipt.id, /^[0-9a-f-]{36}$/);
  assert.equal(receipt.pauseReason, "Page changed unexpectedly.");
});

test("rejects invalid pause-reason combinations", () => {
  assert.throws(() => createRunReceipt({ ...base, pauseReason: undefined }));
  assert.throws(() => createRunReceipt({ ...base, outcome: "completed", pauseReason: "not allowed" }));
});
