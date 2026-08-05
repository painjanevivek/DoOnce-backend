import assert from "node:assert/strict";
import test from "node:test";
import { evaluateActionPolicy } from "../src/policy/action-policy.js";

test("allows read-only report downloads", () => {
  const decision = evaluateActionPolicy({ action: "download" });
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.risk, "read-only");
});

test("requires approval for a reversible form write", () => {
  const decision = evaluateActionPolicy({ action: "type" });
  assert.equal(decision.verdict, "needs-approval");
  assert.equal(decision.ruleId, "policy.reversible-write");
});

test("blocks sensitive input even when the action would otherwise be reversible", () => {
  const decision = evaluateActionPolicy({ action: "type", fieldKind: "password" });
  assert.equal(decision.verdict, "blocked");
  assert.equal(decision.ruleId, "policy.sensitive-input");
});

test("pauses unknown actions instead of guessing", () => {
  const decision = evaluateActionPolicy({ action: "unknown" });
  assert.equal(decision.verdict, "paused");
});

test("blocks irreversible and financial actions", () => {
  for (const action of ["submit", "delete", "payment"] as const) {
    assert.equal(evaluateActionPolicy({ action }).verdict, "blocked");
  }
});
