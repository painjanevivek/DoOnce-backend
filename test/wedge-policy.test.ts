import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { qualifyAttendedWedge } from "../src/beta/wedge-policy.js";

const navigate = {
  id: "11111111-1111-4111-8111-111111111111",
  action: "navigate" as const,
  name: "Open reports",
  expectedOutcome: "The reports page opens",
  target: { domain: "reports.example.test", path: "/reports" },
};
const base: WorkflowSpec = {
  schemaVersion: 1,
  format: "doonce.workflow-spec.v1",
  title: "Weekly report",
  allowedDomains: ["reports.example.test"],
  inputs: [],
  steps: [navigate],
  successCriteria: [{ id: "22222222-2222-4222-8222-222222222222", kind: "url", operator: "contains", expected: "/reports" }],
};

test("qualifies only the bounded attended report wedges", () => {
  const download: WorkflowSpec = {
    ...base,
    steps: [
      ...base.steps,
      { id: "33333333-3333-4333-8333-333333333333", action: "download", name: "Download report", expectedOutcome: "The report downloads", target: { domain: "reports.example.test", locator: { candidates: [{ strategy: "role", value: "button", name: "Download report" }] } } },
    ],
  };
  const extraction: WorkflowSpec = {
    ...base,
    steps: [
      ...base.steps,
      { id: "44444444-4444-4444-8444-444444444444", action: "read", name: "Read total", expectedOutcome: "The total is captured", outputName: "total", target: { domain: "reports.example.test", locator: { candidates: [{ strategy: "label", value: "Total" }] } } },
    ],
  };

  assert.equal(qualifyAttendedWedge("report-download", download).qualified, true);
  assert.equal(qualifyAttendedWedge("table-extraction", extraction).qualified, true);
});

test("rejects writes, multiple domains, missing artifacts, and unverifiable work", () => {
  const unsafe: WorkflowSpec = {
    ...base,
    allowedDomains: ["reports.example.test", "cdn.example.test"],
    successCriteria: [],
    steps: [
      navigate,
      { id: "55555555-5555-4555-8555-555555555555", action: "type", name: "Enter value", expectedOutcome: "Value entered", inputName: "value", target: { domain: "reports.example.test", locator: { candidates: [{ strategy: "label", value: "Value" }] } } },
    ],
  };
  const result = qualifyAttendedWedge("report-download", unsafe);
  assert.equal(result.qualified, false);
  assert.deepEqual(result.issues, [
    "wedge.exactly-one-domain-required",
    "wedge.action-not-supported",
    "wedge.single-download-required",
    "wedge.verification-required",
  ]);
});
