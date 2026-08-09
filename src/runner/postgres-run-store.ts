import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { RunRequest, RunResult, StepResult, WorkflowSpec } from "../contracts/protocol.js";
import { withTenantTransaction, type TenantContext } from "../database/tenant-context.js";
import type { ExecutionRun, PublishedWorkflow, RunCheckpoint, RunStore } from "./run-service.js";

interface RunRow extends Record<string, unknown> {
  id: string; workflow_id: string; workflow_version: number; status: ExecutionRun["status"]; executor: "extension"; requested_at: Date | string;
  started_at: Date | string | null; finished_at: Date | string | null; cancel_requested: boolean; current_step_index: number;
  step_results: StepResult[]; extension_version: string | null; lease_expires_at: Date | string | null; result: RunResult | null; request_digest: string;
  checkpoint: RunCheckpoint | null;
}

export class PostgresRunStore implements RunStore {
  public constructor(private readonly pool: Pool) {}

  public async findPublished(user: AuthenticatedUser, workflowId: string): Promise<PublishedWorkflow | undefined> {
    return this.withUser(user, async (db) => {
      const result = await db.query<{ workflow_id: string; version: number; definition: WorkflowSpec }>(
        "SELECT workflow_id, version, definition FROM workflow_versions WHERE workflow_id = $1 AND status = 'active' AND schema_version = 1 ORDER BY version DESC LIMIT 1",
        [workflowId],
      );
      const row = result.rows[0];
      return row ? { workflowId: row.workflow_id, version: row.version, spec: row.definition } : undefined;
    });
  }

  public async create(user: AuthenticatedUser, request: RunRequest, workflow: WorkflowSpec, idempotencyKey: string, requestDigest: string): Promise<{ created: boolean; run: ExecutionRun; requestDigest: string }> {
    return this.withUser(user, async (db) => {
      const result = await db.query<RunRow>(
        `INSERT INTO workflow_runs (id, tenant_id, requested_by, workflow_id, workflow_version, executor, inputs, workflow_definition, idempotency_key, request_digest, requested_at)
         VALUES ($1, $2, $3, $4, $5, 'extension', $6::jsonb, $7::jsonb, $8, $9, $10)
         ON CONFLICT (tenant_id, requested_by, idempotency_key) DO NOTHING
         RETURNING *`,
        [request.runId, user.tenantId, user.userId, request.workflowId, request.workflowVersion, JSON.stringify(request.inputs), JSON.stringify(workflow), idempotencyKey, requestDigest, request.requestedAt],
      );
      const inserted = result.rows[0];
      if (inserted) return { created: true, run: mapRun(inserted), requestDigest: inserted.request_digest };
      const existing = await db.query<RunRow>("SELECT * FROM workflow_runs WHERE tenant_id = $1 AND requested_by = $2 AND idempotency_key = $3", [user.tenantId, user.userId, idempotencyKey]);
      const row = existing.rows[0];
      if (!row) throw new Error("Idempotent run lookup failed.");
      return { created: false, run: mapRun(row), requestDigest: row.request_digest };
    });
  }

  public list(user: AuthenticatedUser, limit: number): Promise<ExecutionRun[]> {
    return this.withUser(user, async (db) => (await db.query<RunRow>("SELECT * FROM workflow_runs ORDER BY requested_at DESC LIMIT $1", [limit])).rows.map(mapRun));
  }

  public find(user: AuthenticatedUser, runId: string): Promise<ExecutionRun | undefined> {
    return this.withUser(user, async (db) => { const row = (await db.query<RunRow>("SELECT * FROM workflow_runs WHERE id = $1", [runId])).rows[0]; return row ? mapRun(row) : undefined; });
  }

  public claim(user: AuthenticatedUser, input: { extensionVersion: string; capabilities: string[]; leaseTokenHash: string; leaseExpiresAt: string }): Promise<{ run: ExecutionRun; request: RunRequest; workflow: WorkflowSpec; checkpoint?: RunCheckpoint } | undefined> {
    return this.withUser(user, async (db) => {
      const selected = await db.query<RunRow & { inputs: Record<string, string>; workflow_definition: WorkflowSpec }>(
        `WITH candidate AS (
           SELECT id FROM workflow_runs
           WHERE status IN ('queued', 'running') AND cancel_requested = false
             AND (status = 'queued' OR lease_expires_at IS NULL OR lease_expires_at < now())
           ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE workflow_runs runs SET status = 'running', started_at = COALESCE(runs.started_at, now()), extension_version = $1,
           extension_capabilities = $2::jsonb, lease_token_hash = $3, lease_expires_at = $4, heartbeat_at = now()
         FROM candidate WHERE runs.id = candidate.id RETURNING runs.*`,
        [input.extensionVersion, JSON.stringify(input.capabilities), input.leaseTokenHash, input.leaseExpiresAt],
      );
      const row = selected.rows[0];
      if (!row) return undefined;
      const request: RunRequest = { schemaVersion: 1, runId: row.id, workflowId: row.workflow_id, workflowVersion: row.workflow_version, executor: "extension", inputs: row.inputs, requestedAt: iso(row.requested_at) };
      return { run: mapRun(row), request, workflow: row.workflow_definition, ...(row.checkpoint ? { checkpoint: row.checkpoint } : {}) };
    });
  }

  public heartbeat(user: AuthenticatedUser, runId: string, leaseTokenHash: string, leaseExpiresAt: string): Promise<ExecutionRun | undefined> {
    return this.updateLease(user, runId, leaseTokenHash, "UPDATE workflow_runs SET heartbeat_at = now(), lease_expires_at = $3 WHERE id = $1 AND status = 'running' AND lease_token_hash = $2 AND lease_expires_at >= now() RETURNING *", [runId, leaseTokenHash, leaseExpiresAt]);
  }

  public checkpoint(user: AuthenticatedUser, runId: string, leaseTokenHash: string, checkpoint: RunCheckpoint, leaseExpiresAt: string): Promise<ExecutionRun | undefined> {
    return this.updateLease(user, runId, leaseTokenHash,
      "UPDATE workflow_runs SET current_step_index = $3, step_results = $4::jsonb, checkpoint = $5::jsonb, heartbeat_at = now(), lease_expires_at = $6 WHERE id = $1 AND status = 'running' AND lease_token_hash = $2 AND lease_expires_at >= now() RETURNING *",
      [runId, leaseTokenHash, checkpoint.currentStepIndex, JSON.stringify(checkpoint.stepResults), JSON.stringify(checkpoint), leaseExpiresAt]);
  }

  public finish(user: AuthenticatedUser, runId: string, leaseTokenHash: string, result: RunResult): Promise<ExecutionRun | undefined> {
    return this.updateLease(user, runId, leaseTokenHash,
      "UPDATE workflow_runs SET status = CASE WHEN cancel_requested THEN 'cancelled' ELSE $3 END, step_results = $4::jsonb, result = $5::jsonb, finished_at = now(), lease_token_hash = NULL, lease_expires_at = NULL WHERE id = $1 AND status = 'running' AND lease_token_hash = $2 RETURNING *",
      [runId, leaseTokenHash, result.status, JSON.stringify(result.stepResults), JSON.stringify(result)]);
  }

  public cancel(user: AuthenticatedUser, runId: string): Promise<ExecutionRun | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<RunRow>(
        "UPDATE workflow_runs SET cancel_requested = true, status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END, finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled') RETURNING *",
        [runId],
      )).rows[0];
      if (row) return mapRun(row);
      const existing = (await db.query<RunRow>("SELECT * FROM workflow_runs WHERE id = $1", [runId])).rows[0];
      return existing ? mapRun(existing) : undefined;
    });
  }

  private updateLease(user: AuthenticatedUser, runId: string, leaseTokenHash: string, query: string, values: unknown[]): Promise<ExecutionRun | undefined> {
    return this.withUser(user, async (db) => { const row = (await db.query<RunRow>(query, values)).rows[0]; return row ? mapRun(row) : undefined; });
  }

  private async withUser<T>(user: TenantContext, work: Parameters<typeof withTenantTransaction<T>>[2]): Promise<T> {
    const client = await this.pool.connect();
    try { return await withTenantTransaction(client, user, work); } finally { client.release(); }
  }
}

function mapRun(row: RunRow): ExecutionRun {
  return {
    id: row.id, workflowId: row.workflow_id, workflowVersion: row.workflow_version, status: row.status, executor: row.executor,
    requestedAt: iso(row.requested_at), cancelRequested: row.cancel_requested, currentStepIndex: row.current_step_index,
    stepResults: row.step_results ?? [],
    ...(row.started_at ? { startedAt: iso(row.started_at) } : {}), ...(row.finished_at ? { finishedAt: iso(row.finished_at) } : {}),
    ...(row.extension_version ? { extensionVersion: row.extension_version } : {}), ...(row.lease_expires_at ? { leaseExpiresAt: iso(row.lease_expires_at) } : {}),
    ...(row.result ? { result: row.result } : {}),
  };
}

function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
