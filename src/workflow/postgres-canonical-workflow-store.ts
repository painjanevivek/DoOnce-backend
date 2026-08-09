import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { WorkflowSpec } from "../contracts/protocol.js";
import type { SqlClient } from "../database/migrator.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import type { CanonicalDraftMutationResult, CanonicalNextDraftResult, CanonicalPublishResult, CanonicalWorkflowDraft, CanonicalWorkflowDraftMetadata, CanonicalWorkflowStore, CanonicalWorkflowSummary, CanonicalWorkflowVersion } from "./canonical-workflow-service.js";

export class PostgresCanonicalWorkflowStore implements CanonicalWorkflowStore {
  public constructor(private readonly pool: Pool) {}

  public async createDraft(user: AuthenticatedUser, workflowId: string, spec: WorkflowSpec, metadata?: CanonicalWorkflowDraftMetadata): Promise<CanonicalWorkflowDraft> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        await transaction.query("INSERT INTO workflows (id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)", [workflowId, user.tenantId, user.userId, spec.title]);
        const inserted = await transaction.query<{ definition_checksum: string }>(
          "INSERT INTO workflow_versions (workflow_id, version, tenant_id, status, definition, created_by, schema_version, source, compiler_version, source_capture_session_id, compilation_metadata) VALUES ($1, 1, $2, 'draft', $3::jsonb, $4, 1, 'workflow-spec-v1', $5, $6, $7::jsonb) RETURNING definition_checksum",
          [workflowId, user.tenantId, JSON.stringify(spec), user.userId, metadata?.compilerVersion ?? null, metadata?.captureSessionId ?? null, metadata ? JSON.stringify(metadata) : null],
        );
        await transaction.query(
          "INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, 1, $3, 'workflow.draft_created', $4::jsonb)",
          [user.tenantId, workflowId, user.userId, JSON.stringify({ schemaVersion: 1, stepCount: spec.steps.length, allowedDomainCount: spec.allowedDomains.length, ...(metadata ? { source: metadata.source, captureSessionId: metadata.captureSessionId, compilerVersion: metadata.compilerVersion, sourceDigest: metadata.sourceDigest } : {}) })],
        );
        const checksum = inserted.rows[0]?.definition_checksum;
        if (!checksum) throw new Error("Workflow checksum was not generated.");
        return { id: workflowId, version: 1, status: "draft", spec, checksum, ...(metadata ? { metadata } : {}) };
      });
    } finally {
      client.release();
    }
  }

  public async findDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowDraft | undefined> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ version: number; definition: WorkflowSpec; definition_checksum: string; compilation_metadata: CanonicalWorkflowDraftMetadata | null }>(
          "SELECT version, definition, definition_checksum, compilation_metadata FROM workflow_versions WHERE workflow_id = $1 AND schema_version = 1 AND status = 'draft' ORDER BY version DESC LIMIT 1",
          [workflowId],
        );
        const row = result.rows[0];
        return row ? { id: workflowId, version: row.version, status: "draft", spec: row.definition, checksum: row.definition_checksum, ...(row.compilation_metadata ? { metadata: row.compilation_metadata } : {}) } : undefined;
      });
    } finally {
      client.release();
    }
  }

  public async listWorkflows(user: AuthenticatedUser): Promise<CanonicalWorkflowSummary[]> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{
          id: string; title: string; active_version: number | null; draft_version: number | null; updated_at: Date | string;
          last_run_at: Date | string | null; success_rate: number | string | null;
        }>(
          "SELECT workflows.id, workflows.title, workflows.active_version, workflows.updated_at, draft.version AS draft_version, health.last_run_at, health.success_rate FROM workflows LEFT JOIN LATERAL (SELECT version FROM workflow_versions WHERE workflow_id = workflows.id AND schema_version = 1 AND status = 'draft' ORDER BY version DESC LIMIT 1) draft ON true LEFT JOIN LATERAL (SELECT max(finished_at) AS last_run_at, round(100.0 * count(*) FILTER (WHERE outcome = 'completed') / NULLIF(count(*), 0)) AS success_rate FROM workflow_run_receipts WHERE workflow_id = workflows.id) health ON true WHERE EXISTS (SELECT 1 FROM workflow_versions WHERE workflow_id = workflows.id AND schema_version = 1) ORDER BY workflows.updated_at DESC LIMIT 200",
        );
        return result.rows.map((row) => ({
          id: row.id,
          title: row.title,
          activeVersion: row.active_version,
          draftVersion: row.draft_version,
          status: row.draft_version ? "draft" : row.active_version ? "active" : "archived",
          updatedAt: toIso(row.updated_at),
          lastRunAt: row.last_run_at ? toIso(row.last_run_at) : null,
          successRate: row.success_rate === null ? null : Number(row.success_rate),
        }));
      });
    } finally { client.release(); }
  }

  public async listVersions(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowVersion[]> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<VersionRow>(
          "SELECT versions.workflow_id, versions.version, versions.status, versions.definition, versions.definition_checksum, versions.created_at, versions.published_at, evidence.run_id AS test_evidence_run_id FROM workflow_versions versions LEFT JOIN LATERAL (SELECT run_id FROM workflow_test_evidence WHERE workflow_id = versions.workflow_id AND workflow_version = versions.version AND workflow_checksum = versions.definition_checksum ORDER BY verified_at DESC LIMIT 1) evidence ON true WHERE versions.workflow_id = $1 AND versions.schema_version = 1 ORDER BY versions.version DESC LIMIT 100",
          [workflowId],
        );
        return result.rows.map(mapVersion);
      });
    } finally { client.release(); }
  }

  public async updateDraft(user: AuthenticatedUser, workflowId: string, expectedChecksum: string, spec: WorkflowSpec): Promise<CanonicalDraftMutationResult> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const updated = await transaction.query<{ version: number; definition_checksum: string }>(
          "UPDATE workflow_versions SET definition = $1::jsonb, source = 'editor-v1', compilation_metadata = CASE WHEN compilation_metadata IS NULL THEN NULL ELSE jsonb_set(compilation_metadata, '{source}', to_jsonb('editor'::text), true) END WHERE workflow_id = $2 AND schema_version = 1 AND status = 'draft' AND definition_checksum = $3 RETURNING version, definition_checksum",
          [JSON.stringify(spec), workflowId, expectedChecksum],
        );
        const row = updated.rows[0];
        if (row) {
          await transaction.query("UPDATE workflows SET title = $1, updated_at = now() WHERE id = $2", [spec.title, workflowId]);
          await transaction.query("INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, $3, $4, 'workflow.draft_edited', $5::jsonb)", [user.tenantId, workflowId, row.version, user.userId, JSON.stringify({ previousChecksum: expectedChecksum, checksum: row.definition_checksum })]);
          return { status: "updated", draft: { id: workflowId, version: row.version, status: "draft", spec, checksum: row.definition_checksum } };
        }
        const current = await selectDraft(transaction, workflowId);
        return current ? { status: "conflict", draft: current } : { status: "missing" };
      });
    } finally { client.release(); }
  }

  public async createNextDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalNextDraftResult> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        await transaction.query("SELECT id FROM workflows WHERE id = $1 FOR UPDATE", [workflowId]);
        const existing = await selectDraft(transaction, workflowId);
        if (existing) return { status: "exists", draft: existing };
        const source = await transaction.query<{ version: number; definition: WorkflowSpec }>("SELECT version, definition FROM workflow_versions WHERE workflow_id = $1 AND schema_version = 1 AND status = 'active' ORDER BY version DESC LIMIT 1", [workflowId]);
        const active = source.rows[0];
        if (!active) return { status: "missing" };
        const version = active.version + 1;
        const inserted = await transaction.query<{ definition_checksum: string }>("INSERT INTO workflow_versions (workflow_id, version, tenant_id, status, definition, created_by, schema_version, source) VALUES ($1, $2, $3, 'draft', $4::jsonb, $5, 1, 'editor-v1') RETURNING definition_checksum", [workflowId, version, user.tenantId, JSON.stringify(active.definition), user.userId]);
        const checksum = inserted.rows[0]?.definition_checksum;
        if (!checksum) throw new Error("Workflow checksum was not generated.");
        await transaction.query("UPDATE workflows SET updated_at = now() WHERE id = $1", [workflowId]);
        await transaction.query("INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, $3, $4, 'workflow.version_draft_created', $5::jsonb)", [user.tenantId, workflowId, version, user.userId, JSON.stringify({ sourceVersion: active.version })]);
        return { status: "created", draft: { id: workflowId, version, status: "draft", spec: active.definition, checksum } };
      });
    } finally { client.release(); }
  }

  public async hasPassingTestEvidence(user: AuthenticatedUser, workflowId: string, version: number, checksum: string): Promise<boolean> {
    const client = await this.pool.connect();
    try { return await withTenantTransaction(client, user, async (transaction) => Boolean((await transaction.query("SELECT 1 FROM workflow_test_evidence WHERE workflow_id = $1 AND workflow_version = $2 AND workflow_checksum = $3 LIMIT 1", [workflowId, version, checksum])).rows[0])); }
    finally { client.release(); }
  }

  public async publishDraft(user: AuthenticatedUser, workflowId: string, expectedChecksum: string): Promise<CanonicalPublishResult> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        await transaction.query("SELECT id FROM workflows WHERE id = $1 FOR UPDATE", [workflowId]);
        const current = await selectDraft(transaction, workflowId);
        if (!current) return { status: "missing" };
        if (current.checksum !== expectedChecksum) return { status: "conflict", draft: current };
        await transaction.query("UPDATE workflow_versions SET status = 'archived' WHERE workflow_id = $1 AND status = 'active'", [workflowId]);
        const published = await transaction.query<VersionRow>("UPDATE workflow_versions SET status = 'active', published_at = now() WHERE workflow_id = $1 AND version = $2 AND status = 'draft' AND definition_checksum = $3 RETURNING workflow_id, version, status, definition, definition_checksum, created_at, published_at", [workflowId, current.version, expectedChecksum]);
        const version = published.rows[0];
        if (!version) return { status: "conflict", draft: current };
        await transaction.query("UPDATE workflows SET active_version = $1, title = $2, updated_at = now() WHERE id = $3", [current.version, current.spec.title, workflowId]);
        await transaction.query("INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, $3, $4, 'workflow.published', $5::jsonb)", [user.tenantId, workflowId, current.version, user.userId, JSON.stringify({ checksum: expectedChecksum, schemaVersion: 1 })]);
        const evidence = await transaction.query<{ run_id: string }>("SELECT run_id FROM workflow_test_evidence WHERE workflow_id = $1 AND workflow_version = $2 AND workflow_checksum = $3 ORDER BY verified_at DESC LIMIT 1", [workflowId, current.version, expectedChecksum]);
        return { status: "published", version: mapVersion({ ...version, test_evidence_run_id: evidence.rows[0]?.run_id ?? null }) };
      });
    } finally { client.release(); }
  }
}

interface VersionRow extends Record<string, unknown> { workflow_id: string; version: number; status: "draft" | "active" | "archived"; definition: WorkflowSpec; definition_checksum: string; test_evidence_run_id?: string | null; created_at: Date | string; published_at: Date | string | null }

async function selectDraft(transaction: SqlClient, workflowId: string): Promise<CanonicalWorkflowDraft | undefined> {
  const result = await transaction.query<{ version: number; definition: WorkflowSpec; definition_checksum: string }>("SELECT version, definition, definition_checksum FROM workflow_versions WHERE workflow_id = $1 AND schema_version = 1 AND status = 'draft' ORDER BY version DESC LIMIT 1", [workflowId]);
  const row = result.rows[0];
  return row ? { id: workflowId, version: row.version, status: "draft", spec: row.definition, checksum: row.definition_checksum } : undefined;
}

function mapVersion(row: VersionRow): CanonicalWorkflowVersion {
  return { id: row.workflow_id, version: row.version, status: row.status, spec: row.definition, checksum: row.definition_checksum, testEvidenceRunId: row.test_evidence_run_id ?? null, createdAt: toIso(row.created_at), publishedAt: row.published_at ? toIso(row.published_at) : null };
}

function toIso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
