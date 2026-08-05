import assert from "node:assert/strict";
import test from "node:test";
import { decideRetry } from "../src/runner/run-guardrails.js";

test("retries only one bounded slow-network attempt", () => {
  assert.deepEqual(decideRetry("slow-network", 0), { action: "retry" });
  assert.equal(decideRetry("slow-network", 1).action, "pause");
});

test("pauses all uncertainty and destructive-risk signals immediately", () => {
  for (const failure of ["expired-session", "changed-page", "missing-item", "duplicate-click", "unexpected-popup"] as const) assert.equal(decideRetry(failure, 0).action, "pause");
});
