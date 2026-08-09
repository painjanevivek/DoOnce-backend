import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AuthenticatedUser, MembershipRole } from "../auth/auth-service.js";
import type { WorkflowCompilation, WorkflowSpec } from "../contracts/protocol.js";
import { formatValidationIssues, validateProtocolContract, type ValidationIssue } from "../contracts/validation.js";
import { isCaptureCompilerVersionCompatible } from "../compiler/capture-workflow-compiler.js";
import { evaluateActionCapabilities } from "../execution/action-capabilities.js";

export interface CanonicalWorkflowDraft {
  id: string;
  version: number;
  status: "draft";
  spec: WorkflowSpec;
  checksum: string;
  testEvidenceVerified?: boolean;
  metadata?: CanonicalWorkflowDraftMetadata;
}

export interface CanonicalWorkflowDraftMetadata {
  source: "capture" | "editor";
  captureSessionId: string;
  compilerVersion: string;
  sourceDigest: string;
  compilation: WorkflowCompilation;
}

export interface CanonicalWorkflowSummary {
  id: string;
  title: string;
  activeVersion: number | null;
  draftVersion: number | null;
  status: "draft" | "active" | "archived";
  updatedAt: string;
  lastRunAt: string | null;
  successRate: number | null;
}

export interface CanonicalWorkflowVersion {
  id: string;
  version: number;
  status: "draft" | "active" | "archived";
  spec: WorkflowSpec;
  checksum: string;
  testEvidenceRunId: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export type CanonicalDraftMutationResult = { status: "updated"; draft: CanonicalWorkflowDraft } | { status: "conflict"; draft: CanonicalWorkflowDraft } | { status: "missing" };
export type CanonicalNextDraftResult = { status: "created" | "exists"; draft: CanonicalWorkflowDraft } | { status: "missing" };
export type CanonicalPublishResult = { status: "published"; version: CanonicalWorkflowVersion } | { status: "conflict"; draft: CanonicalWorkflowDraft } | { status: "missing" };

export interface CanonicalWorkflowStore {
  createDraft(user: AuthenticatedUser, workflowId: string, spec: WorkflowSpec, metadata?: CanonicalWorkflowDraftMetadata): Promise<CanonicalWorkflowDraft>;
  findDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowDraft | undefined>;
  listWorkflows(user: AuthenticatedUser): Promise<CanonicalWorkflowSummary[]>;
  listVersions(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowVersion[]>;
  updateDraft(user: AuthenticatedUser, workflowId: string, expectedChecksum: string, spec: WorkflowSpec): Promise<CanonicalDraftMutationResult>;
  createNextDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalNextDraftResult>;
  hasPassingTestEvidence(user: AuthenticatedUser, workflowId: string, version: number, checksum: string): Promise<boolean>;
  publishDraft(user: AuthenticatedUser, workflowId: string, expectedChecksum: string): Promise<CanonicalPublishResult>;
}

export class CanonicalWorkflowInputError extends Error {
  public constructor(message: string, public readonly issues: readonly ValidationIssue[] = []) { super(message); }
}
export class CanonicalWorkflowAccessError extends Error {}

export class CanonicalWorkflowService {
  public constructor(private readonly store: CanonicalWorkflowStore) {}

  public async createDraft(user: AuthenticatedUser, input: unknown, metadata?: CanonicalWorkflowDraftMetadata): Promise<CanonicalWorkflowDraft> {
    requireAuthor(user.role);
    const validation = validateProtocolContract<WorkflowSpec>("WorkflowSpec", input);
    if (!validation.ok) throw new CanonicalWorkflowInputError(formatValidationIssues(validation.errors).join(" "));
    const spec = immutableSpec(validation.value);
    const immutableMetadata = metadata ? validateMetadata(metadata, spec) : undefined;
    return this.store.createDraft(user, randomUUID(), spec, immutableMetadata);
  }

  public async findDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowDraft | undefined> {
    const draft = await this.store.findDraft(user, workflowId);
    if (!draft) return undefined;
    const validation = validateProtocolContract<WorkflowSpec>("WorkflowSpec", draft.spec);
    if (!validation.ok) throw new CanonicalWorkflowInputError("Stored workflow data does not match its schema version.");
    const testEvidenceVerified = await this.store.hasPassingTestEvidence(user, workflowId, draft.version, draft.checksum);
    return { ...draft, testEvidenceVerified, spec: immutableSpec(validation.value), ...(draft.metadata ? { metadata: validateMetadata(draft.metadata, validation.value) } : {}) };
  }

  public listWorkflows(user: AuthenticatedUser): Promise<CanonicalWorkflowSummary[]> { return this.store.listWorkflows(user); }

  public async listVersions(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowVersion[]> {
    const versions = await this.store.listVersions(user, workflowId);
    return versions.map((version) => {
      const validation = validateProtocolContract<WorkflowSpec>("WorkflowSpec", version.spec);
      if (!validation.ok) throw new CanonicalWorkflowInputError("Stored workflow history contains invalid data.");
      return { ...version, spec: immutableSpec(validation.value) };
    });
  }

  public async updateDraft(user: AuthenticatedUser, workflowId: string, expectedChecksum: string, input: unknown): Promise<CanonicalDraftMutationResult> {
    requireAuthor(user.role);
    const validation = validateProtocolContract<WorkflowSpec>("WorkflowSpec", input);
    if (!validation.ok) throw new CanonicalWorkflowInputError("The workflow has validation errors.", validation.errors);
    const result = await this.store.updateDraft(user, workflowId, expectedChecksum, immutableSpec(validation.value));
    return result.status === "updated" || result.status === "conflict" ? { ...result, draft: immutableDraft(result.draft) } : result;
  }

  public async createNextDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalNextDraftResult> {
    requireAuthor(user.role);
    const result = await this.store.createNextDraft(user, workflowId);
    return result.status === "missing" ? result : { ...result, draft: immutableDraft(result.draft) };
  }

  public async publishDraft(user: AuthenticatedUser, workflowId: string, expectedChecksum: string): Promise<CanonicalPublishResult> {
    requireAuthor(user.role);
    const draft = await this.findDraft(user, workflowId);
    if (!draft) return { status: "missing" };
    if (draft.checksum !== expectedChecksum) return { status: "conflict", draft };
    const validation = validateProtocolContract<WorkflowSpec>("WorkflowSpec", draft.spec);
    if (!validation.ok) throw new CanonicalWorkflowInputError("Invalid workflows cannot be published.", validation.errors);
    if (!draft.testEvidenceVerified) throw new CanonicalWorkflowInputError("Run this exact saved draft successfully in test mode before publishing.");
    const result = await this.store.publishDraft(user, workflowId, expectedChecksum);
    return result.status === "published" ? { ...result, version: { ...result.version, spec: immutableSpec(result.version.spec) } } : result;
  }

  public async previewTest(user: AuthenticatedUser, workflowId: string, input: unknown): Promise<CanonicalWorkflowTestPreview | undefined> {
    const draft = await this.findDraft(user, workflowId);
    if (!draft) return undefined;
    if (!isTestInput(input)) throw new CanonicalWorkflowInputError("Choose a supported runtime and provide workflow inputs as text values.");
    const declared = new Map(draft.spec.inputs.map((definition) => [definition.name, definition]));
    const unknown = Object.keys(input.inputs).filter((name) => !declared.has(name));
    if (unknown.length > 0) throw new CanonicalWorkflowInputError(`Unknown workflow input: ${unknown[0]}.`);
    for (const definition of declared.values()) {
      const value = input.inputs[definition.name] ?? definition.defaultValue;
      if (definition.required && !value) throw new CanonicalWorkflowInputError(`${definition.label} is required for test mode.`);
      if (definition.kind === "select" && value !== undefined && !definition.options?.includes(value)) throw new CanonicalWorkflowInputError(`${definition.label} must use one of its configured options.`);
    }
    return {
      workflowId,
      version: draft.version,
      checksum: draft.checksum,
      executor: input.executor,
      status: "ready",
      inputs: draft.spec.inputs.map((definition) => ({ name: definition.name, provided: Boolean(input.inputs[definition.name] ?? definition.defaultValue), secret: definition.secret === true })),
      steps: draft.spec.steps.map((step) => {
        const decision = evaluateActionCapabilities({ action: step.action });
        return { id: step.id, name: step.name, action: step.action, readiness: decision.verdict === "allow" ? "ready" as const : decision.verdict === "needs-approval" ? "approval-required" as const : "checkpoint" as const, message: decision.reason };
      }),
    };
  }
}

export interface CanonicalWorkflowTestPreview {
  workflowId: string;
  version: number;
  checksum: string;
  executor: "extension" | "hosted-browser";
  status: "ready";
  inputs: Array<{ name: string; provided: boolean; secret: boolean }>;
  steps: Array<{ id: string; name: string; action: string; readiness: "ready" | "approval-required" | "checkpoint"; message: string }>;
}

function requireAuthor(role: MembershipRole): void {
  if (role !== "owner" && role !== "builder") throw new CanonicalWorkflowAccessError("This role cannot create workflow drafts.");
}

function immutableSpec(spec: WorkflowSpec): WorkflowSpec {
  return deepFreeze(structuredClone(spec));
}

function immutableDraft(draft: CanonicalWorkflowDraft): CanonicalWorkflowDraft {
  return deepFreeze(structuredClone(draft));
}

function isTestInput(input: unknown): input is { executor: "extension" | "hosted-browser"; inputs: Record<string, string> } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "executor" && key !== "inputs")) return false;
  if ((record.executor !== "extension" && record.executor !== "hosted-browser") || !record.inputs || typeof record.inputs !== "object" || Array.isArray(record.inputs)) return false;
  return Object.values(record.inputs as Record<string, unknown>).every((value) => typeof value === "string" && value.length <= 1000);
}

function validateMetadata(metadata: CanonicalWorkflowDraftMetadata, spec: WorkflowSpec): CanonicalWorkflowDraftMetadata {
  const validation = validateProtocolContract<WorkflowCompilation>("WorkflowCompilation", metadata.compilation);
  if (!validation.ok) throw new CanonicalWorkflowInputError("Workflow compilation metadata is invalid.");
  const compilation = validation.value;
  if (!isCaptureCompilerVersionCompatible(compilation.compilerVersion)) throw new CanonicalWorkflowInputError("Workflow compilation uses an incompatible compiler version.");
  if ((metadata.source !== "capture" && metadata.source !== "editor") || metadata.captureSessionId !== compilation.captureSessionId || metadata.compilerVersion !== compilation.compilerVersion || metadata.sourceDigest !== compilation.sourceDigest) throw new CanonicalWorkflowInputError("Workflow compilation metadata is inconsistent.");
  if (metadata.source === "capture" && !isDeepStrictEqual(compilation.workflow, spec)) throw new CanonicalWorkflowInputError("Compiled workflow metadata does not match the draft.");
  return deepFreeze(structuredClone(metadata));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
