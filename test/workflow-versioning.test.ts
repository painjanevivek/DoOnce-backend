import assert from "node:assert/strict";
import test from "node:test";
import {
  createNextDraft,
  publishWorkflowDraft,
} from "../src/workflow/versioning.js";
import { safeReportWorkflowFixture } from "./fixtures/safe-report-workflow.js";

test("publishes a read-only workflow as an immutable active version", () => {
  const result = publishWorkflowDraft(safeReportWorkflowFixture, "2026-08-05T12:00:00.000Z");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.status, "active");
  assert.equal(result.value.publishedAt, "2026-08-05T12:00:00.000Z");
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.steps), true);
  assert.equal(Object.isFrozen(result.value.steps[0]), true);
});

test("creates an independent new draft instead of editing an active version", () => {
  const published = publishWorkflowDraft(safeReportWorkflowFixture, "2026-08-05T12:00:00.000Z");
  assert.equal(published.ok, true);
  if (!published.ok) return;

  const nextDraft = createNextDraft(published.value);
  nextDraft.steps[0]!.name = "Download the amended report";
  assert.equal(nextDraft.version, 2);
  assert.equal(published.value.steps[0]!.name, "Download this week's report");
});

test("refuses to publish a workflow containing a reversible write before approvals exist", () => {
  const result = publishWorkflowDraft({
    ...safeReportWorkflowFixture,
    steps: [{ ...safeReportWorkflowFixture.steps[0], kind: "type" }],
  }, "2026-08-05T12:00:00.000Z");

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /cannot be published yet/);
});
