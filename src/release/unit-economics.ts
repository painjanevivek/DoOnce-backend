export interface UnitEconomicsInput {
  verifiedOutcomes: number;
  authoringCost: number;
  hostedBrowserCost: number;
  storageCost: number;
  supportCost: number;
  failureRepairCost: number;
  observedRevenue?: number;
}

export interface UnitEconomicsResult {
  measuredVariableCost: number;
  costPerVerifiedOutcome: number;
  observedRevenuePerOutcome?: number;
  observedContributionMargin?: number;
}

export function calculateUnitEconomics(input: UnitEconomicsInput): UnitEconomicsResult {
  if (!Number.isInteger(input.verifiedOutcomes) || input.verifiedOutcomes < 1) throw new Error("Unit economics require at least one verified real outcome.");
  const costs = [input.authoringCost, input.hostedBrowserCost, input.storageCost, input.supportCost, input.failureRepairCost];
  if (costs.some((cost) => !Number.isFinite(cost) || cost < 0)) throw new Error("Measured costs must be finite non-negative amounts in one currency.");
  if (input.observedRevenue !== undefined && (!Number.isFinite(input.observedRevenue) || input.observedRevenue < 0)) throw new Error("Observed revenue must be a finite non-negative amount.");
  const measuredVariableCost = costs.reduce((total, cost) => total + cost, 0);
  const costPerVerifiedOutcome = measuredVariableCost / input.verifiedOutcomes;
  if (input.observedRevenue === undefined) return { measuredVariableCost, costPerVerifiedOutcome };
  const observedRevenuePerOutcome = input.observedRevenue / input.verifiedOutcomes;
  return {
    measuredVariableCost,
    costPerVerifiedOutcome,
    observedRevenuePerOutcome,
    observedContributionMargin: observedRevenuePerOutcome === 0 ? 0 : (observedRevenuePerOutcome - costPerVerifiedOutcome) / observedRevenuePerOutcome,
  };
}
