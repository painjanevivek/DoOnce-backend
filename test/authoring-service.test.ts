import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { WorkflowInputDefinition, WorkflowSpec } from "../src/contracts/protocol.js";
import { validateProtocolContract } from "../src/contracts/validation.js";
import { AuthoringConflictError, AuthoringService, type AuthoringJob, type AuthoringJobEvent, type AuthoringJobStore, type AuthoringOutcome } from "../src/authoring/authoring-service.js";
import type { AuthoringProvider, AuthoringProviderInput, AuthoringProviderResult } from "../src/authoring/authoring-provider.js";
import { TemplateAuthoringProvider } from "../src/authoring/template-authoring-provider.js";
import { StagehandAuthoringAdapter } from "../src/authoring/stagehand-authoring-adapter.js";
import type { CanonicalWorkflowService } from "../src/workflow/canonical-workflow-service.js";

const owner: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };
const region: WorkflowInputDefinition = { name: "region", label: "Region", kind: "select", required: true, options: ["North", "South"] };

class MemoryJobStore implements AuthoringJobStore {
  public job?: AuthoringJob; public digest = ""; public key = ""; public eventsValue: AuthoringJobEvent[] = [];
  public async enqueue(_user: AuthenticatedUser, job: AuthoringJob, key: string, digest: string) { if (this.job && key === this.key) return { created: false, job: this.job, requestDigest: this.digest }; this.job = job; this.key = key; this.digest = digest; return { created: true, job, requestDigest: digest }; }
  public async find() { return this.job; }
  public async events() { return this.eventsValue; }
  public async claim() { if (!this.job || this.job.status !== "queued") return undefined; this.job = { ...this.job, status: "running", attempts: this.job.attempts + 1 }; return this.job; }
  public async progress(_user: AuthenticatedUser, _id: string, phase: string, message: string) { if (!this.job) return false; this.job = { ...this.job, progress: { phase, message } }; return true; }
  public async finish(_user: AuthenticatedUser, _id: string, input: { status: "needs-input" | "completed" | "failed"; result?: AuthoringOutcome; workflowId?: string; errorCode?: string; validationRetries: number; usage: AuthoringJob["usage"]; latencyMs: number }) { if (!this.job) return undefined; this.job = { ...this.job, status: input.status, validationRetries: input.validationRetries, usage: input.usage, latencyMs: input.latencyMs, ...(input.result ? { result: input.result } : {}), ...(input.workflowId ? { workflowId: input.workflowId } : {}), ...(input.errorCode ? { errorCode: input.errorCode } : {}) }; return this.job; }
  public async cancel() { if (!this.job) return undefined; this.job = { ...this.job, status: "cancelled" }; return this.job; }
}

class DraftSink {
  public drafts: WorkflowSpec[] = [];
  public async createDraft(_user: AuthenticatedUser, workflow: WorkflowSpec) { this.drafts.push(workflow); return { id: "33333333-3333-4333-8333-333333333333", version: 1, status: "draft" as const, spec: workflow, checksum: "a".repeat(64) }; }
}

test("turns a text request into one valid editable draft asynchronously", async () => {
  const store = new MemoryJobStore(); const sink = new DraftSink();
  const service = new AuthoringService(store, new TemplateAuthoringProvider(), sink as unknown as CanonicalWorkflowService);
  const queued = await service.enqueue(owner, { taskDescription: "Filter the weekly report by region and export it as CSV.", startingUrl: "https://reports.example.test/reports", availableInputs: [region], idempotencyKey: "authoring:test-1" });
  assert.equal(queued.job.status, "queued");
  const completed = await service.process(owner, queued.job.id);
  assert.equal(completed?.status, "completed");
  assert.equal(sink.drafts.length, 1);
  assert.equal(validateProtocolContract("WorkflowSpec", sink.drafts[0]).ok, true);
  assert.equal(completed?.result?.metadata.promptVersion, "text-workflow-v1.0.0");
  assert.ok((completed?.result?.stepConfidence.length ?? 0) >= 3);
});

test("returns a clear question without storing a workflow when required context is missing", async () => {
  const store = new MemoryJobStore(); const sink = new DraftSink(); const service = new AuthoringService(store, new TemplateAuthoringProvider(), sink as unknown as CanonicalWorkflowService);
  const queued = await service.enqueue(owner, { taskDescription: "Download the weekly report as CSV.", availableInputs: [], idempotencyKey: "authoring:test-2" });
  const result = await service.process(owner, queued.job.id);
  assert.equal(result?.status, "needs-input");
  assert.match(result?.result?.questions[0] ?? "", /page/i);
  assert.equal(sink.drafts.length, 0);
});

test("retries invalid structured output once and never stores it", async () => {
  const provider: AuthoringProvider = { identity: { provider: "test", model: "invalid", promptVersion: "prompt-1" }, async generate(input: AuthoringProviderInput): Promise<AuthoringProviderResult> { return { candidate: { schemaVersion: 1, format: "doonce.workflow-spec.v1", title: "Invalid", allowedDomains: ["example.test"], inputs: [], steps: [{ id: "44444444-4444-4444-8444-444444444444", action: "invented-action" }] }, questions: [], assumptions: [], unsupportedRequirements: [], stepConfidence: [], metadata: this.identity, usage: { promptTokens: 10 + input.attempt, completionTokens: 5, estimatedCostMicrousd: 2 } }; } };
  const store = new MemoryJobStore(); const sink = new DraftSink(); const service = new AuthoringService(store, provider, sink as unknown as CanonicalWorkflowService);
  const queued = await service.enqueue(owner, { taskDescription: "Open the example and perform an invented action.", startingUrl: "https://example.test/", availableInputs: [], idempotencyKey: "authoring:test-3" });
  const result = await service.process(owner, queued.job.id);
  assert.equal(result?.status, "failed"); assert.equal(result?.validationRetries, 1); assert.equal(result?.usage.promptTokens, 21); assert.equal(sink.drafts.length, 0);
  assert.ok((result?.result?.validationIssues.length ?? 0) > 0);
});

test("rejects a candidate when provider confidence does not cover every step", async () => {
  const template = new TemplateAuthoringProvider();
  const provider: AuthoringProvider = { identity: { provider: "test", model: "missing-confidence", promptVersion: "prompt-1" }, async generate(request) { const generated = await template.generate(request); return { ...generated, stepConfidence: [], metadata: this.identity }; } };
  const store = new MemoryJobStore(); const sink = new DraftSink(); const service = new AuthoringService(store, provider, sink as unknown as CanonicalWorkflowService);
  const queued = await service.enqueue(owner, { taskDescription: "Download the weekly report as CSV.", startingUrl: "https://example.test/reports", availableInputs: [], idempotencyKey: "authoring:test-confidence" });
  const result = await service.process(owner, queued.job.id);
  assert.equal(result?.status, "failed");
  assert.equal(result?.errorCode, "authoring.confidence_invalid");
  assert.equal(result?.validationRetries, 1);
  assert.equal(sink.drafts.length, 0);
});

test("rejects an idempotency key reused for a different task", async () => {
  const store = new MemoryJobStore(); const service = new AuthoringService(store, new TemplateAuthoringProvider(), new DraftSink() as unknown as CanonicalWorkflowService);
  await service.enqueue(owner, { taskDescription: "Download the weekly report.", startingUrl: "https://example.test/", idempotencyKey: "authoring:test-4" });
  await assert.rejects(() => service.enqueue(owner, { taskDescription: "Extract the customer table.", startingUrl: "https://example.test/", idempotencyKey: "authoring:test-4" }), AuthoringConflictError);
});

test("measures the controlled text-authoring evaluation set", async () => {
  const provider = new TemplateAuthoringProvider();
  const cases = [
    input("Download a report as CSV."), input("Filter a table by region and export results.", [region]), input("Fill a non-sensitive sample form with a region.", [region]),
    input("Copy a record between two fixture applications."), input("Extract a table into structured output."), input("Download the report and handle an optional modal."), input("Filter the report and export it."),
  ];
  const results = await Promise.all(cases.map((item) => provider.generate(item)));
  const valid = results.filter((result) => result.candidate && validateProtocolContract("WorkflowSpec", result.candidate).ok).length;
  const explained = results.filter((result) => !result.candidate && (result.questions.length > 0 || result.unsupportedRequirements.length > 0)).length;
  assert.equal(valid, 4); assert.equal(explained, 3); assert.equal(valid + explained, cases.length);
});

test("keeps Stagehand behind the authoring provider boundary", async () => {
  const workflow = (await new TemplateAuthoringProvider().generate(input("Download a report as CSV."))).candidate as WorkflowSpec;
  const adapter = new StagehandAuthoringAdapter({ async plan() { return { envelope: { workflow, questions: [], assumptions: ["Observed in a temporary browser session."], unsupportedRequirements: [], stepConfidence: [] }, model: "fixture-model" }; } });
  const result = await adapter.generate(input("Download a report as CSV."));
  assert.equal(result.metadata.provider, "stagehand"); assert.equal(result.metadata.model, "fixture-model"); assert.deepEqual(result.candidate, workflow);
});

function input(taskDescription: string, availableInputs: WorkflowInputDefinition[] = []): AuthoringProviderInput { return { taskDescription, startingUrl: "https://fixtures.example.test/reports", availableInputs, executorCapabilities: { schemaVersion: 1, executor: "extension", actions: ["navigate", "wait", "read", "select", "type", "download", "compare", "branch", "ask-approval", "stop"], maxSteps: 500, supportsDownloads: true }, workflowSchemaVersion: 1, attempt: 0, validationFeedback: [] }; }
