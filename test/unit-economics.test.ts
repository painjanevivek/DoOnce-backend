import assert from "node:assert/strict";
import test from "node:test";
import { calculateUnitEconomics } from "../src/release/unit-economics.js";

test("calculates contribution inputs from measured outcomes and costs", () => {
  assert.deepEqual(calculateUnitEconomics({
    verifiedOutcomes: 10,
    authoringCost: 5,
    hostedBrowserCost: 20,
    storageCost: 1,
    supportCost: 10,
    failureRepairCost: 4,
    observedRevenue: 100,
  }), { measuredVariableCost: 40, costPerVerifiedOutcome: 4, observedRevenuePerOutcome: 10, observedContributionMargin: 0.6 });
});

test("refuses economics without real outcomes or with invented negative costs", () => {
  assert.throws(() => calculateUnitEconomics({ verifiedOutcomes: 0, authoringCost: 0, hostedBrowserCost: 0, storageCost: 0, supportCost: 0, failureRepairCost: 0 }), /real outcome/);
  assert.throws(() => calculateUnitEconomics({ verifiedOutcomes: 1, authoringCost: -1, hostedBrowserCost: 0, storageCost: 0, supportCost: 0, failureRepairCost: 0 }), /non-negative/);
});
