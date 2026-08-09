import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { protocolContractNames, validateProtocolContract } from "../src/contracts/validation.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

test("validates a stored fixture for every protocol contract", () => {
  for (const name of protocolContractNames) {
    assert.deepEqual(validateProtocolContract(name, validProtocolFixtures[name]), { ok: true, value: validProtocolFixtures[name] }, name);
  }
});

test("rejects unknown fields on every protocol object", () => {
  for (const name of protocolContractNames) {
    const fixture = validProtocolFixtures[name];
    assert.equal(typeof fixture, "object");
    const result = validateProtocolContract(name, { ...(fixture as Record<string, unknown>), unknownField: true });
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.errors.some((error) => error.code === "contract.unknown_field" || error.code === "contract.variant"), true, name);
  }
});

test("returns stable paths, codes, and readable messages", () => {
  const result = validateProtocolContract("RunRequest", { schemaVersion: 1, executor: "extension" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors.every((error) => error.code && error.path && !/must have|required property/i.test(error.message)), true);
    assert.match(result.errors.map((error) => error.message).join(" "), /needs run id|needs workflow id/);
  }
});

test("validates WorkflowSpec semantics inside compilation metadata", () => {
  const fixture = structuredClone(validProtocolFixtures.WorkflowCompilation) as { workflow: { allowedDomains: string[] } };
  fixture.workflow.allowedDomains = ["other.example.test"];
  const result = validateProtocolContract("WorkflowCompilation", fixture);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some(({ code, path }) => code === "workflow.domain_not_allowed" && path.startsWith("/workflow/steps/")), true);
});

test("validates every observable workflow assertion and its cross-field rules", () => {
  const fixture = structuredClone(validProtocolFixtures.WorkflowSpec) as WorkflowSpec;
  const target = (fixture.steps[0] as Extract<WorkflowSpec["steps"][number], { target: { locator: unknown } }>).target;
  fixture.steps.push({ id: "99999999-9999-4999-8999-999999999999", action: "read", name: "Read total", expectedOutcome: "Total is available", target, outputName: "total" });
  fixture.successCriteria = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Correct page", kind: "url-match", operator: "contains", expected: "/reports" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Result exists", kind: "element-present", target },
    { id: "33333333-3333-4333-8333-333333333333", name: "Error absent", kind: "element-absent", target },
    { id: "44444444-4444-4444-8444-444444444444", name: "Text matches", kind: "text-match", target, operator: "contains", expected: "Ready" },
    { id: "55555555-5555-4555-8555-555555555555", name: "Field matches", kind: "field-state", target, operator: "equals", expected: "north" },
    { id: "66666666-6666-4666-8666-666666666666", name: "File downloaded", kind: "file-downloaded", fileNamePattern: "report\\.csv$", contentTypes: ["text/csv"], minBytes: 1, maxBytes: 1_000_000 },
    { id: "77777777-7777-4777-8777-777777777777", name: "Output matches", kind: "extracted-value", outputName: "total", operator: "matches", expected: "^[0-9]+$" },
    { id: "88888888-8888-4888-8888-888888888888", name: "Rows exist", kind: "table-row-count", target, operator: "at-least", count: 1 },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Human review", kind: "user-confirmation", prompt: "Does the report look correct?" },
  ];
  assert.equal(validateProtocolContract("WorkflowSpec", fixture).ok, true);

  const invalid = structuredClone(fixture);
  const download = invalid.successCriteria?.find((assertion) => assertion.kind === "file-downloaded");
  if (download?.kind === "file-downloaded") { download.minBytes = 20; download.maxBytes = 10; }
  const result = validateProtocolContract("WorkflowSpec", invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.some((issue) => issue.code === "workflow.assertion_size_invalid"), true);
});
