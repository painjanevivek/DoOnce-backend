import { createHash, randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { RuntimeCapabilities, WorkflowInputDefinition, WorkflowSpec } from "../contracts/protocol.js";
import { validateProtocolContract } from "../contracts/validation.js";
import { operationalMetrics } from "../observability/metrics.js";
import type { CanonicalWorkflowService } from "../workflow/canonical-workflow-service.js";
import { normalizeAuthoringCandidate } from "./authoring-normalizer.js";
import type { AuthoringProvider, AuthoringProviderResult, AuthoringProviderUsage } from "./authoring-provider.js";

export type AuthoringJobStatus = "queued" | "running" | "needs-input" | "completed" | "failed" | "cancelled";
export interface AuthoringRequest { taskDescription: string; startingUrl?: string; availableInputs: WorkflowInputDefinition[]; observationSessionId?: string; executorCapabilities: RuntimeCapabilities; workflowSchemaVersion: 1 }
export interface AuthoringOutcome { workflow?: WorkflowSpec; workflowId?: string; questions: string[]; assumptions: string[]; unsupportedRequirements: string[]; stepConfidence: Array<{ stepId: string; confidence: number; rationale: string }>; metadata: { provider: string; model: string; promptVersion: string }; validationIssues: Array<{ path: string; code: string; message: string }> }
export interface AuthoringJob {
  id: string; status: AuthoringJobStatus; request: AuthoringRequest; provider: string; model: string; promptVersion: string;
  progress: { phase: string; message: string }; attempts: number; validationRetries: number; usage: AuthoringProviderUsage; latencyMs: number;
  createdAt: string; updatedAt: string; startedAt?: string; finishedAt?: string; workflowId?: string; errorCode?: string; result?: AuthoringOutcome;
}
export interface AuthoringJobEvent { id: string; eventType: string; metadata: Record<string, unknown>; createdAt: string }
export interface AuthoringJobStore {
  enqueue(user: AuthenticatedUser, job: AuthoringJob, idempotencyKey: string, requestDigest: string): Promise<{ created: boolean; job: AuthoringJob; requestDigest: string }>;
  find(user: AuthenticatedUser, jobId: string): Promise<AuthoringJob | undefined>;
  events(user: AuthenticatedUser, jobId: string): Promise<AuthoringJobEvent[]>;
  claim(user: AuthenticatedUser, jobId: string): Promise<AuthoringJob | undefined>;
  progress(user: AuthenticatedUser, jobId: string, phase: string, message: string): Promise<boolean>;
  finish(user: AuthenticatedUser, jobId: string, input: { status: "needs-input" | "completed" | "failed"; result?: AuthoringOutcome; workflowId?: string; errorCode?: string; validationRetries: number; usage: AuthoringProviderUsage; latencyMs: number }): Promise<AuthoringJob | undefined>;
  cancel(user: AuthenticatedUser, jobId: string): Promise<AuthoringJob | undefined>;
}

export class AuthoringInputError extends Error {}
export class AuthoringAccessError extends Error {}
export class AuthoringConflictError extends Error {}
export class AuthoringLimitError extends Error {}

export class AuthoringService {
  public constructor(private readonly store: AuthoringJobStore, private readonly provider: AuthoringProvider, private readonly workflows: CanonicalWorkflowService, private readonly capabilities: RuntimeCapabilities = defaultAuthoringCapabilities) {}

  public async enqueue(user: AuthenticatedUser, input: unknown): Promise<{ created: boolean; job: AuthoringJob }> {
    requireAuthor(user);
    const parsed = parseInput(input, this.capabilities);
    const now = new Date().toISOString();
    const job: AuthoringJob = { id: randomUUID(), status: "queued", request: parsed.request, ...this.provider.identity, progress: { phase: "queued", message: "Waiting to analyze the task." }, attempts: 0, validationRetries: 0, usage: zeroUsage(), latencyMs: 0, createdAt: now, updatedAt: now };
    const stored = await this.store.enqueue(user, job, parsed.idempotencyKey, parsed.digest);
    if (!stored.created && stored.requestDigest !== parsed.digest) throw new AuthoringConflictError("That idempotency key was already used for a different authoring request.");
    return { created: stored.created, job: stored.job };
  }
  public find(user: AuthenticatedUser, jobId: string): Promise<AuthoringJob | undefined> { return this.store.find(user, uuid(jobId)); }
  public events(user: AuthenticatedUser, jobId: string): Promise<AuthoringJobEvent[]> { return this.store.events(user, uuid(jobId)); }
  public cancel(user: AuthenticatedUser, jobId: string): Promise<AuthoringJob | undefined> { requireAuthor(user); return this.store.cancel(user, uuid(jobId)); }

  public async process(user: AuthenticatedUser, jobId: string): Promise<AuthoringJob | undefined> {
    requireAuthor(user);
    const claimed = await this.store.claim(user, uuid(jobId));
    if (!claimed) return this.store.find(user, jobId);
    const started = performance.now();
    let validationRetries = 0;
    let usage = zeroUsage();
    let feedback: string[] = [];
    try {
      await this.store.progress(user, jobId, "planning", "Turning the description into a structured workflow candidate.");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const modelStarted = performance.now();
        let generated: AuthoringProviderResult;
        try {
          generated = sanitizeProviderResult(await this.provider.generate({ ...claimed.request, attempt, validationFeedback: feedback }));
          operationalMetrics.increment("doonce_model_requests_total", { provider: generated.metadata.provider, model: generated.metadata.model, outcome: "completed" });
          operationalMetrics.increment("doonce_model_cost_microusd_total", { provider: generated.metadata.provider, model: generated.metadata.model }, generated.usage.estimatedCostMicrousd);
        } catch (error) {
          operationalMetrics.increment("doonce_model_requests_total", { provider: this.provider.identity.provider, model: this.provider.identity.model, outcome: "failed" });
          throw error;
        } finally {
          operationalMetrics.observe("doonce_model_request_duration_seconds", { provider: this.provider.identity.provider, model: this.provider.identity.model }, (performance.now() - modelStarted) / 1000);
        }
        usage = addUsage(usage, generated.usage);
        if (generated.candidate === undefined) {
          const outcome = outcomeFrom(generated, undefined, undefined, []);
          return this.store.finish(user, jobId, { status: "needs-input", result: outcome, validationRetries, usage, latencyMs: elapsed(started) });
        }
        await this.store.progress(user, jobId, "validating", "Checking every generated field against WorkflowSpec v1.");
        const normalized = normalizeAuthoringCandidate(generated.candidate);
        if (!normalized.ok) {
          feedback = normalized.issues.map((issue) => `${issue.path}: ${issue.message}`).slice(0, 50);
          if (attempt === 0) { validationRetries += 1; continue; }
          const outcome = outcomeFrom(generated, undefined, undefined, normalized.issues);
          return this.store.finish(user, jobId, { status: "failed", result: outcome, errorCode: "authoring.validation_failed", validationRetries, usage, latencyMs: elapsed(started) });
        }
        const confidenceIssues = validateStepConfidence(normalized.workflow, generated.stepConfidence);
        if (confidenceIssues.length > 0) {
          feedback = confidenceIssues.map((issue) => `${issue.path}: ${issue.message}`);
          if (attempt === 0) { validationRetries += 1; continue; }
          const outcome = outcomeFrom(generated, undefined, undefined, confidenceIssues);
          return this.store.finish(user, jobId, { status: "failed", result: outcome, errorCode: "authoring.confidence_invalid", validationRetries, usage, latencyMs: elapsed(started) });
        }
        await this.store.progress(user, jobId, "saving", "Saving a reviewable draft without publishing it.");
        const draft = await this.workflows.createDraft(user, normalized.workflow);
        const outcome = outcomeFrom(generated, normalized.workflow, draft.id, []);
        return this.store.finish(user, jobId, { status: "completed", result: outcome, workflowId: draft.id, validationRetries, usage, latencyMs: elapsed(started) });
      }
      throw new Error("Authoring validation loop ended unexpectedly.");
    } catch {
      return this.store.finish(user, jobId, { status: "failed", errorCode: "authoring.provider_failed", validationRetries, usage, latencyMs: elapsed(started) });
    }
  }
}

export const defaultAuthoringCapabilities: RuntimeCapabilities = { schemaVersion: 1, executor: "extension", actions: ["navigate", "wait", "read", "select", "type", "download", "compare", "branch", "ask-approval", "stop"], maxSteps: 500, supportsDownloads: true };

function parseInput(value: unknown, capabilities: RuntimeCapabilities): { request: AuthoringRequest; idempotencyKey: string; digest: string } {
  if (!isRecord(value) || Object.keys(value).some((key) => !["taskDescription", "startingUrl", "availableInputs", "observationSessionId", "idempotencyKey"].includes(key))) throw new AuthoringInputError("The authoring request contains unsupported fields.");
  if (typeof value.taskDescription !== "string" || value.taskDescription.trim().length < 10 || value.taskDescription.trim().length > 5000) throw new AuthoringInputError("Describe the task in 10 to 5,000 characters.");
  const startingUrl = value.startingUrl === undefined || value.startingUrl === "" ? undefined : webUrl(value.startingUrl);
  const availableInputs = inputs(value.availableInputs);
  const observationSessionId = value.observationSessionId === undefined ? undefined : uuid(value.observationSessionId);
  if (typeof value.idempotencyKey !== "string" || !/^[a-zA-Z0-9:._-]{8,200}$/.test(value.idempotencyKey)) throw new AuthoringInputError("Provide a valid authoring idempotency key.");
  const request: AuthoringRequest = { taskDescription: value.taskDescription.trim(), ...(startingUrl ? { startingUrl } : {}), availableInputs, ...(observationSessionId ? { observationSessionId } : {}), executorCapabilities: capabilities, workflowSchemaVersion: 1 };
  return { request, idempotencyKey: value.idempotencyKey, digest: createHash("sha256").update(stableJson(request)).digest("hex") };
}
function inputs(value: unknown): WorkflowInputDefinition[] { if (value === undefined) return []; if (!Array.isArray(value) || value.length > 50) throw new AuthoringInputError("Provide at most 50 workflow inputs."); return value.map((item) => { const result = validateProtocolContract<WorkflowInputDefinition>("WorkflowInputDefinition", item); if (!result.ok) throw new AuthoringInputError("One or more workflow inputs are invalid."); return result.value; }); }
function sanitizeProviderResult(result: AuthoringProviderResult): AuthoringProviderResult {
  const metadata = [result.metadata.provider, result.metadata.model, result.metadata.promptVersion];
  const lists = [result.questions, result.assumptions, result.unsupportedRequirements];
  const usage = [result.usage.promptTokens, result.usage.completionTokens, result.usage.estimatedCostMicrousd];
  if (metadata.some((value) => typeof value !== "string" || value.length < 1 || value.length > 200) || lists.some((list) => !Array.isArray(list) || list.length > 50 || list.some((value) => typeof value !== "string" || value.length < 1 || value.length > 1000)) || !Array.isArray(result.stepConfidence) || result.stepConfidence.length > 500 || result.stepConfidence.some((item) => !item || typeof item.stepId !== "string" || typeof item.rationale !== "string" || item.rationale.length < 1 || item.rationale.length > 1000 || typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) || usage.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 100_000_000_000)) throw new Error("Provider result exceeds authoring bounds.");
  return structuredClone(result);
}
function validateStepConfidence(workflow: WorkflowSpec, confidence: AuthoringProviderResult["stepConfidence"]): Array<{ path: string; code: string; message: string }> {
  const expected = new Set(workflow.steps.map((step) => step.id)); const observed = new Set<string>(); const issues: Array<{ path: string; code: string; message: string }> = [];
  for (const [index, item] of confidence.entries()) { if (!expected.has(item.stepId)) issues.push({ path: `/stepConfidence/${index}/stepId`, code: "authoring.confidence_unknown_step", message: "Confidence must reference a generated workflow step." }); if (observed.has(item.stepId)) issues.push({ path: `/stepConfidence/${index}/stepId`, code: "authoring.confidence_duplicate", message: "Each step needs one confidence entry." }); observed.add(item.stepId); }
  for (const [index, step] of workflow.steps.entries()) if (!observed.has(step.id)) issues.push({ path: `/steps/${index}`, code: "authoring.confidence_missing", message: "Every generated step needs a confidence score and rationale." });
  return issues;
}
function outcomeFrom(result: AuthoringProviderResult, workflow: WorkflowSpec | undefined, workflowId: string | undefined, issues: ReadonlyArray<{ path: string; code: string; message: string }>): AuthoringOutcome { return { ...(workflow ? { workflow } : {}), ...(workflowId ? { workflowId } : {}), questions: result.questions, assumptions: result.assumptions, unsupportedRequirements: result.unsupportedRequirements, stepConfidence: result.stepConfidence, metadata: result.metadata, validationIssues: issues.map(({ path, code, message }) => ({ path, code, message })) }; }
function zeroUsage(): AuthoringProviderUsage { return { promptTokens: 0, completionTokens: 0, estimatedCostMicrousd: 0 }; }
function addUsage(left: AuthoringProviderUsage, right: AuthoringProviderUsage): AuthoringProviderUsage { return { promptTokens: left.promptTokens + right.promptTokens, completionTokens: left.completionTokens + right.completionTokens, estimatedCostMicrousd: left.estimatedCostMicrousd + right.estimatedCostMicrousd }; }
function elapsed(started: number): number { return Math.max(0, Math.round(performance.now() - started)); }
function webUrl(value: unknown): string { if (typeof value !== "string" || value.length > 2048) throw new AuthoringInputError("The starting URL is invalid."); let parsed: URL; try { parsed = new URL(value); } catch { throw new AuthoringInputError("The starting URL is invalid."); } if (parsed.username || parsed.password || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)))) throw new AuthoringInputError("Use an HTTPS starting URL or an explicit local development URL."); parsed.hash = ""; return parsed.toString(); }
function uuid(value: unknown): string { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AuthoringInputError("The authoring identifier is invalid."); return value.toLowerCase(); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireAuthor(user: AuthenticatedUser): void { if (user.role !== "owner" && user.role !== "builder") throw new AuthoringAccessError("This role cannot create workflows from text."); }
