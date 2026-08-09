import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { RepairProposal, StepResult, WorkflowSpec } from "../src/contracts/protocol.js";
import { classifyFailure, RepairInputError, RepairService, type RepairProposalRecord, type RepairRunContext, type RepairStore } from "../src/repair/repair-service.js";
import type { RepairProvider } from "../src/repair/repair-provider.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

const owner: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };
const workflow = structuredClone(validProtocolFixtures.WorkflowSpec as WorkflowSpec);
const runId = "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";

class MemoryRepairStore implements RepairStore {
  public proposal?: RepairProposalRecord; public protocol?: RepairProposal; public acceptedWorkflow?: WorkflowSpec;
  public constructor(public context: RepairRunContext = failedRun()) {}
  public async loadRun() { return structuredClone(this.context); }
  public async save(_user: AuthenticatedUser, proposal: RepairProposalRecord, protocol: RepairProposal) { this.proposal = structuredClone(proposal); this.protocol = structuredClone(protocol); return proposal; }
  public async find() { return this.proposal; }
  public async list() { return this.proposal ? [this.proposal] : []; }
  public async source() { return this.proposal ? { proposal: structuredClone(this.proposal), workflow: structuredClone(this.context.workflow) } : undefined; }
  public async accept(_user: AuthenticatedUser, _id: string, updated: WorkflowSpec) { if (!this.proposal) return { status: "missing" as const }; this.acceptedWorkflow = structuredClone(updated); this.proposal = { ...this.proposal, status: "accepted", acceptedDraftVersion: 2 }; return { status: "accepted" as const, proposal: this.proposal }; }
  public async reject(_user: AuthenticatedUser, _id: string, reason?: string) { if (!this.proposal) return undefined; this.proposal = { ...this.proposal, status: "rejected", ...(reason ? { rejectedReason: reason } : {}) }; return this.proposal; }
}

test("classifies stable executor reason codes", () => {
  assert.equal(classifyFailure("locator.missing"), "locator-not-found"); assert.equal(classifyFailure("element.not-visible"), "locator-not-found"); assert.equal(classifyFailure("locator.ambiguous"), "locator-ambiguous"); assert.equal(classifyFailure("navigation.timeout"), "navigation-timeout"); assert.equal(classifyFailure("assertion.failed"), "assertion-failed"); assert.equal(classifyFailure("download.not-observed"), "download-failed"); assert.equal(classifyFailure("executor.unsupported-action"), "unsupported-capability"); assert.equal(classifyFailure("run.uncertain-action"), "executor-disconnected"); assert.equal(classifyFailure("input.missing"), "user-input-required"); assert.equal(classifyFailure("executor.unexpected-error"), "unknown-internal-error");
});

test("proposes a unique changed semantic locator with bounded evidence", async () => {
  const store = new MemoryRepairStore(); const service = new RepairService(store);
  const proposal = await service.propose(owner, runId);
  assert.equal(proposal.status, "pending"); assert.equal(proposal.failureCategory, "locator-not-found"); assert.equal(proposal.proposedStep.action, "download");
  if ("target" in proposal.proposedStep && "locator" in proposal.proposedStep.target) assert.equal(proposal.proposedStep.target.locator.primary.value, "Export report");
  assert.equal(proposal.evidence.candidateCount, 1); assert.equal(proposal.requiredTestPlan.length, 3); assert.equal(store.protocol?.operations[0]?.op, "replace-locator");
  assert.deepEqual(store.context.workflow, workflow);
});

test("does not guess when multiple locator candidates are equally plausible", async () => {
  const context = failedRun(); context.stepResults[0]!.repairCandidates = [{ strategy: "text", value: "Export report", confidence: .9 }, { strategy: "text", value: "Download data", confidence: .9 }];
  await assert.rejects(() => new RepairService(new MemoryRepairStore(context)).propose(owner, runId), RepairInputError);
});

test("uses the provider only after deterministic matching is inconclusive", async () => {
  let calls = 0; const provider: RepairProvider = { async propose() { calls += 1; return { locator: { schemaVersion: 1, primary: { strategy: "text", value: "Export data", confidence: .8 }, fallbacks: [] }, confidence: .74, rationale: "The visible export control is the closest action target.", provider: "fixture", model: "repair-1" }; } };
  const context = failedRun(); context.stepResults[0]!.repairCandidates = [];
  const proposal = await new RepairService(new MemoryRepairStore(context), provider).propose(owner, runId);
  assert.equal(calls, 1); assert.equal(proposal.provider, "fixture"); assert.equal(proposal.confidence, .74);
});

test("accepts a proposal into a separate draft workflow", async () => {
  const store = new MemoryRepairStore(); const service = new RepairService(store); const proposal = await service.propose(owner, runId); const accepted = await service.accept(owner, proposal.id);
  assert.equal(accepted.status, "accepted"); assert.equal(accepted.acceptedDraftVersion, 2); assert.ok(store.acceptedWorkflow); assert.deepEqual(store.context.workflow, workflow); assert.notDeepEqual(store.acceptedWorkflow, workflow);
});

function failedRun(): RepairRunContext { const stepId = workflow.steps[0]!.id; const result: StepResult = { schemaVersion: 1, stepId, status: "paused", reasonCode: "locator.missing", startedAt: "2026-08-09T00:00:00.000Z", finishedAt: "2026-08-09T00:00:01.000Z", observedPage: { capturedAt: "2026-08-09T00:00:01.000Z", origin: "https://reports.example.test", path: "/reports", urlPattern: "https://reports.example.test/reports", navigationId: "1" }, repairCandidates: [{ strategy: "text", value: "Export report", confidence: .9 }] }; return { runId, workflowId: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", workflowVersion: 1, workflowChecksum: "a".repeat(64), status: "paused", workflow: structuredClone(workflow), stepResults: [result], screenshotArtifactIds: ["d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b"] }; }
