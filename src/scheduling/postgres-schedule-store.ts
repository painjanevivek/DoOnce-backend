import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import type { ScheduleFiring, ScheduleStore, WorkflowSchedule } from "./schedule-service.js";

interface Row extends Record<string, unknown> {
  id: string;
  workflow_id: string;
  cron_expression: string;
  timezone: string;
  dst_policy: WorkflowSchedule["dstPolicy"];
  input_bindings: Record<string, string>;
  session_profile_id: string;
  enabled: boolean;
  next_run_at: Date | string;
  last_enqueued_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresScheduleStore implements ScheduleStore {
  public constructor(private readonly pool: Pool) {}

  public create(user: AuthenticatedUser, schedule: WorkflowSchedule): Promise<WorkflowSchedule> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<Row>(
        `INSERT INTO workflow_schedules (id, tenant_id, workflow_id, cron_expression, timezone, dst_policy, input_bindings, session_profile_id, enabled, next_run_at, created_by)
         SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8, true, $9, $10
         WHERE EXISTS (SELECT 1 FROM workflow_versions WHERE workflow_id = $3 AND status = 'active')
           AND EXISTS (SELECT 1 FROM browser_session_profiles WHERE id = $8 AND location = 'managed' AND enabled = true)
         RETURNING *`,
        [schedule.id, user.tenantId, schedule.workflowId, schedule.cronExpression, schedule.timezone, schedule.dstPolicy, JSON.stringify(schedule.inputBindings), schedule.sessionProfileId, schedule.nextRunAt, user.userId],
      )).rows[0];
      if (!row) throw new Error("Schedule requires a published workflow and enabled managed browser session.");
      return map(row);
    });
  }

  public list(user: AuthenticatedUser, workflowId?: string): Promise<WorkflowSchedule[]> {
    return this.withUser(user, async (db) => (await db.query<Row>(
      `SELECT * FROM workflow_schedules ${workflowId ? "WHERE workflow_id = $1" : ""} ORDER BY created_at DESC LIMIT 200`,
      workflowId ? [workflowId] : [],
    )).rows.map(map));
  }

  public find(user: AuthenticatedUser, id: string): Promise<WorkflowSchedule | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<Row>("SELECT * FROM workflow_schedules WHERE id = $1", [id])).rows[0];
      return row ? map(row) : undefined;
    });
  }

  public update(user: AuthenticatedUser, schedule: WorkflowSchedule): Promise<WorkflowSchedule | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<Row>(
        `UPDATE workflow_schedules SET cron_expression = $2, timezone = $3, dst_policy = $4,
           input_bindings = $5::jsonb, session_profile_id = $6, next_run_at = $7, updated_at = now()
         WHERE id = $1 AND EXISTS (
           SELECT 1 FROM browser_session_profiles WHERE id = $6 AND location = 'managed' AND enabled = true
         ) RETURNING *`,
        [schedule.id, schedule.cronExpression, schedule.timezone, schedule.dstPolicy, JSON.stringify(schedule.inputBindings), schedule.sessionProfileId, schedule.nextRunAt],
      )).rows[0];
      return row ? map(row) : undefined;
    });
  }

  public setEnabled(user: AuthenticatedUser, id: string, enabled: boolean, nextRunAt: string): Promise<WorkflowSchedule | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<Row>(
        "UPDATE workflow_schedules SET enabled = $2, next_run_at = $3, updated_at = now() WHERE id = $1 RETURNING *",
        [id, enabled, nextRunAt],
      )).rows[0];
      return row ? map(row) : undefined;
    });
  }

  public remove(user: AuthenticatedUser, id: string): Promise<boolean> {
    return this.withUser(user, async (db) => Boolean((await db.query<{ id: string }>(
      "DELETE FROM workflow_schedules WHERE id = $1 RETURNING id",
      [id],
    )).rows[0]));
  }

  public claimDue(user: AuthenticatedUser, now: string, next: (schedule: WorkflowSchedule, after: Date) => string): Promise<ScheduleFiring[]> {
    return this.withUser(user, async (db) => {
      const rows = (await db.query<Row>(
        "SELECT * FROM workflow_schedules WHERE enabled = true AND next_run_at <= $1 ORDER BY next_run_at, id FOR UPDATE SKIP LOCKED LIMIT 100",
        [now],
      )).rows;
      const firings: ScheduleFiring[] = [];
      for (const row of rows) {
        const schedule = map(row);
        const scheduledFor = schedule.nextRunAt;
        const idempotencyKey = `schedule:${schedule.id}:${scheduledFor}`;
        const receipt = (await db.query<{ id: string }>(
          `INSERT INTO workflow_trigger_receipts (tenant_id, workflow_id, trigger_kind, source_id, idempotency_key)
           VALUES ($1, $2, 'schedule', $3, $4)
           ON CONFLICT (tenant_id, trigger_kind, idempotency_key) DO NOTHING RETURNING id`,
          [user.tenantId, schedule.workflowId, schedule.id, idempotencyKey],
        )).rows[0];
        await db.query(
          `UPDATE workflow_schedules
           SET next_run_at = $2, last_enqueued_at = CASE WHEN $3::boolean THEN $1 ELSE last_enqueued_at END, updated_at = now()
           WHERE id = $4`,
          [scheduledFor, next(schedule, new Date(scheduledFor)), Boolean(receipt), schedule.id],
        );
        if (receipt) firings.push({ schedule, scheduledFor, idempotencyKey });
      }
      return firings;
    });
  }

  private async withUser<T>(user: AuthenticatedUser, work: Parameters<typeof withTenantTransaction<T>>[2]): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, work);
    } finally {
      client.release();
    }
  }
}

function map(row: Row): WorkflowSchedule {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    dstPolicy: row.dst_policy,
    inputBindings: row.input_bindings,
    sessionProfileId: row.session_profile_id,
    enabled: row.enabled,
    nextRunAt: iso(row.next_run_at),
    ...(row.last_enqueued_at ? { lastEnqueuedAt: iso(row.last_enqueued_at) } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
