export type RunFailure = "slow-network" | "expired-session" | "changed-page" | "missing-item" | "duplicate-click" | "unexpected-popup";

export interface RetryDecision { action: "retry" | "pause"; reason?: string }

export function decideRetry(failure: RunFailure, attempts: number, maxAttempts = 1): RetryDecision {
  if (!Number.isInteger(attempts) || !Number.isInteger(maxAttempts) || attempts < 0 || maxAttempts < 0) return { action: "pause", reason: "Invalid retry budget." };
  if (["expired-session", "changed-page", "missing-item", "duplicate-click", "unexpected-popup"].includes(failure)) return { action: "pause", reason: `Paused after ${failure}.` };
  return attempts < maxAttempts ? { action: "retry" } : { action: "pause", reason: "Retry budget exhausted." };
}
