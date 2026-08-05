import type { RunReceipt } from "./run-receipt.js";

export const manualRunReliabilityMinimum = 50;
export const manualRunReliabilityRate = 90;
const recentReceiptLimit = 50;

export interface RunHealthSummary {
  workflowVersion: number;
  sampleSize: number;
  completedRuns: number;
  pausedRuns: number;
  successRate: number;
  pauseReasons: Record<string, number>;
  meetsManualReliabilityThreshold: boolean;
}

export function summarizeRunHealth(receipts: readonly RunReceipt[], workflowVersion: number): RunHealthSummary {
  const versionReceipts = receipts.slice(0, recentReceiptLimit).filter((receipt) => receipt.workflowVersion === workflowVersion);
  const completedRuns = versionReceipts.filter((receipt) => receipt.outcome === "completed").length;
  const pausedRuns = versionReceipts.length - completedRuns;
  const pauseReasons = versionReceipts.reduce<Record<string, number>>((counts, receipt) => {
    if (receipt.outcome === "paused" && receipt.pauseReason) counts[receipt.pauseReason] = (counts[receipt.pauseReason] ?? 0) + 1;
    return counts;
  }, {});
  const successRate = versionReceipts.length === 0 ? 0 : Math.round((completedRuns / versionReceipts.length) * 100);

  return {
    workflowVersion,
    sampleSize: versionReceipts.length,
    completedRuns,
    pausedRuns,
    successRate,
    pauseReasons,
    meetsManualReliabilityThreshold: versionReceipts.length >= manualRunReliabilityMinimum && successRate >= manualRunReliabilityRate,
  };
}
