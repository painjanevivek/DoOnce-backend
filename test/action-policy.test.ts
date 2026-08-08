import assert from "node:assert/strict";
import test from "node:test";
import { evaluateActionCapabilities } from "../src/execution/action-capabilities.js";
import { evaluateActionPolicy } from "../src/policy/action-policy.js";

test("allows read-only report downloads", () => {
  const decision = evaluateActionCapabilities({ action: "download" });
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.risk, "read-only");
});

test("requires approval for a reversible form write", () => {
  const decision = evaluateActionCapabilities({ action: "type" });
  assert.equal(decision.verdict, "needs-approval");
  assert.equal(decision.ruleId, "capability.reversible-write");
});

test("blocks sensitive input even when the action would otherwise be reversible", () => {
  const decision = evaluateActionCapabilities({ action: "type", fieldKind: "password" });
  assert.equal(decision.verdict, "blocked");
  assert.equal(decision.ruleId, "capability.sensitive-input");
});

test("pauses unknown actions instead of guessing", () => {
  const decision = evaluateActionCapabilities({ action: "unknown" });
  assert.equal(decision.verdict, "paused");
});

test("blocks irreversible and financial actions", () => {
  for (const action of ["submit", "delete", "payment"] as const) {
    assert.equal(evaluateActionCapabilities({ action }).verdict, "blocked");
  }
});

test("keeps the deprecated action policy adapter stable during migration", () => {
  assert.equal(evaluateActionPolicy({ action: "type" }).ruleId, "policy.reversible-write");
});
