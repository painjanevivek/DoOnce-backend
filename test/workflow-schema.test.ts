import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowDraft } from "../src/workflow/schema.js";
import { safeReportWorkflowFixture } from "./fixtures/safe-report-workflow.js";

test("accepts a safe, allowlisted workflow draft", () => {
  assert.deepEqual(validateWorkflowDraft(safeReportWorkflowFixture), { ok: true, value: safeReportWorkflowFixture });
});

test("rejects a step outside the workflow domain allowlist", () => {
  const result = validateWorkflowDraft({
    ...safeReportWorkflowFixture,
    steps: [{ ...safeReportWorkflowFixture.steps[0], domain: "untrusted.example.test" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /allowlist/);
});

test("rejects a workflow path traversal attempt", () => {
  const result = validateWorkflowDraft({
    ...safeReportWorkflowFixture,
    steps: [{ ...safeReportWorkflowFixture.steps[0], path: "/reports/../secrets" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /safe relative path/);
});
