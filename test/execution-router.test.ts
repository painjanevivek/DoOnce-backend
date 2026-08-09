import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { ExecutionRoutingError, routeExecution } from "../src/triggers/execution-router.js";

const workflow: WorkflowSpec = {
  schemaVersion: 1,
  format: "doonce.workflow-spec.v1",
  title: "Report",
  allowedDomains: ["example.test"],
  inputs: [],
  steps: [{ id: "11111111-1111-4111-8111-111111111111", action: "navigate", name: "Open", expectedOutcome: "Opened", target: { domain: "example.test", path: "/" } }],
};

test("routes a user-browser manual run to the extension", () => {
  assert.equal(routeExecution(workflow, { triggerKind: "manual", sessionLocation: "user-browser" }).executor, "extension");
});

test("routes a compatible scheduled run to a hosted browser", () => {
  assert.equal(routeExecution(workflow, { triggerKind: "schedule", sessionLocation: "managed" }).executor, "hosted-browser");
});

test("rejects a schedule that depends on a local browser", () => {
  assert.throws(() => routeExecution(workflow, { triggerKind: "schedule", sessionLocation: "user-browser" }), ExecutionRoutingError);
});

test("rejects interactive approval before hosted work is queued", () => {
  const approval: WorkflowSpec = { ...workflow, steps: [{ id: "22222222-2222-4222-8222-222222222222", action: "ask-approval", name: "Approve", expectedOutcome: "Approved", prompt: "Continue?" }] };
  assert.throws(() => routeExecution(approval, { triggerKind: "schedule", sessionLocation: "managed" }), /ask-approval/);
});
