import type { LocatorCandidate, WorkflowStep } from "../contracts/protocol.js";
import type { RepairFailureCategory } from "./repair-service.js";

export interface RepairProviderInput {
  failureCategory: RepairFailureCategory;
  reasonCode: string;
  oldStep: WorkflowStep;
  candidates: LocatorCandidate[];
  currentUrlPattern?: string;
}
export interface RepairProviderResult { locator: { schemaVersion: 1; primary: LocatorCandidate; fallbacks: LocatorCandidate[] }; confidence: number; rationale: string; provider: string; model: string }
export interface RepairProvider { propose(input: RepairProviderInput): Promise<RepairProviderResult | undefined> }
