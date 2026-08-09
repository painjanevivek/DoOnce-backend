import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import { AuthoringLimitError, type AuthoringJob, type AuthoringJobEvent, type AuthoringJobStore, type AuthoringOutcome } from "./authoring-service.js";

interface JobRow extends Record<string, unknown> {
  id: string; status: AuthoringJob["status"]; task_description: string; starting_url: string | null; available_inputs: AuthoringJob["request"]["availableInputs"];
  observation_session_id: string | null; executor_capabilities: AuthoringJob["request"]["executorCapabilities"]; workflow_schema_version: 1;
  provider: string; model: string; prompt_version: string; progress_phase: string; progress_message: string; result: AuthoringOutcome | null; workflow_id: string | null;
  error_code: string | null; attempts: number; validation_retries: number; prompt_tokens: number; completion_tokens: number; estimated_cost_microusd: number | string;
  latency_ms: number; created_at: Date | string; updated_at: Date | string; started_at: Date | string | null; finished_at: Date | string | null; request_digest: string;
}

export class PostgresAuthoringJobStore implements AuthoringJobStore {
  public constructor(private readonly pool: Pool) {}

  public enqueue(user: AuthenticatedUser, job: AuthoringJob, idempotencyKey: string, requestDigest: string): Promise<{ created: boolean; job: AuthoringJob; requestDigest: string }> {
    return this.withUser(user, async (db) => {
      await db.query("INSERT INTO authoring_tenant_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [user.tenantId]);
      const settings = (await db.query<{ enabled: boolean; daily_job_limit: number; daily_token_limit: number }>("SELECT enabled, daily_job_limit, daily_token_limit FROM authoring_tenant_settings WHERE tenant_id = $1 FOR UPDATE", [user.tenantId])).rows[0];
      if (!settings?.enabled) throw new AuthoringLimitError("Text authoring is not enabled for this workspace.");
      const existing = (await db.query<JobRow>("SELECT * FROM authoring_jobs WHERE tenant_id = $1 AND requested_by = $2 AND idempotency_key = $3", [user.tenantId, user.userId, idempotencyKey])).rows[0];
      if (existing) return { created: false, job: map(existing), requestDigest: existing.request_digest };
      const usage = (await db.query<{ jobs: number | string; tokens: number | string }>("SELECT count(*) AS jobs, COALESCE(sum(prompt_tokens + completion_tokens), 0) AS tokens FROM authoring_jobs WHERE tenant_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'", [user.tenantId])).rows[0];
      if (Number(usage?.jobs ?? 0) >= settings.daily_job_limit) throw new AuthoringLimitError("This workspace reached its daily text-authoring job limit.");
      if (Number(usage?.tokens ?? 0) >= settings.daily_token_limit) throw new AuthoringLimitError("This workspace reached its daily text-authoring token limit.");
      const inserted = (await db.query<JobRow>(
        `INSERT INTO authoring_jobs (id, tenant_id, requested_by, task_description, starting_url, available_inputs, observation_session_id, executor_capabilities, workflow_schema_version, provider, model, prompt_version, progress_phase, progress_message, idempotency_key, request_digest)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, 1, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (tenant_id, requested_by, idempotency_key) DO NOTHING RETURNING *`,
        [job.id, user.tenantId, user.userId, job.request.taskDescription, job.request.startingUrl ?? null, JSON.stringify(job.request.availableInputs), job.request.observationSessionId ?? null, JSON.stringify(job.request.executorCapabilities), job.provider, job.model, job.promptVersion, job.progress.phase, job.progress.message, idempotencyKey, requestDigest],
      )).rows[0];
      if (inserted) { await event(db, user.tenantId, inserted.id, "authoring.queued", { provider: inserted.provider, promptVersion: inserted.prompt_version }); return { created: true, job: map(inserted), requestDigest }; }
      const winner = (await db.query<JobRow>("SELECT * FROM authoring_jobs WHERE tenant_id = $1 AND requested_by = $2 AND idempotency_key = $3", [user.tenantId, user.userId, idempotencyKey])).rows[0];
      if (!winner) throw new Error("Idempotent authoring lookup failed.");
      return { created: false, job: map(winner), requestDigest: winner.request_digest };
    });
  }
  public find(user: AuthenticatedUser, jobId: string): Promise<AuthoringJob | undefined> { return this.withUser(user, async (db) => { const row = (await db.query<JobRow>("SELECT * FROM authoring_jobs WHERE id = $1", [jobId])).rows[0]; return row ? map(row) : undefined; }); }
  public events(user: AuthenticatedUser, jobId: string): Promise<AuthoringJobEvent[]> { return this.withUser(user, async (db) => (await db.query<{ id: string; event_type: string; metadata: Record<string, unknown>; created_at: Date | string }>("SELECT id, event_type, metadata, created_at FROM authoring_job_events WHERE job_id = $1 ORDER BY created_at, id LIMIT 500", [jobId])).rows.map((row) => ({ id: row.id, eventType: row.event_type, metadata: row.metadata, createdAt: iso(row.created_at) }))); }
  public claim(user: AuthenticatedUser, jobId: string): Promise<AuthoringJob | undefined> { return this.withUser(user, async (db) => {
    const row = (await db.query<JobRow>("UPDATE authoring_jobs SET status = 'running', progress_phase = 'starting', progress_message = 'Starting the authoring provider.', attempts = attempts + 1, started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1 AND attempts < 3 AND (status = 'queued' OR (status = 'running' AND updated_at < now() - interval '5 minutes')) RETURNING *", [jobId])).rows[0];
    if (row) await event(db, user.tenantId, jobId, "authoring.started", { attempt: row.attempts });
    return row ? map(row) : undefined;
  }); }
  public progress(user: AuthenticatedUser, jobId: string, phase: string, message: string): Promise<boolean> { return this.withUser(user, async (db) => { const row = (await db.query<{ id: string }>("UPDATE authoring_jobs SET progress_phase = $2, progress_message = $3, updated_at = now() WHERE id = $1 AND status = 'running' RETURNING id", [jobId, phase, message])).rows[0]; if (row) await event(db, user.tenantId, jobId, "authoring.progress", { phase, message }); return Boolean(row); }); }
  public finish(user: AuthenticatedUser, jobId: string, input: { status: "needs-input" | "completed" | "failed"; result?: AuthoringOutcome; workflowId?: string; errorCode?: string; validationRetries: number; usage: AuthoringJob["usage"]; latencyMs: number }): Promise<AuthoringJob | undefined> { return this.withUser(user, async (db) => {
    const message = input.status === "completed" ? "Draft created and ready for review." : input.status === "needs-input" ? "More information is needed before a draft can be created." : "The provider could not create a valid draft.";
    const row = (await db.query<JobRow>("UPDATE authoring_jobs SET status = $2, progress_phase = $2, progress_message = $3, result = $4::jsonb, workflow_id = $5, error_code = $6, validation_retries = $7, prompt_tokens = $8, completion_tokens = $9, estimated_cost_microusd = $10, latency_ms = $11, finished_at = now(), updated_at = now() WHERE id = $1 AND status = 'running' RETURNING *", [jobId, input.status, message, input.result ? JSON.stringify(input.result) : null, input.workflowId ?? null, input.errorCode ?? null, input.validationRetries, input.usage.promptTokens, input.usage.completionTokens, input.usage.estimatedCostMicrousd, input.latencyMs])).rows[0];
    if (row) await event(db, user.tenantId, jobId, `authoring.${input.status}`, { workflowId: input.workflowId ?? null, errorCode: input.errorCode ?? null, validationRetries: input.validationRetries, promptTokens: input.usage.promptTokens, completionTokens: input.usage.completionTokens, latencyMs: input.latencyMs });
    return row ? map(row) : undefined;
  }); }
  public cancel(user: AuthenticatedUser, jobId: string): Promise<AuthoringJob | undefined> { return this.withUser(user, async (db) => { const cancelled = (await db.query<JobRow>("UPDATE authoring_jobs SET status = 'cancelled', progress_phase = 'cancelled', progress_message = 'Authoring was cancelled.', finished_at = now(), updated_at = now() WHERE id = $1 AND status IN ('queued', 'running') RETURNING *", [jobId])).rows[0]; if (cancelled) await event(db, user.tenantId, jobId, "authoring.cancelled", {}); const row = cancelled ?? (await db.query<JobRow>("SELECT * FROM authoring_jobs WHERE id = $1", [jobId])).rows[0]; return row ? map(row) : undefined; }); }
  private async withUser<T>(user: AuthenticatedUser, work: Parameters<typeof withTenantTransaction<T>>[2]): Promise<T> { const client = await this.pool.connect(); try { return await withTenantTransaction(client, user, work); } finally { client.release(); } }
}

async function event(db: import("../database/migrator.js").SqlClient, tenantId: string, jobId: string, eventType: string, metadata: Record<string, unknown>): Promise<void> { await db.query("INSERT INTO authoring_job_events (tenant_id, job_id, event_type, metadata) VALUES ($1, $2, $3, $4::jsonb)", [tenantId, jobId, eventType, JSON.stringify(metadata)]); }
function map(row: JobRow): AuthoringJob { return { id: row.id, status: row.status, request: { taskDescription: row.task_description, ...(row.starting_url ? { startingUrl: row.starting_url } : {}), availableInputs: row.available_inputs, ...(row.observation_session_id ? { observationSessionId: row.observation_session_id } : {}), executorCapabilities: row.executor_capabilities, workflowSchemaVersion: row.workflow_schema_version }, provider: row.provider, model: row.model, promptVersion: row.prompt_version, progress: { phase: row.progress_phase, message: row.progress_message }, attempts: row.attempts, validationRetries: row.validation_retries, usage: { promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, estimatedCostMicrousd: Number(row.estimated_cost_microusd) }, latencyMs: row.latency_ms, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.started_at ? { startedAt: iso(row.started_at) } : {}), ...(row.finished_at ? { finishedAt: iso(row.finished_at) } : {}), ...(row.workflow_id ? { workflowId: row.workflow_id } : {}), ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.result ? { result: row.result } : {}) }; }
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
