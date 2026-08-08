import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyWorkflow } from "../src/workflow/workflow-migration.js";
import { safeReportWorkflowFixture } from "./fixtures/safe-report-workflow.js";

test("migrates the report workflow deterministically without mutating the legacy record", () => {
  const legacy = structuredClone(safeReportWorkflowFixture);
  const first = migrateLegacyWorkflow(legacy);
  const second = migrateLegacyWorkflow(legacy);
  assert.deepEqual(first, second);
  assert.deepEqual(legacy, safeReportWorkflowFixture);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.schemaVersion, 1);
  assert.equal(first.value.format, "doonce.workflow-spec.v1");
  assert.equal(first.value.steps[0]?.action, "download");
  assert.equal(first.value.steps[0] && "target" in first.value.steps[0] ? first.value.steps[0].target.locator.primary.strategy : undefined, "text");
  assert.match(first.checksum, /^[a-f0-9]{64}$/);
});

test("converts unsupported legacy actions to explicit approval checkpoints", () => {
  const migrated = migrateLegacyWorkflow({ ...safeReportWorkflowFixture, steps: [{ ...safeReportWorkflowFixture.steps[0], kind: "upload" }] });
  assert.equal(migrated.ok, true);
  if (migrated.ok) assert.equal(migrated.value.steps[0]?.action, "ask-approval");
});

test("reports invalid legacy definitions without producing partial output", () => {
  const migrated = migrateLegacyWorkflow({ ...safeReportWorkflowFixture, allowedDomains: [] });
  assert.equal(migrated.ok, false);
  if (!migrated.ok) assert.match(migrated.errors.join(" "), /allowed domains/);
});
