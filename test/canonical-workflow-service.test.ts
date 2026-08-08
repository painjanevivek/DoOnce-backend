import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { CanonicalWorkflowAccessError, CanonicalWorkflowInputError, CanonicalWorkflowService, type CanonicalWorkflowDraft, type CanonicalWorkflowStore } from "../src/workflow/canonical-workflow-service.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

class MemoryCanonicalStore implements CanonicalWorkflowStore {
  public draft?: CanonicalWorkflowDraft;
  public async createDraft(_user: AuthenticatedUser, id: string, spec: WorkflowSpec): Promise<CanonicalWorkflowDraft> {
    this.draft = { id, version: 1, status: "draft", spec, checksum: "a".repeat(64) };
    return this.draft;
  }
  public async findDraft(): Promise<CanonicalWorkflowDraft | undefined> { return this.draft; }
}

const owner: AuthenticatedUser = { tenantId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", userId: "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", email: "owner@example.com", role: "owner" };
const workflow = validProtocolFixtures.WorkflowSpec as WorkflowSpec;

test("creates, stores, loads, and validates an immutable WorkflowSpec", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  const created = await service.createDraft(owner, workflow);
  const loaded = await service.findDraft(owner, created.id);
  assert.deepEqual(loaded, created);
  assert.equal(Object.isFrozen(created.spec), true);
  assert.equal(Object.isFrozen(created.spec.steps), true);
  assert.throws(() => { created.spec.title = "Changed"; }, TypeError);
});

test("rejects unknown fields before storage", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  await assert.rejects(() => service.createDraft(owner, { ...workflow, unexpected: true }), CanonicalWorkflowInputError);
});

test("allows only workflow authors to create canonical drafts", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  await assert.rejects(() => service.createDraft({ ...owner, role: "runner" }, workflow), CanonicalWorkflowAccessError);
});
