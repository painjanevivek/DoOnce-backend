import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateWorkflowSpec, workflowSpecActionKinds, workflowSpecFormat, workflowSpecSchemaVersion } from "../src/workflow/workflow-spec.js";

const locator = { schemaVersion: 1, primary: { strategy: "capture-id", value: "download-report", confidence: 1 }, fallbacks: [] } as const;
const target = { domain: "reports.example.test", path: "/weekly-report", locator } as const;
const ids = [
  "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", "e0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", "f0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  "10c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", "20c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", "30c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  "40c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
] as const;

export const workflowSpecFixture = {
  schemaVersion: workflowSpecSchemaVersion,
  format: workflowSpecFormat,
  title: "Download weekly sales report",
  allowedDomains: ["reports.example.test"],
  inputs: [
    { name: "report_date", label: "Report date", kind: "date", required: true },
    { name: "region", label: "Region", kind: "select", required: true, options: ["North", "South"] },
  ],
  steps: [
    { id: ids[0], action: "navigate", name: "Open reports", expectedOutcome: "The reports page opens.", target: { domain: "reports.example.test", path: "/weekly-report" } },
    { id: ids[1], action: "wait", name: "Wait for report form", expectedOutcome: "The form is visible.", target, timeoutMs: 5000 },
    { id: ids[2], action: "read", name: "Read heading", expectedOutcome: "The report heading is available.", target, outputName: "heading" },
    { id: ids[3], action: "select", name: "Choose region", expectedOutcome: "The region is selected.", target, inputName: "region" },
    { id: ids[4], action: "type", name: "Set report date", expectedOutcome: "The report date is shown.", target, inputName: "report_date" },
    { id: ids[5], action: "download", name: "Download report", expectedOutcome: "A CSV report is downloaded.", target },
    { id: ids[6], action: "compare", name: "Check heading", expectedOutcome: "The heading matches.", target, operator: "contains", expected: "Weekly" },
    { id: ids[7], action: "branch", name: "Choose region path", expectedOutcome: "The matching path is selected.", inputName: "region", operator: "equals", expected: "North", ifTrueStepId: ids[8], ifFalseStepId: ids[9] },
    { id: ids[8], action: "ask-approval", name: "Confirm export", expectedOutcome: "An operator confirms the export.", prompt: "Continue with the reviewed export?" },
    { id: ids[9], action: "stop", name: "Finish", expectedOutcome: "The workflow stops.", reason: "Workflow complete." },
  ],
} as const;

test("validates every WorkflowSpec step variant", () => {
  assert.deepEqual(validateWorkflowSpec(workflowSpecFixture), { ok: true, value: workflowSpecFixture });
  assert.deepEqual(workflowSpecFixture.steps.map((step) => step.action), workflowSpecActionKinds);
});

test("publishes the protocol schema as the canonical WorkflowSpec source", () => {
  const schema = JSON.parse(readFileSync(new URL("../contracts/protocol.v1.schema.json", import.meta.url), "utf8")) as { $id: string; $defs: { WorkflowSpec: { properties: { schemaVersion: { const: number }; format: { const: string } } } } };
  assert.equal(schema.$id, "https://doonce.dev/schemas/protocol.v1.schema.json");
  assert.equal(schema.$defs.WorkflowSpec.properties.schemaVersion.const, 1);
  assert.equal(schema.$defs.WorkflowSpec.properties.format.const, workflowSpecFormat);
});

test("rejects unknown fields and maps errors to readable step guidance", () => {
  const invalid = structuredClone(workflowSpecFixture) as unknown as { steps: Array<Record<string, unknown>> };
  invalid.steps[2] = { ...invalid.steps[2], target: { domain: "reports.example.test", path: "/weekly-report" }, value: "never-store-this" };
  const result = validateWorkflowSpec(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /Step 3/);
    assert.match(result.errors.join(" "), /button or field target|unsupported field/);
    assert.equal(result.issues.every((issue) => issue.code.startsWith("contract.") || issue.code.startsWith("workflow.")), true);
  }
});

test("rejects undeclared inputs, duplicate identifiers, and domains outside the allowlist", () => {
  const invalid = structuredClone(workflowSpecFixture);
  invalid.steps[4]!.inputName = "missing_input";
  invalid.steps[5]!.id = invalid.steps[4]!.id;
  invalid.steps[5]!.target.domain = "untrusted.example.test";
  const result = validateWorkflowSpec(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /declared workflow input/);
    assert.match(result.errors.join(" "), /unique identifier/);
    assert.match(result.errors.join(" "), /approved domain list/);
  }
});
