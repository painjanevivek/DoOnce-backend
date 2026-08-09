import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AuthenticatedUser, MembershipRole } from "../auth/auth-service.js";
import type { ExecutorKind, RunRequest, RunResult, StepResult, WorkflowSpec } from "../contracts/protocol.js";
import { validateProtocolContract } from "../contracts/validation.js";
import { ExecutionRoutingError, routeExecution, type SessionLocation, type TriggerKind } from "../triggers/execution-router.js";
import { operationalMetrics } from "../observability/metrics.js";

export type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface ExecutionRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  workflowChecksum: string;
  mode: "test" | "production";
  status: RunStatus;
  executor: ExecutorKind;
  triggerKind: TriggerKind;
  sessionProfileId?: string;
  queueJobId?: string;
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequested: boolean;
  currentStepIndex: number;
  stepResults: StepResult[];
  extensionVersion?: string;
  leaseExpiresAt?: string;
  result?: RunResult;
}

export interface PublishedWorkflow { workflowId: string; version: number; checksum: string; status: "draft" | "active"; spec: WorkflowSpec }
export interface ClaimedRun { run: ExecutionRun; request: RunRequest; workflow: WorkflowSpec; checkpoint?: RunCheckpoint; leaseToken: string; leaseExpiresAt: string }
export interface RunCheckpoint { currentStepIndex: number; stepResults: StepResult[]; variables: Record<string, string>; observedUrl?: string; inFlightStepId?: string }
export interface RunTimelineEvent { id: string; eventType: string; stepId?: string; metadata: Record<string, unknown>; createdAt: string }
export interface RunTimelineArtifact { id: string; stepId?: string; retentionClass: string; fileName: string; contentType: string; byteSize: number; checksumSha256: string; createdAt: string }
export interface RunTimeline { run: ExecutionRun; steps: StepResult[]; events: RunTimelineEvent[]; artifacts: RunTimelineArtifact[] }

export interface RunStore {
  findExecutable(user: AuthenticatedUser, workflowId: string, mode: "test" | "production"): Promise<PublishedWorkflow | undefined>;
  create(user: AuthenticatedUser, request: RunRequest, workflow: PublishedWorkflow, idempotencyKey: string, requestDigest: string, metadata?: RunCreationMetadata): Promise<{ created: boolean; run: ExecutionRun; requestDigest: string }>;
  list(user: AuthenticatedUser, limit: number): Promise<ExecutionRun[]>;
  find(user: AuthenticatedUser, runId: string): Promise<ExecutionRun | undefined>;
  timeline(user: AuthenticatedUser, runId: string): Promise<RunTimeline | undefined>;
  claim(user: AuthenticatedUser, input: { extensionVersion: string; capabilities: string[]; leaseTokenHash: string; leaseExpiresAt: string }): Promise<{ run: ExecutionRun; request: RunRequest; workflow: WorkflowSpec; checkpoint?: RunCheckpoint } | undefined>;
  claimHosted?(user: AuthenticatedUser, input: { runId: string; executorVersion: string; leaseTokenHash: string; leaseExpiresAt: string }): Promise<{ run: ExecutionRun; request: RunRequest; workflow: WorkflowSpec; checkpoint?: RunCheckpoint } | undefined>;
  attachQueueJob?(user: AuthenticatedUser, runId: string, queueJobId: string): Promise<void>;
  heartbeat(user: AuthenticatedUser, runId: string, leaseTokenHash: string, leaseExpiresAt: string): Promise<ExecutionRun | undefined>;
  checkpoint(user: AuthenticatedUser, runId: string, leaseTokenHash: string, checkpoint: RunCheckpoint, leaseExpiresAt: string): Promise<ExecutionRun | undefined>;
  finish(user: AuthenticatedUser, runId: string, leaseTokenHash: string, result: RunResult): Promise<ExecutionRun | undefined>;
  cancel(user: AuthenticatedUser, runId: string): Promise<ExecutionRun | undefined>;
}

export interface RunCreationMetadata {
  triggerKind: TriggerKind;
  sessionLocation: SessionLocation;
  sessionProfileId?: string;
}

export interface RunDispatcher {
  dispatch(user: AuthenticatedUser, run: ExecutionRun): Promise<string>;
  cancel?(run: ExecutionRun): Promise<boolean>;
}

export class RunInputError extends Error {}
export class RunAccessError extends Error {}
export class RunConflictError extends Error {}

export class RunService {
  public constructor(
    private readonly store: RunStore,
    private readonly leaseMs = 45_000,
    private readonly dispatcher?: RunDispatcher,
  ) {
    if (!Number.isInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 300_000) throw new Error("Run lease must be between 10 seconds and 5 minutes.");
  }

  public async create(user: AuthenticatedUser, input: unknown): Promise<{ created: boolean; run: ExecutionRun }> {
    requireRunRole(user.role);
    const parsed = parseCreateInput(input);
    const executable = await this.store.findExecutable(user, parsed.workflowId, parsed.mode);
    if (!executable) throw new RunInputError(parsed.mode === "test" ? "An editable workflow draft is required before starting a test run." : "A published workflow version is required before starting a run.");
    const inputs = resolveInputs(executable.spec, parsed.inputs);
    let route;
    try {
      route = routeExecution(executable.spec, parsed);
    } catch (error) {
      if (error instanceof ExecutionRoutingError) throw new RunInputError(error.message);
      throw error;
    }
    if (route.executor === "hosted-browser" && !parsed.sessionProfileId) {
      throw new RunInputError("Managed execution requires a browser session profile.");
    }
    if (route.executor === "extension" && parsed.sessionProfileId) {
      throw new RunInputError("A managed browser session cannot be attached to a local extension run.");
    }
    const requestedAt = new Date().toISOString();
    const request: RunRequest = { schemaVersion: 1, runId: randomUUID(), workflowId: executable.workflowId, workflowVersion: executable.version, executor: route.executor, inputs, requestedAt };
    const metadata: RunCreationMetadata = {
      triggerKind: route.triggerKind,
      sessionLocation: route.sessionLocation,
      ...(parsed.sessionProfileId ? { sessionProfileId: parsed.sessionProfileId } : {}),
    };
    const requestDigest = digest({ workflowId: request.workflowId, workflowVersion: request.workflowVersion, workflowChecksum: executable.checksum, mode: parsed.mode, executor: request.executor, triggerKind: route.triggerKind, sessionProfileId: parsed.sessionProfileId, inputs });
    const stored = await this.store.create(user, request, executable, parsed.idempotencyKey, requestDigest, metadata);
    if (!stored.created && stored.requestDigest !== requestDigest) throw new RunConflictError("This idempotency key was already used for a different run request.");
    if (stored.created && stored.run.executor === "hosted-browser" && this.dispatcher) {
      const queueJobId = await this.dispatcher.dispatch(user, stored.run);
      await this.store.attachQueueJob?.(user, stored.run.id, queueJobId);
    }
    return { created: stored.created, run: stored.run };
  }

  public list(user: AuthenticatedUser, limit = 50): Promise<ExecutionRun[]> {
    return this.store.list(user, Math.min(Math.max(limit, 1), 100));
  }

  public find(user: AuthenticatedUser, runId: string): Promise<ExecutionRun | undefined> { return this.store.find(user, requireUuid(runId)); }
  public timeline(user: AuthenticatedUser, runId: string): Promise<RunTimeline | undefined> { return this.store.timeline(user, requireUuid(runId)); }

  public async claim(user: AuthenticatedUser, input: unknown): Promise<ClaimedRun | undefined> {
    const parsed = parseClaimInput(input);
    const leaseToken = randomBytes(32).toString("base64url");
    const leaseExpiresAt = new Date(Date.now() + this.leaseMs).toISOString();
    const claimed = await this.store.claim(user, { ...parsed, leaseTokenHash: hashLease(leaseToken), leaseExpiresAt });
    return claimed ? { ...claimed, leaseToken, leaseExpiresAt } : undefined;
  }

  public async claimHosted(user: AuthenticatedUser, runId: string, executorVersion: string): Promise<ClaimedRun | undefined> {
    if (!this.store.claimHosted) throw new Error("Hosted execution is not configured.");
    if (!/^\d+\.\d+\.\d+$/.test(executorVersion)) throw new RunInputError("Hosted executor version is invalid.");
    const leaseToken = randomBytes(32).toString("base64url");
    const leaseExpiresAt = new Date(Date.now() + this.leaseMs).toISOString();
    const claimed = await this.store.claimHosted(user, {
      runId: requireUuid(runId),
      executorVersion,
      leaseTokenHash: hashLease(leaseToken),
      leaseExpiresAt,
    });
    return claimed ? { ...claimed, leaseToken, leaseExpiresAt } : undefined;
  }

  public heartbeat(user: AuthenticatedUser, runId: string, leaseToken: unknown): Promise<ExecutionRun | undefined> {
    return this.store.heartbeat(user, requireUuid(runId), hashLease(requireLeaseToken(leaseToken)), new Date(Date.now() + this.leaseMs).toISOString());
  }

  public checkpoint(user: AuthenticatedUser, runId: string, input: unknown): Promise<ExecutionRun | undefined> {
    const parsed = parseCheckpointInput(input);
    return this.store.checkpoint(user, requireUuid(runId), hashLease(parsed.leaseToken), parsed.checkpoint, new Date(Date.now() + this.leaseMs).toISOString());
  }

  public async finish(user: AuthenticatedUser, runId: string, input: unknown): Promise<ExecutionRun | undefined> {
    if (!isRecord(input)) throw new RunInputError("A run result and lease token are required.");
    const leaseToken = requireLeaseToken(input.leaseToken);
    const validation = validateProtocolContract<RunResult>("RunResult", input.result);
    if (!validation.ok || validation.value.runId !== runId) throw new RunInputError("The run result is invalid or belongs to another run.");
    const existing = await this.store.find(user, requireUuid(runId));
    if (!existing || validation.value.workflowId !== existing.workflowId || validation.value.workflowVersion !== existing.workflowVersion) throw new RunInputError("The run result does not match its leased workflow version.");
    if (existing.result) {
      if (isDeepStrictEqual(existing.result, validation.value)) return existing;
      throw new RunConflictError("This run already has a different terminal result.");
    }
    const result = existing.cancelRequested ? { ...validation.value, status: "cancelled" as const, reasonCode: "run.cancelled" } : validation.value;
    const finished = await this.store.finish(user, runId, hashLease(leaseToken), structuredClone(result));
    if (finished) {
      operationalMetrics.increment("doonce_run_results_total", { executor: existing.executor, status: result.status });
      operationalMetrics.observe("doonce_run_duration_seconds", { executor: existing.executor }, Math.max(0, new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime()) / 1000);
      for (const step of result.stepResults) {
        if (step.reasonCode?.startsWith("locator.")) operationalMetrics.increment("doonce_locator_failures_total", { executor: existing.executor, code: step.reasonCode });
        if (step.reasonCode?.startsWith("assertion.") || step.assertionResults?.some(({ status }) => status === "failed")) operationalMetrics.increment("doonce_verification_failures_total", { executor: existing.executor, code: step.reasonCode ?? "verification.failed" });
      }
    }
    return finished;
  }

  public async cancel(user: AuthenticatedUser, runId: string): Promise<ExecutionRun | undefined> {
    requireRunRole(user.role);
    const id = requireUuid(runId);
    const existing = await this.store.find(user, id);
    const cancelled = await this.store.cancel(user, id);
    if (existing?.executor === "hosted-browser" && existing.queueJobId) await this.dispatcher?.cancel?.(existing);
    return cancelled;
  }
}

function parseCreateInput(value: unknown): { workflowId: string; inputs: Record<string, string>; idempotencyKey: string; mode: "test" | "production"; triggerKind: TriggerKind; sessionLocation: SessionLocation; sessionProfileId?: string } {
  if (!isRecord(value) || Object.keys(value).some((key) => !["workflowId", "inputs", "idempotencyKey", "mode", "triggerKind", "sessionLocation", "sessionProfileId"].includes(key))) throw new RunInputError("The run request is invalid.");
  const workflowId = requireUuid(value.workflowId);
  if (!isRecord(value.inputs) || !Object.values(value.inputs).every((item) => typeof item === "string" && item.length <= 10_000)) throw new RunInputError("Run inputs must be text values.");
  if (typeof value.idempotencyKey !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(value.idempotencyKey)) throw new RunInputError("Provide a valid idempotency key.");
  if (value.mode !== undefined && value.mode !== "test" && value.mode !== "production") throw new RunInputError("Run mode must be test or production.");
  if (value.triggerKind !== undefined && !["manual", "api", "webhook", "schedule"].includes(String(value.triggerKind))) throw new RunInputError("Run trigger kind is invalid.");
  if (value.sessionLocation !== undefined && value.sessionLocation !== "user-browser" && value.sessionLocation !== "managed") throw new RunInputError("Session location is invalid.");
  const triggerKind = (value.triggerKind ?? "manual") as TriggerKind;
  const sessionLocation = (value.sessionLocation ?? "user-browser") as SessionLocation;
  const sessionProfileId = value.sessionProfileId === undefined ? undefined : requireUuid(value.sessionProfileId);
  return { workflowId, inputs: value.inputs as Record<string, string>, idempotencyKey: value.idempotencyKey, mode: value.mode === "test" ? "test" : "production", triggerKind, sessionLocation, ...(sessionProfileId ? { sessionProfileId } : {}) };
}

function resolveInputs(spec: WorkflowSpec, supplied: Record<string, string>): Record<string, string> {
  const declared = new Map(spec.inputs.map((input) => [input.name, input]));
  const unknown = Object.keys(supplied).find((name) => !declared.has(name));
  if (unknown) throw new RunInputError(`Unknown workflow input: ${unknown}.`);
  const resolved: Record<string, string> = {};
  for (const definition of spec.inputs) {
    const value = supplied[definition.name] ?? definition.defaultValue;
    if (definition.required && !value) throw new RunInputError(`${definition.label} is required.`);
    if (value !== undefined) {
      if (definition.kind === "select" && !definition.options?.includes(value)) throw new RunInputError(`${definition.label} must use one of its configured options.`);
      resolved[definition.name] = value;
    }
  }
  return resolved;
}

function parseClaimInput(value: unknown): { extensionVersion: string; capabilities: string[] } {
  if (!isRecord(value) || typeof value.extensionVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(value.extensionVersion) || !Array.isArray(value.capabilities)) throw new RunInputError("Extension capabilities are invalid.");
  const capabilities = value.capabilities.filter((item): item is string => typeof item === "string");
  if (capabilities.length !== value.capabilities.length || capabilities.length > 32 || !capabilities.includes("workflow-spec-v1")) throw new RunInputError("The extension cannot execute WorkflowSpec v1.");
  return { extensionVersion: value.extensionVersion, capabilities };
}

function parseCheckpointInput(value: unknown): { leaseToken: string; checkpoint: RunCheckpoint } {
  if (!isRecord(value) || !isRecord(value.checkpoint)) throw new RunInputError("A checkpoint and lease token are required.");
  const checkpoint = value.checkpoint;
  if (!Number.isInteger(checkpoint.currentStepIndex) || Number(checkpoint.currentStepIndex) < 0 || Number(checkpoint.currentStepIndex) > 1000 || !Array.isArray(checkpoint.stepResults) || checkpoint.stepResults.length > 1000 || !isRecord(checkpoint.variables)) throw new RunInputError("The run checkpoint is invalid.");
  if (!checkpoint.stepResults.every((result) => validateProtocolContract<StepResult>("StepResult", result).ok)) throw new RunInputError("The run checkpoint contains an invalid step result.");
  if (!Object.values(checkpoint.variables).every((item) => typeof item === "string" && item.length <= 10_000) || (checkpoint.observedUrl !== undefined && (typeof checkpoint.observedUrl !== "string" || checkpoint.observedUrl.length > 2048))) throw new RunInputError("The run checkpoint contains invalid values.");
  if (checkpoint.inFlightStepId !== undefined) requireUuid(checkpoint.inFlightStepId);
  return { leaseToken: requireLeaseToken(value.leaseToken), checkpoint: checkpoint as unknown as RunCheckpoint };
}

function requireRunRole(role: MembershipRole): void { if (role === "reviewer") throw new RunAccessError("This role cannot start or cancel runs."); }
function requireUuid(value: unknown): string { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new RunInputError("A valid identifier is required."); return value; }
function requireLeaseToken(value: unknown): string { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{40,64}$/.test(value)) throw new RunInputError("The run lease token is invalid."); return value; }
function hashLease(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
