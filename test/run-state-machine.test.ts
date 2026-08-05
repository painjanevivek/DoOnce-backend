import assert from "node:assert/strict";
import test from "node:test";
import { transitionRun } from "../src/runner/run-state-machine.js";

test("completes a reviewed read-only run through deterministic states", () => {
  let state = transitionRun("created", "begin");
  state = transitionRun(state, "validated");
  state = transitionRun(state, "approval-granted");
  state = transitionRun(state, "step-executed");
  state = transitionRun(state, "verified");
  assert.equal(state, "completed");
});

test("pauses instead of guessing on uncertainty or illegal transitions", () => {
  assert.equal(transitionRun("executing", "uncertain"), "paused");
  assert.equal(transitionRun("previewing", "step-executed"), "paused");
  assert.equal(transitionRun("paused", "resume"), "validating");
});

test("cancellation and terminal states are final", () => {
  assert.equal(transitionRun("previewing", "cancel"), "cancelled");
  assert.equal(transitionRun("completed", "resume"), "completed");
});
