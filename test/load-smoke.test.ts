import assert from "node:assert/strict";
import test from "node:test";
import { percentile } from "../scripts/load-smoke.mjs";

test("calculates deterministic load-test percentiles without mutating samples", () => {
  const values = [100, 10, 50, 20];
  assert.equal(percentile(values, .5), 20);
  assert.equal(percentile(values, .95), 100);
  assert.deepEqual(values, [100, 10, 50, 20]);
});
