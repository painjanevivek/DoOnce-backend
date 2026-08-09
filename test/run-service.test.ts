import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { RunRequest, RunResult, WorkflowSpec } from "../src/contracts/protocol.js";
import { RunConflictError, RunInputError, RunService, type ExecutionRun, type PublishedWorkflow, type RunCheckpoint, type RunStore } from "../src/runner/run-service.js";

const user: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "runner@example.test", role: "runner" };
const workflowId = "33333333-3333-4333-8333-333333333333";
const stepId = "44444444-4444-4444-8444-444444444444";
const workflow: WorkflowSpec = {
  schemaVersion: 1, format: "doonce.workflow-spec.v1", title: "Report", allowedDomains: ["example.test"],
  inputs: [{ name: "region", label: "Region", kind: "select", required: true, options: ["north", "south"] }],
  steps: [{ id: stepId, action: "navigate", name: "Open", expectedOutcome: "Page opens", target: { domain: "example.test", path: "/reports" } }],
};

class MemoryRunStore implements RunStore {
  public published: PublishedWorkflow | undefined = { workflowId, version: 2, checksum: "a".repeat(64), status: "active", spec: workflow };
  public run: ExecutionRun | undefined;
  public request: RunRequest | undefined;
  public requestDigest = "";
  public idempotencyKey = "";
  public leaseHash = "";
  public cancelled = false;

  public async findExecutable(): Promise<PublishedWorkflow | undefined> { return this.published; }
  public async create(_user: AuthenticatedUser, request: RunRequest, executable: PublishedWorkflow, idempotencyKey: string, requestDigest: string) {
    if (this.run && idempotencyKey === this.idempotencyKey) return { created: false, run: this.run, requestDigest: this.requestDigest };
    this.request = request; this.requestDigest = requestDigest; this.idempotencyKey = idempotencyKey;
    this.run = { id: request.runId, workflowId: request.workflowId, workflowVersion: request.workflowVersion, workflowChecksum: executable.checksum, mode: executable.status === "draft" ? "test" : "production", status: "queued", executor: "extension", requestedAt: request.requestedAt, cancelRequested: false, currentStepIndex: 0, stepResults: [] };
    return { created: true, run: this.run, requestDigest };
  }
  public async list(): Promise<ExecutionRun[]> { return this.run ? [this.run] : []; }
  public async find(): Promise<ExecutionRun | undefined> { return this.run; }
  public async timeline() { return this.run ? { run: this.run, steps: this.run.stepResults, events: [], artifacts: [] } : undefined; }
  public async claim(_user: AuthenticatedUser, input: { extensionVersion: string; leaseTokenHash: string; leaseExpiresAt: string }) {
    if (!this.run || this.run.status !== "queued") return undefined;
    this.leaseHash = input.leaseTokenHash;
    this.run = { ...this.run, status: "running", extensionVersion: input.extensionVersion, leaseExpiresAt: input.leaseExpiresAt, startedAt: new Date().toISOString() };
    return { run: this.run, request: this.request!, workflow };
  }
  public async heartbeat(_user: AuthenticatedUser, _runId: string, leaseHash: string, leaseExpiresAt: string) { if (leaseHash !== this.leaseHash || !this.run) return undefined; this.run = { ...this.run, leaseExpiresAt }; return this.run; }
  public async checkpoint(_user: AuthenticatedUser, _runId: string, leaseHash: string, checkpoint: RunCheckpoint, leaseExpiresAt: string) { if (leaseHash !== this.leaseHash || !this.run) return undefined; this.run = { ...this.run, currentStepIndex: checkpoint.currentStepIndex, stepResults: checkpoint.stepResults, leaseExpiresAt }; return this.run; }
  public async finish(_user: AuthenticatedUser, _runId: string, leaseHash: string, result: RunResult) { if (leaseHash !== this.leaseHash || !this.run) return undefined; this.run = { ...this.run, status: result.status, result, finishedAt: result.finishedAt, stepResults: result.stepResults }; return this.run; }
  public async cancel() { if (!this.run) return undefined; this.cancelled = true; this.run = { ...this.run, cancelRequested: true, status: this.run.status === "queued" ? "cancelled" : this.run.status }; return this.run; }
}

test("creates one idempotent run for the same request", async () => {
  const store = new MemoryRunStore();
  const service = new RunService(store);
  const input = { workflowId, inputs: { region: "north" }, idempotencyKey: "dashboard:request-1" };
  const first = await service.create(user, input);
  const second = await service.create(user, input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.run.id, first.run.id);
});

test("rejects an idempotency key reused with different inputs", async () => {
  const service = new RunService(new MemoryRunStore());
  await service.create(user, { workflowId, inputs: { region: "north" }, idempotencyKey: "dashboard:request-2" });
  await assert.rejects(() => service.create(user, { workflowId, inputs: { region: "south" }, idempotencyKey: "dashboard:request-2" }), RunConflictError);
});

test("validates required and enumerated workflow inputs", async () => {
  const service = new RunService(new MemoryRunStore());
  await assert.rejects(() => service.create(user, { workflowId, inputs: {}, idempotencyKey: "dashboard:request-3" }), RunInputError);
  await assert.rejects(() => service.create(user, { workflowId, inputs: { region: "east" }, idempotencyKey: "dashboard:request-4" }), RunInputError);
});

test("binds test runs to the exact editable draft checksum", async () => {
  const store = new MemoryRunStore();
  store.published = { workflowId, version: 3, checksum: "b".repeat(64), status: "draft", spec: workflow };
  const created = await new RunService(store).create(user, { workflowId, inputs: { region: "north" }, mode: "test", idempotencyKey: "draft:test-1" });
  assert.equal(created.run.mode, "test");
  assert.equal(created.run.workflowVersion, 3);
  assert.equal(created.run.workflowChecksum, "b".repeat(64));
  assert.equal(store.request?.workflowVersion, 3);
});

test("claims, heartbeats, checkpoints, and completes with an opaque lease", async () => {
  const store = new MemoryRunStore();
  const service = new RunService(store, 10_000);
  const created = await service.create(user, { workflowId, inputs: { region: "north" }, idempotencyKey: "dashboard:request-5" });
  const claimed = await service.claim(user, { extensionVersion: "0.4.0", capabilities: ["workflow-spec-v1", "checkpoints"] });
  assert.equal(claimed?.run.id, created.run.id);
  assert.equal(claimed?.leaseToken.length, 43);
  assert.equal(await service.heartbeat(user, created.run.id, "wrong-token-that-is-long-enough-to-look-valid________"), undefined);
  const checkpointed = await service.checkpoint(user, created.run.id, { leaseToken: claimed!.leaseToken, checkpoint: { currentStepIndex: 1, stepResults: [], variables: { region: "north" }, observedUrl: "https://example.test/reports" } });
  assert.equal(checkpointed?.currentStepIndex, 1);
  const finishedAt = new Date().toISOString();
  const result: RunResult = { schemaVersion: 1, format: "doonce.run-result.v1", runId: created.run.id, workflowId, workflowVersion: 2, status: "completed", stepResults: [], startedAt: claimed!.run.startedAt!, finishedAt };
  const finished = await service.finish(user, created.run.id, { leaseToken: claimed!.leaseToken, result });
  assert.equal(finished?.status, "completed");
  assert.equal((await service.finish(user, created.run.id, { leaseToken: claimed!.leaseToken, result }))?.status, "completed");
});

test("cancellation is idempotent and visible to the extension", async () => {
  const store = new MemoryRunStore();
  const service = new RunService(store);
  const created = await service.create(user, { workflowId, inputs: { region: "south" }, idempotencyKey: "dashboard:request-6" });
  assert.equal((await service.cancel(user, created.run.id))?.status, "cancelled");
  assert.equal((await service.cancel(user, created.run.id))?.status, "cancelled");
});
