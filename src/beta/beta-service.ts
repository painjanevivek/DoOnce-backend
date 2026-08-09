import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import {
  betaCompatibilityMatrix,
  betaEnrollmentStatuses,
  betaFailureCategories,
  betaObservationStages,
  betaTaskCategories,
  type BetaEnrollmentStatus,
  type BetaFailureCategory,
  type BetaObservationStage,
  type BetaSummary,
  type BetaTaskCategory,
  type BetaWorkflowEnrollment,
} from "./beta-types.js";

export interface BetaStore {
  enroll(user: AuthenticatedUser, input: {
    id: string;
    workflowId: string;
    taskCategory: BetaTaskCategory;
    baselineDurationSeconds: number;
    baselineErrorRatePercent: number;
  }): Promise<BetaWorkflowEnrollment | undefined>;
  list(user: AuthenticatedUser): Promise<BetaWorkflowEnrollment[]>;
  setStatus(user: AuthenticatedUser, enrollmentId: string, status: BetaEnrollmentStatus): Promise<BetaWorkflowEnrollment | undefined>;
  observeRun(user: AuthenticatedUser, input: {
    id: string;
    enrollmentId: string;
    runId: string;
    stage: BetaObservationStage;
    developerIntervened: boolean;
  }): Promise<boolean>;
  recordFailure(user: AuthenticatedUser, input: {
    id: string;
    enrollmentId: string;
    runId?: string;
    category: BetaFailureCategory;
    errorCode?: string;
  }): Promise<boolean>;
  summary(user: AuthenticatedUser): Promise<BetaSummary>;
}

export class BetaInputError extends Error {}
export class BetaAccessError extends Error {}
export class BetaConflictError extends Error {}

export class BetaService {
  public constructor(private readonly store: BetaStore) {}

  public compatibility() { return betaCompatibilityMatrix; }

  public async enroll(user: AuthenticatedUser, input: unknown): Promise<BetaWorkflowEnrollment> {
    requireCoordinator(user);
    const value = record(input);
    const baselineMinutes = number(value.baselineDurationMinutes, "Baseline duration", 1 / 60, 1440);
    const created = await this.store.enroll(user, {
      id: randomUUID(),
      workflowId: uuid(value.workflowId),
      taskCategory: member(value.taskCategory, betaTaskCategories, "task category"),
      baselineDurationSeconds: Math.round(baselineMinutes * 60),
      baselineErrorRatePercent: number(value.baselineErrorRatePercent, "Baseline error rate", 0, 100),
    });
    if (!created) throw new BetaConflictError("The workflow does not exist or is already enrolled.");
    return created;
  }

  public list(user: AuthenticatedUser): Promise<BetaWorkflowEnrollment[]> {
    requireCoordinator(user);
    return this.store.list(user);
  }

  public async setStatus(user: AuthenticatedUser, enrollmentId: string, input: unknown): Promise<BetaWorkflowEnrollment> {
    requireCoordinator(user);
    const value = record(input);
    const updated = await this.store.setStatus(user, uuid(enrollmentId), member(value.status, betaEnrollmentStatuses, "status"));
    if (!updated) throw new BetaInputError("Beta enrollment not found.");
    return updated;
  }

  public async observeRun(user: AuthenticatedUser, enrollmentId: string, input: unknown): Promise<void> {
    requireCoordinator(user);
    const value = record(input);
    const accepted = await this.store.observeRun(user, {
      id: randomUUID(),
      enrollmentId: uuid(enrollmentId),
      runId: uuid(value.runId),
      stage: member(value.stage, betaObservationStages, "observation stage"),
      developerIntervened: boolean(value.developerIntervened, "developerIntervened"),
    });
    if (!accepted) throw new BetaConflictError("The run does not belong to this enrolled workflow or was already observed.");
  }

  public async recordFailure(user: AuthenticatedUser, enrollmentId: string, input: unknown): Promise<void> {
    requireCoordinator(user);
    const value = record(input);
    const runId = value.runId === undefined ? undefined : uuid(value.runId);
    const errorCode = value.errorCode === undefined ? undefined : stableCode(value.errorCode);
    const accepted = await this.store.recordFailure(user, {
      id: randomUUID(),
      enrollmentId: uuid(enrollmentId),
      ...(runId ? { runId } : {}),
      category: member(value.category, betaFailureCategories, "failure category"),
      ...(errorCode ? { errorCode } : {}),
    });
    if (!accepted) throw new BetaInputError("Beta enrollment or run not found.");
  }

  public summary(user: AuthenticatedUser): Promise<BetaSummary> {
    requireCoordinator(user);
    return this.store.summary(user);
  }
}

function requireCoordinator(user: AuthenticatedUser): void {
  if (user.role !== "owner" && user.role !== "builder") throw new BetaAccessError("Only workspace owners and builders can coordinate beta workflows.");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BetaInputError("A JSON object is required.");
  return value as Record<string, unknown>;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BetaInputError("A valid identifier is required.");
  return value;
}

function member<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new BetaInputError(`A supported ${label} is required.`);
  return value as T[number];
}

function number(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new BetaInputError(`${label} must be between ${minimum} and ${maximum}.`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new BetaInputError(`${label} must be a boolean.`);
  return value;
}

function stableCode(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(value)) throw new BetaInputError("Error code must be a stable lowercase code.");
  return value;
}
