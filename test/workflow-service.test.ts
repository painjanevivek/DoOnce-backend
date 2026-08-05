import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { WorkflowDraft } from "../src/workflow/schema.js";
import type { PublishedWorkflowVersion } from "../src/workflow/versioning.js";
import { WorkflowInputError, WorkflowService, type WorkflowStore } from "../src/workflow/workflow-service.js";
import { safeReportWorkflowFixture } from "./fixtures/safe-report-workflow.js";

class MemoryWorkflowStore implements WorkflowStore {
  public drafts: WorkflowDraft[] = [];
  public active: PublishedWorkflowVersion[] = [];

  public async createDraft(draft: WorkflowDraft): Promise<void> { this.drafts.push(draft); }
  public async listWorkflows(): Promise<[]> { return []; }
  public async findDraft(id: string, user: AuthenticatedUser): Promise<WorkflowDraft | undefined> {
    return this.drafts.find((draft) => draft.id === id && draft.tenantId === user.tenantId);
  }
  public async activate(draft: PublishedWorkflowVersion): Promise<void> { this.active.push(draft); }
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
  const published = await service.publishDraft(owner, draft.id);

  assert.equal(published?.status, "active");
  assert.equal(store.active.length, 1);
});

test("refuses to publish a draft with a reversible write", async () => {
  const store = new MemoryWorkflowStore();
  const service = new WorkflowService(store);
  const draft = await service.createDraft(owner, {
    ...safeReportWorkflowFixture,
    steps: [{ ...safeReportWorkflowFixture.steps[0], kind: "type" }],
  });

  await assert.rejects(() => service.publishDraft(owner, draft.id), WorkflowInputError);
});
