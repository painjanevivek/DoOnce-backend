import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateWorkflowSpec, workflowSpecActionKinds, workflowSpecFormat } from "../src/workflow/workflow-spec.js";

const safeWorkflowSpec = {
  format: workflowSpecFormat,
  title: "Download weekly sales report",
  allowedDomains: ["reports.example.test"],
  inputs: [{ name: "report_date", label: "Report date", kind: "date", required: true }],
  steps: [
    {
      id: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
      action: "type",
      name: "Set report date",
      expectedOutcome: "The selected report date is shown.",
      target: { domain: "reports.example.test", path: "/weekly-report", selector: "#report-date" },
      inputName: "report_date",
    },
    {
      id: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
      action: "download",
      name: "Download weekly sales report",
      expectedOutcome: "A CSV report is downloaded.",
      target: { domain: "reports.example.test", path: "/weekly-report", selector: "[data-doonce-capture-id=\"download-report\"]" },
    },
  ],
} as const;

test("accepts a WorkflowSpec with declared reusable inputs and safe targets", () => {
  assert.deepEqual(validateWorkflowSpec(safeWorkflowSpec), { ok: true, value: safeWorkflowSpec });
});

test("publishes the canonical JSON Schema with the same format and safe action list", () => {
  const schema = JSON.parse(readFileSync(new URL("../contracts/workflow-spec.v1.schema.json", import.meta.url), "utf8")) as { $id: string; properties: { format: { const: string } }; $defs: { step: { properties: { action: { enum: string[] } } } } };
  assert.equal(schema.$id, "https://doonce.dev/schemas/workflow-spec.v1.schema.json");
  assert.equal(schema.properties.format.const, workflowSpecFormat);
  assert.deepEqual(schema.$defs.step.properties.action.enum, workflowSpecActionKinds);
});

test("rejects literal values and unknown fields so authoring input cannot smuggle secrets into a WorkflowSpec", () => {
  const result = validateWorkflowSpec({
    ...safeWorkflowSpec,
    steps: [{ ...safeWorkflowSpec.steps[0], value: "never-store-this" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /only supported fields/);
});

test("rejects undeclared inputs and unstable selectors", () => {
  const result = validateWorkflowSpec({
    ...safeWorkflowSpec,
    steps: [{ ...safeWorkflowSpec.steps[0], inputName: "secret", target: { ...safeWorkflowSpec.steps[0].target, selector: "button:nth-child(2)" } }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /declared input/);
    assert.match(result.errors.join(" "), /stable safe selector/);
  }
});

test("rejects target domains outside the declared allowlist", () => {
  const result = validateWorkflowSpec({
    ...safeWorkflowSpec,
    steps: [{ ...safeWorkflowSpec.steps[1], target: { ...safeWorkflowSpec.steps[1].target, domain: "untrusted.example.test" } }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /allowlist/);
});
