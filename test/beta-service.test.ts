import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { BetaAccessError, BetaConflictError, BetaInputError, BetaService, type BetaStore } from "../src/beta/beta-service.js";
import type { BetaEnrollmentStatus, BetaSummary, BetaWorkflowEnrollment } from "../src/beta/beta-types.js";

const owner: AuthenticatedUser = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  email: "owner@example.test",
  role: "owner",
};

class MemoryBetaStore implements BetaStore {
  public workflows: BetaWorkflowEnrollment[] = [];
  public observations: Array<{ runId: string; developerIntervened: boolean }> = [];
  public failures: string[] = [];

  public enroll(_user: AuthenticatedUser, input: Parameters<BetaStore["enroll"]>[1]): Promise<BetaWorkflowEnrollment | undefined> {
    if (this.workflows.some((item) => item.workflowId === input.workflowId)) return Promise.resolve(undefined);
    const workflow: BetaWorkflowEnrollment = {
      id: input.id,
      workflowId: input.workflowId,
      taskCategory: input.taskCategory,
      baselineDurationSeconds: input.baselineDurationSeconds,
      baselineErrorRatePercent: input.baselineErrorRatePercent,
      status: "onboarding",
      firstTestObserved: false,
      firstProductionObserved: false,
      repeatUnassistedRuns: 0,
      productionRuns: 0,
      successfulProductionRuns: 0,
      productionSuccessRate: 0,
      classifiedFailures: 0,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    };
    this.workflows.push(workflow);
    return Promise.resolve(workflow);
  }

  public list(): Promise<BetaWorkflowEnrollment[]> { return Promise.resolve(this.workflows); }
  public setStatus(_user: AuthenticatedUser, enrollmentId: string, status: BetaEnrollmentStatus): Promise<BetaWorkflowEnrollment | undefined> {
    const workflow = this.workflows.find((item) => item.id === enrollmentId);
    if (workflow) workflow.status = status;
    return Promise.resolve(workflow);
  }
  public observeRun(_user: AuthenticatedUser, input: Parameters<BetaStore["observeRun"]>[1]): Promise<boolean> {
    if (!this.workflows.some((item) => item.id === input.enrollmentId)) return Promise.resolve(false);
    this.observations.push({ runId: input.runId, developerIntervened: input.developerIntervened });
    return Promise.resolve(true);
  }
  public recordFailure(_user: AuthenticatedUser, input: Parameters<BetaStore["recordFailure"]>[1]): Promise<boolean> {
    if (!this.workflows.some((item) => item.id === input.enrollmentId)) return Promise.resolve(false);
    this.failures.push(input.category);
    return Promise.resolve(true);
  }
  public summary(): Promise<BetaSummary> {
    return Promise.resolve({ enrolledWorkflows: this.workflows.length, workflowsWithFirstTest: 0, workflowsWithFirstProduction: 0, workflowsReadyForIndependentUse: 0, totalRepeatUnassistedRuns: 0, topFailureCategories: [] });
  }
}

test("enrolls only a supported measurable workflow and exposes the bounded compatibility matrix", async () => {
  const store = new MemoryBetaStore();
  const service = new BetaService(store);
  const workflow = await service.enroll(owner, {
    workflowId: "33333333-3333-4333-8333-333333333333",
    taskCategory: "report-download",
    baselineDurationMinutes: 12.5,
    baselineErrorRatePercent: 4,
  });

  assert.equal(workflow.baselineDurationSeconds, 750);
  assert.equal(service.compatibility().workflowCategories.length, 6);
  assert.equal(service.compatibility().runtimes.some((runtime) => runtime.runtime === "Firefox and Safari" && runtime.status === "not-supported"), true);
  await assert.rejects(() => service.enroll(owner, {
    workflowId: workflow.workflowId,
    taskCategory: "report-download",
    baselineDurationMinutes: 12.5,
    baselineErrorRatePercent: 4,
  }), BetaConflictError);
});

test("records evidence without accepting unbounded notes or invented failure categories", async () => {
  const store = new MemoryBetaStore();
  const service = new BetaService(store);
  const workflow = await service.enroll(owner, {
    workflowId: "33333333-3333-4333-8333-333333333333",
    taskCategory: "filter-export",
    baselineDurationMinutes: 5,
    baselineErrorRatePercent: 0,
  });

  await service.observeRun(owner, workflow.id, {
    runId: "44444444-4444-4444-8444-444444444444",
    stage: "repeat-production",
    developerIntervened: false,
  });
  await service.recordFailure(owner, workflow.id, { category: "locator-problem", errorCode: "locator.ambiguous" });
  assert.deepEqual(store.observations, [{ runId: "44444444-4444-4444-8444-444444444444", developerIntervened: false }]);
  assert.deepEqual(store.failures, ["locator-problem"]);
  await assert.rejects(() => service.recordFailure(owner, workflow.id, { category: "miscellaneous" }), BetaInputError);
});

test("restricts beta coordination to owners and builders", () => {
  const service = new BetaService(new MemoryBetaStore());
  assert.throws(() => service.list({ ...owner, role: "reviewer" }), BetaAccessError);
});
