import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { ScheduleAccessError, ScheduleService, nextRuns, type ScheduleFiring, type ScheduleStore, type WorkflowSchedule } from "../src/scheduling/schedule-service.js";

const owner: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };
const workflowId = "33333333-3333-4333-8333-333333333333";
const profileId = "44444444-4444-4444-8444-444444444444";

class MemoryScheduleStore implements ScheduleStore {
  public schedule?: WorkflowSchedule;
  public create(_user: AuthenticatedUser, schedule: WorkflowSchedule): Promise<WorkflowSchedule> { this.schedule = schedule; return Promise.resolve(schedule); }
  public list(): Promise<WorkflowSchedule[]> { return Promise.resolve(this.schedule ? [this.schedule] : []); }
  public find(): Promise<WorkflowSchedule | undefined> { return Promise.resolve(this.schedule); }
  public update(_user: AuthenticatedUser, schedule: WorkflowSchedule): Promise<WorkflowSchedule> { this.schedule = schedule; return Promise.resolve(schedule); }
  public setEnabled(_user: AuthenticatedUser, _id: string, enabled: boolean, nextRunAt: string): Promise<WorkflowSchedule | undefined> { if (!this.schedule) return Promise.resolve(undefined); this.schedule = { ...this.schedule, enabled, nextRunAt }; return Promise.resolve(this.schedule); }
  public remove(): Promise<boolean> { const found = Boolean(this.schedule); this.schedule = undefined; return Promise.resolve(found); }
  public claimDue(user: AuthenticatedUser, now: string, next: (schedule: WorkflowSchedule, after: Date) => string): Promise<ScheduleFiring[]> { void user; void now; void next; return Promise.resolve([]); }
}

test("previews five timezone-aware occurrences", () => {
  const occurrences = nextRuns("0 9 * * 1-5", "Asia/Kolkata", new Date("2026-08-09T00:00:00.000Z"), 5);
  assert.equal(occurrences.length, 5);
  assert.ok(occurrences.every((value) => value.endsWith("Z")));
});

test("creates, pauses, resumes, updates, and deletes a schedule", async () => {
  const store = new MemoryScheduleStore();
  const service = new ScheduleService(store);
  const created = await service.create(owner, { workflowId, cronExpression: "0 9 * * 1-5", timezone: "Asia/Kolkata", dstPolicy: "skip-duplicate", inputBindings: {}, sessionProfileId: profileId });
  assert.equal(created.enabled, true);
  assert.equal((await service.setEnabled(owner, created.id, false)).enabled, false);
  assert.equal((await service.setEnabled(owner, created.id, true)).enabled, true);
  assert.equal((await service.update(owner, created.id, { cronExpression: "0 10 * * 1-5" })).cronExpression, "0 10 * * 1-5");
  await service.remove(owner, created.id);
  assert.equal(store.schedule, undefined);
});

test("prevents reviewers from changing schedules", async () => {
  const reviewer: AuthenticatedUser = { ...owner, role: "reviewer" };
  await assert.rejects(() => new ScheduleService(new MemoryScheduleStore()).create(reviewer, { workflowId, cronExpression: "0 9 * * *", timezone: "UTC", inputBindings: {}, sessionProfileId: profileId }), ScheduleAccessError);
});
