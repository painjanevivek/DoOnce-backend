import { randomUUID } from "node:crypto";
import type { AuthenticatedUser, MembershipRole } from "../auth/auth-service.js";
import type { WorkflowSpec } from "../contracts/protocol.js";
import { formatValidationIssues, validateProtocolContract } from "../contracts/validation.js";

export interface CanonicalWorkflowDraft {
  id: string;
  version: number;
  status: "draft";
  spec: WorkflowSpec;
  checksum: string;
}

export interface CanonicalWorkflowStore {
  createDraft(user: AuthenticatedUser, workflowId: string, spec: WorkflowSpec): Promise<CanonicalWorkflowDraft>;
  findDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowDraft | undefined>;
}

export class CanonicalWorkflowInputError extends Error {}
export class CanonicalWorkflowAccessError extends Error {}

export class CanonicalWorkflowService {
  public constructor(private readonly store: CanonicalWorkflowStore) {}

  public async createDraft(user: AuthenticatedUser, input: unknown): Promise<CanonicalWorkflowDraft> {
    requireAuthor(user.role);
    const validation = validateProtocolContract<WorkflowSpec>("WorkflowSpec", input);
    if (!validation.ok) throw new CanonicalWorkflowInputError(formatValidationIssues(validation.errors).join(" "));
    return this.store.createDraft(user, randomUUID(), immutableSpec(validation.value));
  }

  public async findDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowDraft | undefined> {
    const draft = await this.store.findDraft(user, workflowId);
    if (!draft) return undefined;
    const validation = validateProtocolContract<WorkflowSpec>("WorkflowSpec", draft.spec);
    if (!validation.ok) throw new CanonicalWorkflowInputError("Stored workflow data does not match its schema version.");
    return { ...draft, spec: immutableSpec(validation.value) };
  }
}

function requireAuthor(role: MembershipRole): void {
  if (role !== "owner" && role !== "builder") throw new CanonicalWorkflowAccessError("This role cannot create workflow drafts.");
}

function immutableSpec(spec: WorkflowSpec): WorkflowSpec {
  return deepFreeze(structuredClone(spec));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
