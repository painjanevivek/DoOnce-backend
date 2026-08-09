import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import type { BetaStore } from "./beta-service.js";
import type {
  BetaEnrollmentStatus,
  BetaFailureCategory,
  BetaSummary,
  BetaWorkflowEnrollment,
} from "./beta-types.js";

interface EnrollmentRow {
  [key: string]: unknown;
  id: string;
  workflow_id: string;
  task_category: BetaWorkflowEnrollment["taskCategory"];
  baseline_duration_seconds: number;
  baseline_error_rate_percent: string | number;
  status: BetaEnrollmentStatus;
  first_test_observed: boolean;
  first_production_observed: boolean;
  repeat_unassisted_runs: string | number;
  production_runs: string | number;
  successful_production_runs: string | number;
  classified_failures: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

const enrollmentSummarySql = `
  SELECT enrollment.*,
    EXISTS (SELECT 1 FROM beta_run_observations observation WHERE observation.enrollment_id = enrollment.id AND observation.stage = 'first-test') AS first_test_observed,
    EXISTS (SELECT 1 FROM beta_run_observations observation WHERE observation.enrollment_id = enrollment.id AND observation.stage = 'first-production') AS first_production_observed,
    (SELECT count(*) FROM beta_run_observations observation WHERE observation.enrollment_id = enrollment.id AND observation.stage = 'repeat-production' AND observation.developer_intervened = false) AS repeat_unassisted_runs,
    (SELECT count(*) FROM workflow_runs run WHERE run.workflow_id = enrollment.workflow_id AND run.mode = 'production') AS production_runs,
    (SELECT count(*) FROM workflow_runs run WHERE run.workflow_id = enrollment.workflow_id AND run.mode = 'production' AND run.status = 'completed') AS successful_production_runs,
    (SELECT count(*) FROM beta_failure_events failure WHERE failure.enrollment_id = enrollment.id) AS classified_failures
  FROM beta_workflow_enrollments enrollment`;

export class PostgresBetaStore implements BetaStore {
  public constructor(private readonly pool: Pool) {}

  public async enroll(user: AuthenticatedUser, input: Parameters<BetaStore["enroll"]>[1]): Promise<BetaWorkflowEnrollment | undefined> {
    const inserted = await this.withUser(user, async (db) => (await db.query<{ id: string }>(
      `INSERT INTO beta_workflow_enrollments (id, tenant_id, workflow_id, created_by, task_category, baseline_duration_seconds, baseline_error_rate_percent)
       SELECT $1, $2, workflow.id, $3, $4, $5, $6 FROM workflows workflow WHERE workflow.id = $7
       ON CONFLICT (tenant_id, workflow_id) DO NOTHING RETURNING id`,
      [input.id, user.tenantId, user.userId, input.taskCategory, input.baselineDurationSeconds, input.baselineErrorRatePercent, input.workflowId],
    )).rows[0]?.id);
    return inserted ? (await this.list(user)).find((item) => item.id === inserted) : undefined;
  }

  public list(user: AuthenticatedUser): Promise<BetaWorkflowEnrollment[]> {
    return this.withUser(user, async (db) => (await db.query<EnrollmentRow>(
      `${enrollmentSummarySql} ORDER BY enrollment.updated_at DESC, enrollment.id LIMIT 100`,
    )).rows.map(mapEnrollment));
  }

  public async setStatus(user: AuthenticatedUser, enrollmentId: string, status: BetaEnrollmentStatus): Promise<BetaWorkflowEnrollment | undefined> {
    const updated = await this.withUser(user, async (db) => (await db.query<{ id: string }>(
      "UPDATE beta_workflow_enrollments SET status = $2, updated_at = now() WHERE id = $1 RETURNING id",
      [enrollmentId, status],
    )).rows[0]?.id);
    return updated ? (await this.list(user)).find((item) => item.id === updated) : undefined;
  }

  public observeRun(user: AuthenticatedUser, input: Parameters<BetaStore["observeRun"]>[1]): Promise<boolean> {
    return this.withUser(user, async (db) => Boolean((await db.query<{ id: string }>(
      `INSERT INTO beta_run_observations (id, tenant_id, enrollment_id, run_id, stage, developer_intervened, observed_by)
       SELECT $1, enrollment.tenant_id, enrollment.id, run.id, $4, $5, $6
       FROM beta_workflow_enrollments enrollment
       JOIN workflow_runs run ON run.id = $3 AND run.workflow_id = enrollment.workflow_id
       WHERE enrollment.id = $2
         AND (($4 = 'first-test' AND run.mode = 'test') OR ($4 <> 'first-test' AND run.mode = 'production'))
       ON CONFLICT (tenant_id, enrollment_id, run_id) DO NOTHING RETURNING id`,
      [input.id, input.enrollmentId, input.runId, input.stage, input.developerIntervened, user.userId],
    )).rows[0]));
  }

  public recordFailure(user: AuthenticatedUser, input: Parameters<BetaStore["recordFailure"]>[1]): Promise<boolean> {
    return this.withUser(user, async (db) => Boolean((await db.query<{ id: string }>(
      `INSERT INTO beta_failure_events (id, tenant_id, enrollment_id, run_id, category, error_code, classified_by)
       SELECT $1, enrollment.tenant_id, enrollment.id, $3::uuid, $4, $5, $6
       FROM beta_workflow_enrollments enrollment
       LEFT JOIN workflow_runs run ON run.id = $3::uuid AND run.workflow_id = enrollment.workflow_id
       WHERE enrollment.id = $2 AND ($3::uuid IS NULL OR run.id IS NOT NULL)
       RETURNING id`,
      [input.id, input.enrollmentId, input.runId ?? null, input.category, input.errorCode ?? null, user.userId],
    )).rows[0]));
  }

  public async summary(user: AuthenticatedUser): Promise<BetaSummary> {
    const [enrollments, categoryRows] = await Promise.all([
      this.list(user),
      this.withUser(user, async (db) => (await db.query<{ category: BetaFailureCategory; count: string | number }>(
        "SELECT category, count(*) AS count FROM beta_failure_events GROUP BY category ORDER BY count(*) DESC, category LIMIT 7",
      )).rows),
    ]);
    return {
      enrolledWorkflows: enrollments.length,
      workflowsWithFirstTest: enrollments.filter((item) => item.firstTestObserved).length,
      workflowsWithFirstProduction: enrollments.filter((item) => item.firstProductionObserved).length,
      workflowsReadyForIndependentUse: enrollments.filter((item) => item.repeatUnassistedRuns >= 3 && item.productionRuns >= 3 && item.productionSuccessRate >= 90).length,
      totalRepeatUnassistedRuns: enrollments.reduce((total, item) => total + item.repeatUnassistedRuns, 0),
      topFailureCategories: categoryRows.map((row) => ({ category: row.category, count: Number(row.count) })),
    };
  }

  private async withUser<T>(user: AuthenticatedUser, work: Parameters<typeof withTenantTransaction<T>>[2]): Promise<T> {
    const client = await this.pool.connect();
    try { return await withTenantTransaction(client, user, work); } finally { client.release(); }
  }
}

function mapEnrollment(row: EnrollmentRow): BetaWorkflowEnrollment {
  const productionRuns = Number(row.production_runs);
  const successfulProductionRuns = Number(row.successful_production_runs);
  return {
    id: row.id,
    workflowId: row.workflow_id,
    taskCategory: row.task_category,
    baselineDurationSeconds: row.baseline_duration_seconds,
    baselineErrorRatePercent: Number(row.baseline_error_rate_percent),
    status: row.status,
    firstTestObserved: row.first_test_observed,
    firstProductionObserved: row.first_production_observed,
    repeatUnassistedRuns: Number(row.repeat_unassisted_runs),
    productionRuns,
    successfulProductionRuns,
    productionSuccessRate: productionRuns === 0 ? 0 : Math.round((successfulProductionRuns / productionRuns) * 100),
    classifiedFailures: Number(row.classified_failures),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
