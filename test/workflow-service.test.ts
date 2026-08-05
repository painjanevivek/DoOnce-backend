import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { WorkflowDraft } from "../src/workflow/schema.js";
import type { PublishedWorkflowVersion } from "../src/workflow/versioning.js";
import { WorkflowInputError, WorkflowService, type WorkflowAuditEvent, type WorkflowStore } from "../src/workflow/workflow-service.js";
import { safeReportWorkflowFixture } from "./fixtures/safe-report-workflow.js";

class MemoryWorkflowStore implements WorkflowStore {
  public drafts: WorkflowDraft[] = [];
  public active: PublishedWorkflowVersion[] = [];
  public events: WorkflowAuditEvent[] = [];

  public async createDraft(draft: WorkflowDraft): Promise<void> {
    this.drafts.push(draft);
    this.events.push({ id: `${draft.id}-draft`, workflowId: draft.id, version: draft.version, eventType: "workflow.draft_created", createdAt: new Date().toISOString() });
  }
  public async listWorkflows(): Promise<[]> { return []; }
  public async findDraft(id: string, user: AuthenticatedUser): Promise<WorkflowDraft | undefined> {
    return this.drafts.find((draft) => draft.id === id && draft.tenantId === user.tenantId);
  }
  public async markPolicyPreviewed(id: string, user: AuthenticatedUser, policyPreviewedAt: string): Promise<WorkflowDraft | undefined> {
    const draft = await this.findDraft(id, user);
    if (!draft) return undefined;
    draft.policyPreviewedAt = policyPreviewedAt;
    this.events.push({ id: `${draft.id}-preview`, workflowId: draft.id, version: draft.version, eventType: "workflow.policy_previewed", createdAt: policyPreviewedAt });
    return draft;
  }
  public async activate(draft: PublishedWorkflowVersion): Promise<void> {
    this.active.push(draft);
    this.events.push({ id: `${draft.id}-published`, workflowId: draft.id, version: draft.version, eventType: "workflow.published", createdAt: new Date().toISOString() });
  }
  public async listAuditEvents(workflowId: string): Promise<WorkflowAuditEvent[]> { return this.events.filter((event) => event.workflowId === workflowId); }
}

const owner: AuthenticatedUser = {
  tenantId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  userId: "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
  email: "owner@example.com",
  role: "owner",
};

test("creates a tenant-bound draft without trusting client ownership fields", async () => {
  const store = new MemoryWorkflowStore();
  const service = new WorkflowService(store);
  const draft = await service.createDraft(owner, {
    ...safeReportWorkflowFixture,
    tenantId: "11111111-1111-4111-8111-111111111111",
    ownerId: "22222222-2222-4222-8222-222222222222",
  });

  assert.equal(draft.tenantId, owner.tenantId);
  assert.equal(draft.ownerId, owner.userId);
  assert.notEqual(draft.id, safeReportWorkflowFixture.id);
});

test("publishes only a policy-safe draft", async () => {
  const store = new MemoryWorkflowStore();
  const service = new WorkflowService(store);
  const draft = await service.createDraft(owner, safeReportWorkflowFixture);
  await service.previewDraft(owner, draft.id);
  const published = await service.publishDraft(owner, draft.id);

  assert.equal(published?.status, "active");
  assert.equal(store.active.length, 1);
  assert.deepEqual(await service.listAuditEvents(owner, draft.id).then((events) => events.map((event) => event.eventType)), ["workflow.draft_created", "workflow.policy_previewed", "workflow.published"]);
});

test("refuses to publish a draft with a reversible write", async () => {
  const store = new MemoryWorkflowStore();
  const service = new WorkflowService(store);
  const draft = await service.createDraft(owner, {
    ...safeReportWorkflowFixture,
    steps: [{ ...safeReportWorkflowFixture.steps[0], kind: "type" }],
  });

  await assert.rejects(() => service.previewDraft(owner, draft.id), WorkflowInputError);
});

test("refuses publication until a policy preview passes", async () => {
  const service = new WorkflowService(new MemoryWorkflowStore());
  const draft = await service.createDraft(owner, safeReportWorkflowFixture);
  await assert.rejects(() => service.publishDraft(owner, draft.id), WorkflowInputError);
});
