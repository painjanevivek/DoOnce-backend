import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { WorkflowCompilation, WorkflowSpec } from "../src/contracts/protocol.js";
import { CanonicalWorkflowAccessError, CanonicalWorkflowInputError, CanonicalWorkflowService, type CanonicalDraftMutationResult, type CanonicalNextDraftResult, type CanonicalPublishResult, type CanonicalWorkflowDraft, type CanonicalWorkflowStore, type CanonicalWorkflowSummary, type CanonicalWorkflowVersion } from "../src/workflow/canonical-workflow-service.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

class MemoryCanonicalStore implements CanonicalWorkflowStore {
  public draft?: CanonicalWorkflowDraft;
  public tested = true;
  public async createDraft(_user: AuthenticatedUser, id: string, spec: WorkflowSpec, metadata?: import("../src/workflow/canonical-workflow-service.js").CanonicalWorkflowDraftMetadata): Promise<CanonicalWorkflowDraft> {
    this.draft = { id, version: 1, status: "draft", spec, checksum: "a".repeat(64), ...(metadata ? { metadata } : {}) };
    return this.draft;
  }
  public async findDraft(): Promise<CanonicalWorkflowDraft | undefined> { return this.draft; }
  public async listWorkflows(): Promise<CanonicalWorkflowSummary[]> { return []; }
  public async listVersions(): Promise<CanonicalWorkflowVersion[]> { return []; }
  public async updateDraft(_user: AuthenticatedUser, _id: string, expectedChecksum: string, spec: WorkflowSpec): Promise<CanonicalDraftMutationResult> {
    if (!this.draft) return { status: "missing" };
    if (expectedChecksum !== this.draft.checksum) return { status: "conflict", draft: this.draft };
    this.draft = { ...this.draft, spec, checksum: "b".repeat(64), ...(this.draft.metadata ? { metadata: { ...this.draft.metadata, source: "editor" } } : {}) };
    return { status: "updated", draft: this.draft };
  }
  public async createNextDraft(): Promise<CanonicalNextDraftResult> { return this.draft ? { status: "exists", draft: this.draft } : { status: "missing" }; }
  public async hasPassingTestEvidence(): Promise<boolean> { return this.tested; }
  public async publishDraft(): Promise<CanonicalPublishResult> {
    if (!this.draft) return { status: "missing" };
    return { status: "published", version: { id: this.draft.id, version: this.draft.version, status: "active", spec: this.draft.spec, checksum: this.draft.checksum, testEvidenceRunId: "e0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", createdAt: "2026-08-09T00:00:00.000Z", publishedAt: "2026-08-09T00:00:01.000Z" } };
  }
}

const owner: AuthenticatedUser = { tenantId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", userId: "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", email: "owner@example.com", role: "owner" };
const workflow = validProtocolFixtures.WorkflowSpec as WorkflowSpec;

test("creates, stores, loads, and validates an immutable WorkflowSpec", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  const created = await service.createDraft(owner, workflow);
  const loaded = await service.findDraft(owner, created.id);
  assert.deepEqual(loaded, { ...created, testEvidenceVerified: true });
  assert.equal(Object.isFrozen(created.spec), true);
  assert.equal(Object.isFrozen(created.spec.steps), true);
  assert.throws(() => { created.spec.title = "Changed"; }, TypeError);
});

test("rejects unknown fields before storage", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  await assert.rejects(() => service.createDraft(owner, { ...workflow, unexpected: true }), CanonicalWorkflowInputError);
});

test("requires passing test evidence for the exact saved draft checksum", async () => {
  const store = new MemoryCanonicalStore();
  const service = new CanonicalWorkflowService(store);
  const draft = await service.createDraft(owner, workflow);
  store.tested = false;
  await assert.rejects(() => service.publishDraft(owner, draft.id, draft.checksum), /exact saved draft/);
  store.tested = true;
  assert.equal((await service.publishDraft(owner, draft.id, draft.checksum)).status, "published");
});

test("allows only workflow authors to create canonical drafts", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  await assert.rejects(() => service.createDraft({ ...owner, role: "runner" }, workflow), CanonicalWorkflowAccessError);
});

test("updates valid drafts with optimistic checksums and reports conflicts", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  const created = await service.createDraft(owner, workflow);
  const updated = await service.updateDraft(owner, created.id, created.checksum, { ...workflow, title: "Edited report workflow" });
  assert.equal(updated.status, "updated");
  if (updated.status === "updated") assert.equal(updated.draft.checksum, "b".repeat(64));
  const conflict = await service.updateDraft(owner, created.id, created.checksum, workflow);
  assert.equal(conflict.status, "conflict");
});

test("returns field-level issues and never echoes secret test values", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  const secretWorkflow: WorkflowSpec = { ...workflow, inputs: [{ name: "api_token", label: "API token", kind: "text", required: true, secret: true }] };
  const created = await service.createDraft(owner, secretWorkflow);
  const preview = await service.previewTest(owner, created.id, { executor: "extension", inputs: { api_token: "private-value" } });
  assert.deepEqual(preview?.inputs, [{ name: "api_token", provided: true, secret: true }]);
  assert.equal(JSON.stringify(preview).includes("private-value"), false);
  await assert.rejects(() => service.updateDraft(owner, created.id, created.checksum, { ...secretWorkflow, title: "" }), (error: unknown) => error instanceof CanonicalWorkflowInputError && error.issues.length > 0);
});

test("validates forward-only branch destinations", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  const first = workflow.steps[0]!;
  const branch: WorkflowSpec["steps"][number] = { id: "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", action: "branch", name: "Choose path", expectedOutcome: "A path is chosen", inputName: "report_date", operator: "equals", expected: "today", ifTrueStepId: first.id };
  const branched = { ...workflow, inputs: [{ name: "report_date", label: "Report date", kind: "date" as const, required: true }] };
  await assert.rejects(() => service.createDraft(owner, { ...branched, steps: [first, branch] }), CanonicalWorkflowInputError);
  const created = await service.createDraft(owner, { ...branched, steps: [branch, first] });
  assert.equal(created.spec.steps[0]?.action, "branch");
});

test("retains capture evidence as historical provenance after a human edit", async () => {
  const service = new CanonicalWorkflowService(new MemoryCanonicalStore());
  const compilation = validProtocolFixtures.WorkflowCompilation as WorkflowCompilation;
  const metadata = { source: "capture" as const, captureSessionId: compilation.captureSessionId, compilerVersion: compilation.compilerVersion, sourceDigest: compilation.sourceDigest, compilation };
  const created = await service.createDraft(owner, workflow, metadata);
  const updated = await service.updateDraft(owner, created.id, created.checksum, { ...workflow, title: "Human-edited title" });
  assert.equal(updated.status, "updated");
  if (updated.status === "updated") assert.equal(updated.draft.metadata?.source, "editor");
  const loaded = await service.findDraft(owner, created.id);
  assert.equal(loaded?.metadata?.compilation.workflow.title, workflow.title);
  assert.equal(loaded?.spec.title, "Human-edited title");
});
