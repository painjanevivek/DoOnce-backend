import { randomUUID } from "node:crypto";
import type { AuthenticatedUser, MembershipRole } from "../auth/auth-service.js";
import { publishWorkflowDraft, type PublishedWorkflowVersion } from "./versioning.js";
import { validateWorkflowDraft, type WorkflowDraft } from "./schema.js";

export interface WorkflowSummary {
  id: string;
  title: string;
  activeVersion: number | null;
  updatedAt: string;
}

export interface WorkflowAuditEvent {
  id: string;
  workflowId: string;
  version: number;
  eventType: "workflow.draft_created" | "workflow.policy_previewed" | "workflow.published";
  createdAt: string;
}

export interface WorkflowReview {
  id: string;
  title: string;
  version: number;
  status: "draft" | "active";
  allowedDomains: string[];
  steps: WorkflowDraft["steps"];
}

export interface WorkflowStore {
  createDraft(draft: WorkflowDraft): Promise<void>;
  listWorkflows(user: AuthenticatedUser): Promise<WorkflowSummary[]>;
  findDraft(id: string, user: AuthenticatedUser): Promise<WorkflowDraft | undefined>;
  markPolicyPreviewed(id: string, user: AuthenticatedUser, previewedAt: string): Promise<WorkflowDraft | undefined>;
  activate(draft: PublishedWorkflowVersion, user: AuthenticatedUser): Promise<void>;
  listAuditEvents(workflowId: string, user: AuthenticatedUser): Promise<WorkflowAuditEvent[]>;
}

export class WorkflowInputError extends Error {}
export class WorkflowAccessError extends Error {}

export class WorkflowService {
  public constructor(private readonly store: WorkflowStore) {}

  public async createDraft(user: AuthenticatedUser, input: unknown): Promise<WorkflowDraft> {
    requireWorkflowAuthor(user.role);
    if (!isRecord(input)) throw new WorkflowInputError("Workflow input must be an object.");
    const draftInput = {
      ...input,
      id: randomUUID(),
      version: 1,
      tenantId: user.tenantId,
      ownerId: user.userId,
    };
    const validation = validateWorkflowDraft(draftInput);
    if (!validation.ok) throw new WorkflowInputError(validation.errors.join(" "));
    await this.store.createDraft(validation.value);
    return validation.value;
  }

  public listWorkflows(user: AuthenticatedUser): Promise<WorkflowSummary[]> {
    return this.store.listWorkflows(user);
  }

  public async publishDraft(user: AuthenticatedUser, workflowId: string): Promise<PublishedWorkflowVersion | undefined> {
    requireWorkflowAuthor(user.role);
    const draft = await this.store.findDraft(workflowId, user);
    if (!draft) return undefined;
    if (!draft.policyPreviewedAt) throw new WorkflowInputError("Run the policy preview before publishing this draft.");
    const published = publishWorkflowDraft(draft, new Date().toISOString());
    if (!published.ok) throw new WorkflowInputError(published.errors.join(" "));
    await this.store.activate(published.value, user);
    return published.value;
  }

  public async previewDraft(user: AuthenticatedUser, workflowId: string): Promise<WorkflowReview | undefined> {
    const draft = await this.store.findDraft(workflowId, user);
    if (!draft) return undefined;
    const previewedAt = new Date().toISOString();
    const preview = publishWorkflowDraft(draft, previewedAt);
    if (!preview.ok) throw new WorkflowInputError(preview.errors.join(" "));
    const markedDraft = await this.store.markPolicyPreviewed(workflowId, user, previewedAt);
    if (!markedDraft) return undefined;
    return { id: markedDraft.id, title: markedDraft.title, version: markedDraft.version, status: "draft", allowedDomains: markedDraft.allowedDomains, steps: markedDraft.steps };
  }

  public listAuditEvents(user: AuthenticatedUser, workflowId: string): Promise<WorkflowAuditEvent[]> {
    return this.store.listAuditEvents(workflowId, user);
  }

  public async reviewDraft(user: AuthenticatedUser, workflowId: string): Promise<WorkflowReview | undefined> {
    const draft = await this.store.findDraft(workflowId, user);
    if (!draft) return undefined;
    return { id: draft.id, title: draft.title, version: draft.version, status: "draft", allowedDomains: draft.allowedDomains, steps: draft.steps };
  }
}

function requireWorkflowAuthor(role: MembershipRole): void {
  if (role !== "owner" && role !== "builder") throw new WorkflowAccessError("This role cannot change workflows.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
