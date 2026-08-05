import { randomUUID } from "node:crypto";

export type RunReceiptOutcome = "completed" | "paused" | "failed" | "cancelled";

export interface RunReceipt {
  id: string;
  tenantId: string;
  workflowId: string;
  workflowVersion: number;
  actorId: string;
  outcome: RunReceiptOutcome;
  pauseReason?: string;
  stepOutcomes: Array<{ stepId: string; outcome: "verified" | "paused" | "failed" }>;
  startedAt: string;
  finishedAt: string;
}

export function createRunReceipt(input: Omit<RunReceipt, "id" | "finishedAt">, finishedAt = new Date().toISOString()): RunReceipt {
  if ((input.outcome === "paused") !== Boolean(input.pauseReason)) throw new Error("Paused receipts require a reason; other outcomes must not include one.");
  return { ...input, id: randomUUID(), finishedAt };
}
