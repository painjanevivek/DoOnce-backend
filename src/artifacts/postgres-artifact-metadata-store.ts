import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import type { ArtifactMetadata, ArtifactMetadataStore } from "./artifact-service.js";

interface ArtifactRow extends Record<string, unknown> { id: string; run_id: string; step_id: string | null; retention_class: ArtifactMetadata["retentionClass"]; file_name: string; content_type: string; byte_size: number | string; checksum_sha256: string; storage_key: string; created_at: Date | string; expires_at: Date | string | null; pinned_at: Date | string | null }

export class PostgresArtifactMetadataStore implements ArtifactMetadataStore {
  public constructor(private readonly pool: Pool) {}
  public create(user: AuthenticatedUser, metadata: ArtifactMetadata, leaseTokenHash: string): Promise<ArtifactMetadata> { return this.withUser(user, async (db) => {
    const row = (await db.query<ArtifactRow>(`INSERT INTO workflow_artifacts (id, tenant_id, run_id, step_id, retention_class, file_name, content_type, byte_size, checksum_sha256, storage_key, expires_at, pinned_at, created_at)
      SELECT $1, $2, runs.id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13 FROM workflow_runs runs
      WHERE runs.id = $3 AND runs.requested_by = app.current_user_id()
        AND EXISTS (SELECT 1 FROM executor_leases leases WHERE leases.run_id = runs.id AND leases.token_hash = $14)
        AND ($4 IS NULL OR EXISTS (
          SELECT 1
          FROM workflow_step_runs executed_step
          JOIN workflow_versions versions ON versions.workflow_id = runs.workflow_id AND versions.version = runs.workflow_version
          CROSS JOIN LATERAL jsonb_array_elements(versions.definition->'steps') declared_step
          WHERE executed_step.run_id = runs.id AND executed_step.step_id = $4 AND executed_step.status = 'verified'
            AND declared_step->>'id' = $4::text AND declared_step->>'action' = 'download'
        ))
        AND ($5 = 'debug' OR ($5 = 'workflow-output' AND runs.status = 'completed') OR ($5 = 'publication-evidence' AND runs.mode = 'test' AND runs.status = 'completed') OR ($5 = 'pinned' AND $15 = 'owner'))
      RETURNING *`, [metadata.id, user.tenantId, metadata.runId, metadata.stepId ?? null, metadata.retentionClass, metadata.fileName, metadata.contentType, metadata.byteSize, metadata.checksumSha256, metadata.storageKey, metadata.expiresAt, metadata.pinnedAt, metadata.createdAt, leaseTokenHash, user.role])).rows[0];
    if (!row) throw new Error("Artifact run was not found.");
    await db.query("INSERT INTO run_events (run_id, tenant_id, event_type, step_id, metadata) VALUES ($1, $2, 'artifact.created', $3, $4::jsonb)", [metadata.runId, user.tenantId, metadata.stepId ?? null, JSON.stringify({ artifactId: metadata.id, retentionClass: metadata.retentionClass, byteSize: metadata.byteSize, contentType: metadata.contentType })]);
    return map(row);
  }); }
  public listForRun(user: AuthenticatedUser, runId: string): Promise<ArtifactMetadata[]> { return this.withUser(user, async (db) => (await db.query<ArtifactRow>("SELECT artifacts.* FROM workflow_artifacts artifacts JOIN workflow_runs runs ON runs.id = artifacts.run_id WHERE artifacts.run_id = $1 AND runs.requested_by = app.current_user_id() ORDER BY artifacts.created_at, artifacts.id LIMIT 500", [runId])).rows.map(map)); }
  public find(user: AuthenticatedUser, artifactId: string): Promise<ArtifactMetadata | undefined> { return this.withUser(user, async (db) => { const row = (await db.query<ArtifactRow>("SELECT artifacts.* FROM workflow_artifacts artifacts JOIN workflow_runs runs ON runs.id = artifacts.run_id WHERE artifacts.id = $1 AND runs.requested_by = app.current_user_id()", [artifactId])).rows[0]; return row ? map(row) : undefined; }); }
  public listExpired(user: AuthenticatedUser, now: string, limit: number): Promise<ArtifactMetadata[]> { return this.withUser(user, async (db) => (await db.query<ArtifactRow>("SELECT * FROM workflow_artifacts WHERE expires_at <= $1 AND pinned_at IS NULL ORDER BY expires_at LIMIT $2", [now, limit])).rows.map(map)); }
  public delete(user: AuthenticatedUser, artifactId: string): Promise<boolean> { return this.withUser(user, async (db) => (await db.query<{ id: string }>("DELETE FROM workflow_artifacts WHERE id = $1 RETURNING id", [artifactId])).rows.length === 1); }
  private async withUser<T>(user: AuthenticatedUser, work: (db: import("../database/migrator.js").SqlClient) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { return await withTenantTransaction(client, user, work); } finally { client.release(); } }
}
function map(row: ArtifactRow): ArtifactMetadata { return { id: row.id, runId: row.run_id, ...(row.step_id ? { stepId: row.step_id } : {}), retentionClass: row.retention_class, fileName: row.file_name, contentType: row.content_type, byteSize: Number(row.byte_size), checksumSha256: row.checksum_sha256, storageKey: row.storage_key, createdAt: iso(row.created_at)!, expiresAt: iso(row.expires_at), pinnedAt: iso(row.pinned_at) }; }
function iso(value: Date | string | null): string | null { return value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
