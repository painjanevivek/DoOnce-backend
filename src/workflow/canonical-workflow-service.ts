import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AuthenticatedUser, MembershipRole } from "../auth/auth-service.js";
import type { WorkflowCompilation, WorkflowSpec } from "../contracts/protocol.js";
import { formatValidationIssues, validateProtocolContract } from "../contracts/validation.js";
import { isCaptureCompilerVersionCompatible } from "../compiler/capture-workflow-compiler.js";

export interface CanonicalWorkflowDraft {
  id: string;
  version: number;
  status: "draft";
  spec: WorkflowSpec;
  checksum: string;
  metadata?: CanonicalWorkflowDraftMetadata;
}

export interface CanonicalWorkflowDraftMetadata {
  source: "capture";
  captureSessionId: string;
  compilerVersion: string;
  sourceDigest: string;
  compilation: WorkflowCompilation;
}

export interface CanonicalWorkflowStore {
  createDraft(user: AuthenticatedUser, workflowId: string, spec: WorkflowSpec, metadata?: CanonicalWorkflowDraftMetadata): Promise<CanonicalWorkflowDraft>;
  findDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowDraft | undefined>;
}

export class CanonicalWorkflowInputError extends Error {}
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
    return { ...draft, spec: immutableSpec(validation.value), ...(draft.metadata ? { metadata: validateMetadata(draft.metadata, validation.value) } : {}) };
  }
}

function requireAuthor(role: MembershipRole): void {
  if (role !== "owner" && role !== "builder") throw new CanonicalWorkflowAccessError("This role cannot create workflow drafts.");
}

function immutableSpec(spec: WorkflowSpec): WorkflowSpec {
  return deepFreeze(structuredClone(spec));
}

function validateMetadata(metadata: CanonicalWorkflowDraftMetadata, spec: WorkflowSpec): CanonicalWorkflowDraftMetadata {
  const validation = validateProtocolContract<WorkflowCompilation>("WorkflowCompilation", metadata.compilation);
  if (!validation.ok) throw new CanonicalWorkflowInputError("Workflow compilation metadata is invalid.");
  const compilation = validation.value;
  if (!isCaptureCompilerVersionCompatible(compilation.compilerVersion)) throw new CanonicalWorkflowInputError("Workflow compilation uses an incompatible compiler version.");
  if (metadata.source !== "capture" || metadata.captureSessionId !== compilation.captureSessionId || metadata.compilerVersion !== compilation.compilerVersion || metadata.sourceDigest !== compilation.sourceDigest) throw new CanonicalWorkflowInputError("Workflow compilation metadata is inconsistent.");
  if (!isDeepStrictEqual(compilation.workflow, spec)) throw new CanonicalWorkflowInputError("Compiled workflow metadata does not match the draft.");
  return deepFreeze(structuredClone(metadata));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
