import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { RepairProposal, StepResult, WorkflowSpec, WorkflowStep } from "../contracts/protocol.js";
import { validateProtocolContract } from "../contracts/validation.js";
import { planLocatorRepair } from "./repair-planner.js";
import type { RepairProvider } from "./repair-provider.js";

export type RepairFailureCategory = "locator-not-found" | "locator-ambiguous" | "unexpected-page" | "navigation-timeout" | "assertion-failed" | "download-failed" | "authentication-required" | "executor-disconnected" | "unsupported-capability" | "user-input-required" | "unknown-internal-error";
export type RepairEffectiveness = "unmeasured" | "improved" | "not-improved";
export interface RepairEvidence { reasonCode: string; currentUrlPattern?: string; candidateCount: number; screenshotArtifactIds: string[]; precedingStepIds: string[] }
export interface RepairProposalRecord {
  id: string; workflowId: string; runId: string; baseVersion: number; baseChecksum: string; status: "pending" | "accepted" | "rejected"; failureCategory: RepairFailureCategory; causeSummary: string; failedStepId: string;
  oldStep: WorkflowStep; proposedStep: WorkflowStep; changedFields: string[]; evidence: RepairEvidence; confidence: number; requiredTestPlan: string[]; provider: string; model: string; createdAt: string;
  acceptedDraftVersion?: number; rejectedReason?: string; effectiveness: RepairEffectiveness;
}
export interface RepairRunContext { runId: string; workflowId: string; workflowVersion: number; workflowChecksum: string; status: "paused" | "failed" | string; workflow: WorkflowSpec; stepResults: StepResult[]; screenshotArtifactIds: string[] }
export interface RepairStore {
  loadRun(user: AuthenticatedUser, runId: string): Promise<RepairRunContext | undefined>;
  save(user: AuthenticatedUser, proposal: RepairProposalRecord, protocol: RepairProposal): Promise<RepairProposalRecord>;
  find(user: AuthenticatedUser, proposalId: string): Promise<RepairProposalRecord | undefined>;
  list(user: AuthenticatedUser, workflowId: string): Promise<RepairProposalRecord[]>;
  source(user: AuthenticatedUser, proposalId: string): Promise<{ proposal: RepairProposalRecord; workflow: WorkflowSpec } | undefined>;
  accept(user: AuthenticatedUser, proposalId: string, workflow: WorkflowSpec): Promise<{ status: "accepted"; proposal: RepairProposalRecord } | { status: "conflict" | "missing" }>;
  reject(user: AuthenticatedUser, proposalId: string, reason?: string): Promise<RepairProposalRecord | undefined>;
}
export class RepairInputError extends Error {} export class RepairAccessError extends Error {} export class RepairConflictError extends Error {}

export class RepairService {
  public constructor(private readonly store: RepairStore, private readonly provider?: RepairProvider) {}
  public async propose(user: AuthenticatedUser, runId: string): Promise<RepairProposalRecord> {
    requireAuthor(user); requireUuid(runId);
    const context = await this.store.loadRun(user, runId); if (!context) throw new RepairInputError("The failed run could not be found.");
    if (!['paused', 'failed'].includes(context.status)) throw new RepairInputError("Only a paused or failed run can be analyzed for repair.");
    const failed = [...context.stepResults].reverse().find((step) => step.status === "paused" || step.status === "failed");
    if (!failed) throw new RepairInputError("The run does not contain a failed step to repair.");
    const oldStep = context.workflow.steps.find((step) => step.id === failed.stepId); if (!oldStep || !("target" in oldStep) || !("locator" in oldStep.target)) throw new RepairInputError("This failure is not a locator-based step that can be repaired automatically.");
    const category = classifyFailure(failed.reasonCode ?? "executor.unexpected-error"); const candidates = failed.repairCandidates ?? [];
    let planned = planLocatorRepair(oldStep.target.locator, candidates); let provider = "deterministic"; let model = "semantic-locator-v1";
    if (!planned && this.provider) { const result = await this.provider.propose({ failureCategory: category, reasonCode: failed.reasonCode ?? "executor.unexpected-error", oldStep, candidates, ...(failed.observedPage?.urlPattern ? { currentUrlPattern: failed.observedPage.urlPattern } : {}) }); if (result) { planned = { locator: result.locator, confidence: boundedConfidence(result.confidence), rationale: result.rationale.slice(0, 1000) }; provider = result.provider.slice(0, 200); model = result.model.slice(0, 200); } }
    if (!planned) throw new RepairInputError(candidates.length === 0 ? "No bounded semantic candidates were captured. Re-run the workflow with the current extension, then try again." : "The available candidates are too ambiguous. Open the draft and calibrate this step manually.");
    const proposedStep = structuredClone(oldStep); if (!("target" in proposedStep) || !("locator" in proposedStep.target)) throw new RepairInputError("The repair target is invalid."); proposedStep.target.locator = planned.locator;
    const candidateWorkflow = replaceStep(context.workflow, proposedStep); validateWorkflow(candidateWorkflow);
    const now = new Date().toISOString(); const id = randomUUID(); const reasonCode = failed.reasonCode ?? "executor.unexpected-error";
    const evidence: RepairEvidence = { reasonCode, ...(failed.observedPage?.urlPattern ? { currentUrlPattern: failed.observedPage.urlPattern } : {}), candidateCount: candidates.length, screenshotArtifactIds: context.screenshotArtifactIds.slice(0, 5), precedingStepIds: context.stepResults.filter((step) => step.status === "verified").slice(-3).map((step) => step.stepId) };
    const proposal: RepairProposalRecord = { id, workflowId: context.workflowId, runId, baseVersion: context.workflowVersion, baseChecksum: context.workflowChecksum, status: "pending", failureCategory: category, causeSummary: cause(category), failedStepId: failed.stepId, oldStep: structuredClone(oldStep), proposedStep, changedFields: [`steps.${failed.stepId}.target.locator`], evidence, confidence: planned.confidence, requiredTestPlan: ["Run the repaired draft against the same page state.", `Verify step “${oldStep.name}” resolves exactly one visible element.`, "Verify the step outcome and all workflow success criteria before publishing."], provider, model, createdAt: now, effectiveness: "unmeasured" };
    const protocol: RepairProposal = { schemaVersion: 1, format: "doonce.repair-proposal.v1", id, workflowId: context.workflowId, baseVersion: context.workflowVersion, createdAt: now, operations: [{ op: "replace-locator", stepId: failed.stepId, reason: planned.rationale.slice(0, 500), locator: planned.locator }] };
    const validation = validateProtocolContract("RepairProposal", protocol); if (!validation.ok) throw new RepairInputError("The generated repair did not pass the canonical contract.");
    return this.store.save(user, proposal, protocol);
  }
  public find(user: AuthenticatedUser, id: string) { return this.store.find(user, requireUuid(id)); }
  public list(user: AuthenticatedUser, workflowId: string) { return this.store.list(user, requireUuid(workflowId)); }
  public async accept(user: AuthenticatedUser, id: string): Promise<RepairProposalRecord> { requireAuthor(user); const source = await this.store.source(user, requireUuid(id)); if (!source) throw new RepairInputError("The repair proposal could not be found."); if (source.proposal.status !== "pending") throw new RepairConflictError("This repair proposal has already been decided."); const current = source.workflow.steps.find((step) => step.id === source.proposal.failedStepId); if (!current || !isDeepStrictEqual(current, source.proposal.oldStep)) throw new RepairConflictError("The workflow changed after this repair was proposed. Generate a new proposal."); const workflow = replaceStep(source.workflow, source.proposal.proposedStep); validateWorkflow(workflow); const result = await this.store.accept(user, id, workflow); if (result.status !== "accepted") { if (result.status === "conflict") throw new RepairConflictError("A newer draft or workflow version already exists. Review it before applying this repair."); throw new RepairInputError("The repair proposal could not be found."); } return result.proposal; }
  public async reject(user: AuthenticatedUser, id: string, reason?: unknown): Promise<RepairProposalRecord> { requireAuthor(user); const parsed = reason === undefined ? undefined : typeof reason === "string" && reason.length <= 500 ? reason.trim() : (() => { throw new RepairInputError("A rejection reason must be at most 500 characters."); })(); const proposal = await this.store.reject(user, requireUuid(id), parsed); if (!proposal) throw new RepairInputError("The pending repair proposal could not be found."); return proposal; }
}
function replaceStep(workflow: WorkflowSpec, replacement: WorkflowStep): WorkflowSpec { const clone = structuredClone(workflow); const index = clone.steps.findIndex((step) => step.id === replacement.id); if (index < 0) throw new RepairInputError("The failed step is no longer present."); clone.steps[index] = structuredClone(replacement); return clone; }
function validateWorkflow(workflow: WorkflowSpec): void { const result = validateProtocolContract<WorkflowSpec>("WorkflowSpec", workflow); if (!result.ok) throw new RepairInputError("The proposed repair would create an invalid workflow."); }
function requireAuthor(user: AuthenticatedUser): void { if (!['owner', 'builder'].includes(user.role)) throw new RepairAccessError("Only workflow owners and builders can manage repairs."); }
function requireUuid(value: string): string { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new RepairInputError("A valid repair or run identifier is required."); return value; }
function boundedConfidence(value: number): number { if (!Number.isFinite(value) || value < 0 || value > 1) throw new RepairInputError("The repair provider returned invalid confidence."); return value; }
export function classifyFailure(code: string): RepairFailureCategory { if (["locator.missing", "wait.timeout", "element.not-visible"].includes(code)) return "locator-not-found"; if (code === "locator.ambiguous") return "locator-ambiguous"; if (code.startsWith("navigation.unexpected") || code === "navigation.domain-mismatch") return "unexpected-page"; if (code === "navigation.timeout") return "navigation-timeout"; if (code.startsWith("assertion.")) return "assertion-failed"; if (code.startsWith("download.")) return "download-failed"; if (code.includes("auth") || code.includes("session")) return "authentication-required"; if (code.includes("disconnect") || code.includes("lease") || code === "run.uncertain-action") return "executor-disconnected"; if (code.includes("unsupported") || code.includes("invalid-control") || code === "element.not-editable" || code === "element.not-clickable") return "unsupported-capability"; if (code.startsWith("input.") || code === "approval.required") return "user-input-required"; return "unknown-internal-error"; }
function cause(category: RepairFailureCategory): string { const messages: Record<RepairFailureCategory, string> = { "locator-not-found": "The page no longer contains an element matching the saved locator.", "locator-ambiguous": "The saved locator now matches more than one element.", "unexpected-page": "The browser reached a page that does not match the workflow target.", "navigation-timeout": "The target page did not finish loading within the allowed time.", "assertion-failed": "The browser action finished, but its observable outcome did not match.", "download-failed": "The expected download was not observed.", "authentication-required": "The browser session needs renewed authentication.", "executor-disconnected": "The executor stopped communicating before the step completed.", "unsupported-capability": "The selected executor cannot perform this step.", "user-input-required": "The workflow needs a user value or decision.", "unknown-internal-error": "The executor reported an unclassified internal failure." }; return messages[category]; }
