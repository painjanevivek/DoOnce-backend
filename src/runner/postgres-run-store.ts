import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { ExecutorKind, RunRequest, RunResult, StepResult, WorkflowSpec } from "../contracts/protocol.js";
import type { SqlClient } from "../database/migrator.js";
import { withTenantTransaction, type TenantContext } from "../database/tenant-context.js";
import type { ExecutionRun, PublishedWorkflow, RunCheckpoint, RunCreationMetadata, RunStore, RunTimeline, RunTimelineArtifact, RunTimelineEvent } from "./run-service.js";

interface RunRow extends Record<string, unknown> {
  id: string; workflow_id: string; workflow_version: number; status: ExecutionRun["status"]; executor: ExecutorKind; requested_at: Date | string;
  started_at: Date | string | null; finished_at: Date | string | null; cancel_requested: boolean; current_step_index: number;
  step_results: StepResult[]; extension_version: string | null; lease_expires_at: Date | string | null; result: RunResult | null; request_digest: string;
  checkpoint: RunCheckpoint | null;
  workflow_checksum: string; mode: "test" | "production";
  trigger_kind: ExecutionRun["triggerKind"];
  session_profile_id: string | null;
  queue_job_id: string | null;
}

export class PostgresRunStore implements RunStore {
  public constructor(private readonly pool: Pool) {}

  public async findExecutable(user: AuthenticatedUser, workflowId: string, mode: "test" | "production"): Promise<PublishedWorkflow | undefined> {
    return this.withUser(user, async (db) => {
      const status = mode === "test" ? "draft" : "active";
      const result = await db.query<{ workflow_id: string; version: number; definition: WorkflowSpec; definition_checksum: string; status: "draft" | "active" }>(
        "SELECT workflow_id, version, definition, definition_checksum, status FROM workflow_versions WHERE workflow_id = $1 AND status = $2 AND schema_version = 1 ORDER BY version DESC LIMIT 1",
        [workflowId, status],
      );
      const row = result.rows[0];
      return row ? { workflowId: row.workflow_id, version: row.version, checksum: row.definition_checksum, status: row.status, spec: row.definition } : undefined;
    });
  }

  public async create(user: AuthenticatedUser, request: RunRequest, workflow: PublishedWorkflow, idempotencyKey: string, requestDigest: string, metadata: RunCreationMetadata = { triggerKind: "manual", sessionLocation: "user-browser" }): Promise<{ created: boolean; run: ExecutionRun; requestDigest: string }> {
    return this.withUser(user, async (db) => {
      const result = await db.query<RunRow>(
        `INSERT INTO workflow_runs (id, tenant_id, requested_by, workflow_id, workflow_version, workflow_checksum, mode, executor, trigger_kind, session_profile_id, inputs, workflow_definition, idempotency_key, request_digest, requested_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15
         WHERE $10::uuid IS NULL OR EXISTS (
           SELECT 1 FROM browser_session_profiles
           WHERE id = $10 AND tenant_id = $2 AND location = 'managed' AND enabled = true
         )
         ON CONFLICT (tenant_id, requested_by, idempotency_key) DO NOTHING
         RETURNING *`,
        [request.runId, user.tenantId, user.userId, request.workflowId, request.workflowVersion, workflow.checksum, workflow.status === "draft" ? "test" : "production", request.executor, metadata.triggerKind, metadata.sessionProfileId ?? null, JSON.stringify(request.inputs), JSON.stringify(workflow.spec), idempotencyKey, requestDigest, request.requestedAt],
      );
      const inserted = result.rows[0];
      if (inserted) { await db.query("INSERT INTO run_events (run_id, tenant_id, event_type, metadata) VALUES ($1, $2, 'run.queued', $3::jsonb)", [inserted.id, user.tenantId, JSON.stringify({ mode: inserted.mode, workflowChecksum: inserted.workflow_checksum })]); return { created: true, run: mapRun(inserted), requestDigest: inserted.request_digest }; }
      const existing = await db.query<RunRow>("SELECT * FROM workflow_runs WHERE tenant_id = $1 AND requested_by = $2 AND idempotency_key = $3", [user.tenantId, user.userId, idempotencyKey]);
      const row = existing.rows[0];
      if (!row) throw new Error("The selected managed browser session is unavailable.");
      return { created: false, run: mapRun(row), requestDigest: row.request_digest };
    });
  }

  public list(user: AuthenticatedUser, limit: number): Promise<ExecutionRun[]> {
    return this.withUser(user, async (db) => (await db.query<RunRow>("SELECT * FROM workflow_runs ORDER BY requested_at DESC LIMIT $1", [limit])).rows.map(mapRun));
  }

  public find(user: AuthenticatedUser, runId: string): Promise<ExecutionRun | undefined> {
    return this.withUser(user, async (db) => { const row = (await db.query<RunRow>("SELECT * FROM workflow_runs WHERE id = $1", [runId])).rows[0]; return row ? mapRun(row) : undefined; });
  }

  public timeline(user: AuthenticatedUser, runId: string): Promise<RunTimeline | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<RunRow>("SELECT * FROM workflow_runs WHERE id = $1", [runId])).rows[0];
      if (!row) return undefined;
      const [steps, events, artifacts] = await Promise.all([
        db.query<{ result: StepResult }>("SELECT result FROM workflow_step_runs WHERE run_id = $1 ORDER BY sequence", [runId]),
        db.query<{ id: string; event_type: string; step_id: string | null; metadata: Record<string, unknown>; created_at: Date | string }>("SELECT id, event_type, step_id, metadata, created_at FROM run_events WHERE run_id = $1 ORDER BY created_at, id LIMIT 2000", [runId]),
        db.query<{ id: string; step_id: string | null; retention_class: string; file_name: string; content_type: string; byte_size: number | string; checksum_sha256: string; created_at: Date | string }>("SELECT id, step_id, retention_class, file_name, content_type, byte_size, checksum_sha256, created_at FROM workflow_artifacts WHERE run_id = $1 ORDER BY created_at, id LIMIT 500", [runId]),
      ]);
      const mappedEvents: RunTimelineEvent[] = events.rows.map((event) => ({ id: event.id, eventType: event.event_type, ...(event.step_id ? { stepId: event.step_id } : {}), metadata: event.metadata, createdAt: iso(event.created_at) }));
      const mappedArtifacts: RunTimelineArtifact[] = artifacts.rows.map((artifact) => ({ id: artifact.id, ...(artifact.step_id ? { stepId: artifact.step_id } : {}), retentionClass: artifact.retention_class, fileName: artifact.file_name, contentType: artifact.content_type, byteSize: Number(artifact.byte_size), checksumSha256: artifact.checksum_sha256, createdAt: iso(artifact.created_at) }));
      return { run: mapRun(row), steps: steps.rows.map((step) => step.result), events: mappedEvents, artifacts: mappedArtifacts };
    });
  }

  public claim(user: AuthenticatedUser, input: { extensionVersion: string; capabilities: string[]; leaseTokenHash: string; leaseExpiresAt: string }): Promise<{ run: ExecutionRun; request: RunRequest; workflow: WorkflowSpec; checkpoint?: RunCheckpoint } | undefined> {
    return this.withUser(user, async (db) => {
      const selected = await db.query<RunRow & { inputs: Record<string, string>; workflow_definition: WorkflowSpec }>(
        `WITH candidate AS (
           SELECT id FROM workflow_runs
           WHERE executor = 'extension' AND status IN ('queued', 'running') AND cancel_requested = false
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
      await db.query("INSERT INTO executor_leases (run_id, tenant_id, executor, executor_version, token_hash, expires_at) VALUES ($1, $2, 'extension', $3, $4, $5) ON CONFLICT (run_id) DO UPDATE SET executor_version = EXCLUDED.executor_version, token_hash = EXCLUDED.token_hash, claimed_at = now(), heartbeat_at = now(), expires_at = EXCLUDED.expires_at, released_at = NULL", [row.id, user.tenantId, input.extensionVersion, input.leaseTokenHash, input.leaseExpiresAt]);
      await db.query("INSERT INTO run_events (run_id, tenant_id, event_type, metadata) VALUES ($1, $2, 'run.claimed', $3::jsonb)", [row.id, user.tenantId, JSON.stringify({ executorVersion: input.extensionVersion, capabilities: input.capabilities })]);
      const request: RunRequest = { schemaVersion: 1, runId: row.id, workflowId: row.workflow_id, workflowVersion: row.workflow_version, executor: row.executor, inputs: row.inputs, requestedAt: iso(row.requested_at) };
      return { run: mapRun(row), request, workflow: row.workflow_definition, ...(row.checkpoint ? { checkpoint: row.checkpoint } : {}) };
    });
  }

  public claimHosted(user: AuthenticatedUser, input: { runId: string; executorVersion: string; leaseTokenHash: string; leaseExpiresAt: string }): Promise<{ run: ExecutionRun; request: RunRequest; workflow: WorkflowSpec; checkpoint?: RunCheckpoint } | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<RunRow & { inputs: Record<string, string>; workflow_definition: WorkflowSpec }>(
        `UPDATE workflow_runs SET status = 'running', started_at = COALESCE(started_at, now()),
           extension_version = $2, extension_capabilities = $3::jsonb, lease_token_hash = $4,
           lease_expires_at = $5, heartbeat_at = now()
         WHERE id = $1 AND executor = 'hosted-browser' AND cancel_requested = false
           AND status IN ('queued', 'running') AND (status = 'queued' OR lease_expires_at IS NULL OR lease_expires_at < now())
         RETURNING *`,
        [input.runId, input.executorVersion, JSON.stringify(["workflow-spec-v1", "isolated-context", "network-allowlist"]), input.leaseTokenHash, input.leaseExpiresAt],
      )).rows[0];
      if (!row) return undefined;
      await db.query(
        `INSERT INTO executor_leases (run_id, tenant_id, executor, executor_version, token_hash, expires_at)
         VALUES ($1, $2, 'hosted-browser', $3, $4, $5)
         ON CONFLICT (run_id) DO UPDATE SET executor = 'hosted-browser', executor_version = EXCLUDED.executor_version,
           token_hash = EXCLUDED.token_hash, claimed_at = now(), heartbeat_at = now(), expires_at = EXCLUDED.expires_at, released_at = NULL`,
        [row.id, user.tenantId, input.executorVersion, input.leaseTokenHash, input.leaseExpiresAt],
      );
      await db.query(
        "INSERT INTO run_events (run_id, tenant_id, event_type, metadata) VALUES ($1, $2, 'run.claimed', $3::jsonb)",
        [row.id, user.tenantId, JSON.stringify({ executorVersion: input.executorVersion, isolation: "browser-context" })],
      );
      const request: RunRequest = {
        schemaVersion: 1,
        runId: row.id,
        workflowId: row.workflow_id,
        workflowVersion: row.workflow_version,
        executor: row.executor,
        inputs: row.inputs,
        requestedAt: iso(row.requested_at),
      };
      return { run: mapRun(row), request, workflow: row.workflow_definition, ...(row.checkpoint ? { checkpoint: row.checkpoint } : {}) };
    });
  }

  public attachQueueJob(user: AuthenticatedUser, runId: string, queueJobId: string): Promise<void> {
    return this.withUser(user, async (db) => {
      await db.query("UPDATE workflow_runs SET queue_job_id = $2 WHERE id = $1", [runId, queueJobId]);
    });
  }

  public heartbeat(user: AuthenticatedUser, runId: string, leaseTokenHash: string, leaseExpiresAt: string): Promise<ExecutionRun | undefined> {
    return this.withUser(user, async (db) => { const row = (await db.query<RunRow>("UPDATE workflow_runs SET heartbeat_at = now(), lease_expires_at = $3 WHERE id = $1 AND status = 'running' AND lease_token_hash = $2 AND lease_expires_at >= now() RETURNING *", [runId, leaseTokenHash, leaseExpiresAt])).rows[0]; if (!row) return undefined; await db.query("UPDATE executor_leases SET heartbeat_at = now(), expires_at = $3 WHERE run_id = $1 AND token_hash = $2 AND released_at IS NULL", [runId, leaseTokenHash, leaseExpiresAt]); return mapRun(row); });
  }

  public checkpoint(user: AuthenticatedUser, runId: string, leaseTokenHash: string, checkpoint: RunCheckpoint, leaseExpiresAt: string): Promise<ExecutionRun | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<RunRow>("UPDATE workflow_runs SET current_step_index = $3, step_results = $4::jsonb, checkpoint = $5::jsonb, heartbeat_at = now(), lease_expires_at = $6 WHERE id = $1 AND status = 'running' AND lease_token_hash = $2 AND lease_expires_at >= now() RETURNING *", [runId, leaseTokenHash, checkpoint.currentStepIndex, JSON.stringify(checkpoint.stepResults), JSON.stringify(checkpoint), leaseExpiresAt])).rows[0];
      if (!row) return undefined;
      await upsertStepResults(db, user.tenantId, runId, checkpoint.stepResults);
      await db.query("UPDATE executor_leases SET heartbeat_at = now(), expires_at = $3 WHERE run_id = $1 AND token_hash = $2 AND released_at IS NULL", [runId, leaseTokenHash, leaseExpiresAt]);
      await db.query("INSERT INTO run_events (run_id, tenant_id, event_type, step_id, metadata) VALUES ($1, $2, 'run.checkpointed', $3, $4::jsonb)", [runId, user.tenantId, checkpoint.inFlightStepId ?? checkpoint.stepResults.at(-1)?.stepId ?? null, JSON.stringify({ currentStepIndex: checkpoint.currentStepIndex, inFlight: Boolean(checkpoint.inFlightStepId) })]);
      return mapRun(row);
    });
  }

  public finish(user: AuthenticatedUser, runId: string, leaseTokenHash: string, result: RunResult): Promise<ExecutionRun | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<RunRow>("UPDATE workflow_runs SET status = CASE WHEN cancel_requested THEN 'cancelled' ELSE $3 END, step_results = $4::jsonb, result = $5::jsonb, finished_at = now(), lease_token_hash = NULL, lease_expires_at = NULL WHERE id = $1 AND status = 'running' AND lease_token_hash = $2 RETURNING *", [runId, leaseTokenHash, result.status, JSON.stringify(result.stepResults), JSON.stringify(result)])).rows[0];
      if (!row) return undefined;
      await upsertStepResults(db, user.tenantId, runId, result.stepResults);
      await db.query("UPDATE executor_leases SET released_at = now() WHERE run_id = $1 AND token_hash = $2", [runId, leaseTokenHash]);
      await db.query("INSERT INTO run_events (run_id, tenant_id, event_type, metadata) VALUES ($1, $2, $3, $4::jsonb)", [runId, user.tenantId, `run.${row.status}`, JSON.stringify({ reasonCode: result.reasonCode ?? null, stepCount: result.stepResults.length })]);
      if (row.mode === "test" && row.status === "completed") await db.query("INSERT INTO workflow_test_evidence (run_id, tenant_id, workflow_id, workflow_version, workflow_checksum) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id) DO NOTHING", [runId, user.tenantId, row.workflow_id, row.workflow_version, row.workflow_checksum]);
      return mapRun(row);
    });
  }

  public cancel(user: AuthenticatedUser, runId: string): Promise<ExecutionRun | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<RunRow>(
        "UPDATE workflow_runs SET cancel_requested = true, status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END, finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled') RETURNING *",
        [runId],
      )).rows[0];
      if (row) { await db.query("INSERT INTO run_events (run_id, tenant_id, event_type, metadata) VALUES ($1, $2, 'run.cancel_requested', $3::jsonb)", [runId, user.tenantId, JSON.stringify({ status: row.status })]); return mapRun(row); }
      const existing = (await db.query<RunRow>("SELECT * FROM workflow_runs WHERE id = $1", [runId])).rows[0];
      return existing ? mapRun(existing) : undefined;
    });
  }

  private async withUser<T>(user: TenantContext, work: Parameters<typeof withTenantTransaction<T>>[2]): Promise<T> {
    const client = await this.pool.connect();
    try { return await withTenantTransaction(client, user, work); } finally { client.release(); }
  }
}

function mapRun(row: RunRow): ExecutionRun {
  return {
    id: row.id, workflowId: row.workflow_id, workflowVersion: row.workflow_version, workflowChecksum: row.workflow_checksum, mode: row.mode, status: row.status, executor: row.executor,
    triggerKind: row.trigger_kind,
    requestedAt: iso(row.requested_at), cancelRequested: row.cancel_requested, currentStepIndex: row.current_step_index,
    stepResults: row.step_results ?? [],
    ...(row.started_at ? { startedAt: iso(row.started_at) } : {}), ...(row.finished_at ? { finishedAt: iso(row.finished_at) } : {}),
    ...(row.extension_version ? { extensionVersion: row.extension_version } : {}), ...(row.lease_expires_at ? { leaseExpiresAt: iso(row.lease_expires_at) } : {}),
    ...(row.session_profile_id ? { sessionProfileId: row.session_profile_id } : {}),
    ...(row.queue_job_id ? { queueJobId: row.queue_job_id } : {}),
    ...(row.result ? { result: row.result } : {}),
  };
}

function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }

async function upsertStepResults(db: SqlClient, tenantId: string, runId: string, results: readonly StepResult[]): Promise<void> {
  if (results.length === 0) return;
  const rows = results.map((result, sequence) => ({ step_id: result.stepId, sequence, status: result.status, reason_code: result.reasonCode ?? null, result, started_at: result.startedAt, finished_at: result.finishedAt }));
  await db.query(
    `INSERT INTO workflow_step_runs (run_id, tenant_id, step_id, sequence, status, reason_code, result, started_at, finished_at)
     SELECT $1, $2, entries.step_id, entries.sequence, entries.status, entries.reason_code, entries.result, entries.started_at, entries.finished_at
     FROM jsonb_to_recordset($3::jsonb) AS entries(step_id uuid, sequence integer, status text, reason_code text, result jsonb, started_at timestamptz, finished_at timestamptz)
     ON CONFLICT (run_id, step_id) DO UPDATE SET sequence = EXCLUDED.sequence, status = EXCLUDED.status, reason_code = EXCLUDED.reason_code, result = EXCLUDED.result, started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at`,
    [runId, tenantId, JSON.stringify(rows)],
  );
}
