import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import type { AuthenticatedUser } from "../auth/auth-service.js";

export interface WorkflowSchedule {
  id: string;
  workflowId: string;
  cronExpression: string;
  timezone: string;
  dstPolicy: "run-once" | "skip-duplicate";
  inputBindings: Record<string, string>;
  sessionProfileId: string;
  enabled: boolean;
  nextRunAt: string;
  lastEnqueuedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleFiring {
  schedule: WorkflowSchedule;
  scheduledFor: string;
  idempotencyKey: string;
}

export interface ScheduleStore {
  create(user: AuthenticatedUser, schedule: WorkflowSchedule): Promise<WorkflowSchedule>;
  list(user: AuthenticatedUser, workflowId?: string): Promise<WorkflowSchedule[]>;
  find(user: AuthenticatedUser, id: string): Promise<WorkflowSchedule | undefined>;
  update(user: AuthenticatedUser, schedule: WorkflowSchedule): Promise<WorkflowSchedule | undefined>;
  setEnabled(user: AuthenticatedUser, id: string, enabled: boolean, nextRunAt: string): Promise<WorkflowSchedule | undefined>;
  remove(user: AuthenticatedUser, id: string): Promise<boolean>;
  claimDue(user: AuthenticatedUser, now: string, next: (schedule: WorkflowSchedule, after: Date) => string): Promise<ScheduleFiring[]>;
}

export class ScheduleInputError extends Error {}
export class ScheduleAccessError extends Error {}

export class ScheduleService {
  public constructor(private readonly store: ScheduleStore) {}

  public async create(user: AuthenticatedUser, input: unknown): Promise<WorkflowSchedule> {
    requireAuthor(user);
    const parsed = parse(input);
    const now = new Date();
    const nextRunAt = nextRuns(parsed.cronExpression, parsed.timezone, now, 1)[0];
    if (!nextRunAt) throw new ScheduleInputError("The schedule does not have a future run time.");
    const timestamp = now.toISOString();
    try {
      return await this.store.create(user, { id: randomUUID(), ...parsed, enabled: true, nextRunAt, createdAt: timestamp, updatedAt: timestamp });
    } catch (error) {
      if (error instanceof Error && error.message.includes("published workflow")) throw new ScheduleInputError(error.message);
      throw error;
    }
  }

  public list(user: AuthenticatedUser, workflowId?: string): Promise<WorkflowSchedule[]> {
    return this.store.list(user, workflowId ? uuid(workflowId) : undefined);
  }

  public preview(input: unknown): string[] {
    if (!record(input)) throw new ScheduleInputError("A cron expression and timezone are required.");
    return nextRuns(cron(input.cronExpression), zone(input.timezone), new Date(), 5);
  }

  public async update(user: AuthenticatedUser, id: string, input: unknown): Promise<WorkflowSchedule> {
    requireAuthor(user);
    const existing = await this.store.find(user, uuid(id));
    if (!existing) throw new ScheduleInputError("Schedule not found.");
    const parsed = parse({ ...existing, ...(record(input) ? input : {}), workflowId: existing.workflowId });
    const nextRunAt = nextRuns(parsed.cronExpression, parsed.timezone, new Date(), 1)[0];
    if (!nextRunAt) throw new ScheduleInputError("The schedule does not have a future run time.");
    const updated = await this.store.update(user, { ...existing, ...parsed, nextRunAt, updatedAt: new Date().toISOString() });
    if (!updated) throw new ScheduleInputError("Schedule not found.");
    return updated;
  }

  public async setEnabled(user: AuthenticatedUser, id: string, enabled: boolean): Promise<WorkflowSchedule> {
    requireAuthor(user);
    const existing = await this.store.find(user, uuid(id));
    if (!existing) throw new ScheduleInputError("Schedule not found.");
    const next = enabled ? nextRuns(existing.cronExpression, existing.timezone, new Date(), 1)[0] : existing.nextRunAt;
    if (!next) throw new ScheduleInputError("The schedule does not have a future run time.");
    const updated = await this.store.setEnabled(user, existing.id, enabled, next);
    if (!updated) throw new ScheduleInputError("Schedule not found.");
    return updated;
  }

  public async remove(user: AuthenticatedUser, id: string): Promise<void> {
    requireAuthor(user);
    if (!await this.store.remove(user, uuid(id))) throw new ScheduleInputError("Schedule not found.");
  }

  public expandDue(user: AuthenticatedUser, now = new Date()): Promise<ScheduleFiring[]> {
    return this.store.claimDue(user, now.toISOString(), nextOccurrence);
  }
}

export function nextRuns(expression: string, timezone: string, after: Date, count: number): string[] {
  try {
    return new Cron(expression, { timezone, paused: true, maxRuns: count + 1 })
      .nextRuns(Math.min(Math.max(count, 1), 20), after)
      .map((date) => date.toISOString());
  } catch {
    throw new ScheduleInputError("The cron expression or timezone is invalid.");
  }
}

function nextOccurrence(schedule: WorkflowSchedule, after: Date): string {
  const candidates = nextRuns(schedule.cronExpression, schedule.timezone, after, 3);
  if (schedule.dstPolicy === "run-once") {
    const next = candidates[0];
    if (!next) throw new ScheduleInputError("A schedule has no future occurrence.");
    return next;
  }
  const previousWallTime = localWallTime(after, schedule.timezone);
  const next = candidates.find((candidate) => localWallTime(new Date(candidate), schedule.timezone) !== previousWallTime);
  if (!next) throw new ScheduleInputError("A schedule has no future non-duplicate occurrence.");
  return next;
}

function localWallTime(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function parse(input: unknown): Omit<WorkflowSchedule, "id" | "enabled" | "nextRunAt" | "createdAt" | "updatedAt" | "lastEnqueuedAt"> {
  if (!record(input)) throw new ScheduleInputError("The schedule request is invalid.");
  const inputBindings = input.inputBindings === undefined ? {} : input.inputBindings;
  if (!record(inputBindings) || Object.keys(inputBindings).length > 50 || !Object.values(inputBindings).every((value) => typeof value === "string" && value.length <= 10_000)) {
    throw new ScheduleInputError("Schedule inputs must contain at most 50 text values.");
  }
  if (input.dstPolicy !== undefined && input.dstPolicy !== "run-once" && input.dstPolicy !== "skip-duplicate") {
    throw new ScheduleInputError("DST policy must be run-once or skip-duplicate.");
  }
  return {
    workflowId: uuid(input.workflowId),
    cronExpression: cron(input.cronExpression),
    timezone: zone(input.timezone),
    dstPolicy: input.dstPolicy === "skip-duplicate" ? "skip-duplicate" : "run-once",
    inputBindings: inputBindings as Record<string, string>,
    sessionProfileId: uuid(input.sessionProfileId),
  };
}

function cron(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 5 || value.trim().length > 120) throw new ScheduleInputError("Provide a valid cron expression.");
  return value.trim();
}

function zone(value: unknown): string {
  if (typeof value !== "string" || value.length > 100) throw new ScheduleInputError("Provide an IANA timezone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    throw new ScheduleInputError("Provide an IANA timezone.");
  }
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ScheduleInputError("A valid identifier is required.");
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireAuthor(user: AuthenticatedUser): void {
  if (!["owner", "builder"].includes(user.role)) throw new ScheduleAccessError("Only workflow owners and builders can manage schedules.");
}
