import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import { validateWorkflowDraft, type WorkflowDraft } from "./schema.js";
import type { PublishedWorkflowVersion } from "./versioning.js";
import type { WorkflowAuditEvent, WorkflowStore, WorkflowSummary } from "./workflow-service.js";

export class PostgresWorkflowStore implements WorkflowStore {
  public constructor(private readonly pool: Pool) {}

  public async createDraft(draft: WorkflowDraft): Promise<void> {
    const client = await this.pool.connect();
    try {
      await withTenantTransaction(client, { tenantId: draft.tenantId, userId: draft.ownerId }, async (transaction) => {
        await transaction.query("INSERT INTO workflows (id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)", [draft.id, draft.tenantId, draft.ownerId, draft.title]);
        await transaction.query(
          "INSERT INTO workflow_versions (workflow_id, version, tenant_id, status, definition, created_by) VALUES ($1, $2, $3, 'draft', $4::jsonb, $5)",
          [draft.id, draft.version, draft.tenantId, JSON.stringify(draft), draft.ownerId],
        );
        await transaction.query(
          "INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, $3, $4, 'workflow.draft_created', $5::jsonb)",
          [draft.tenantId, draft.id, draft.version, draft.ownerId, JSON.stringify({ allowedDomainCount: draft.allowedDomains.length, stepCount: draft.steps.length })],
        );
      });
    } finally {
      client.release();
    }
  }

  public async listWorkflows(user: AuthenticatedUser): Promise<WorkflowSummary[]> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ id: string; title: string; active_version: number | null; draft_version: number | null; updated_at: Date }>(
          "SELECT workflows.id, workflows.title, workflows.active_version, workflows.updated_at, draft.version AS draft_version FROM workflows LEFT JOIN LATERAL (SELECT version FROM workflow_versions WHERE workflow_id = workflows.id AND status = 'draft' ORDER BY version DESC LIMIT 1) AS draft ON true ORDER BY workflows.updated_at DESC",
        );
        return result.rows.map((row) => ({ id: row.id, title: row.title, activeVersion: row.active_version, draftVersion: row.draft_version, updatedAt: row.updated_at.toISOString() }));
      });
    } finally {
      client.release();
    }
  }

  public async findDraft(id: string, user: AuthenticatedUser): Promise<WorkflowDraft | undefined> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ definition: unknown }>(
          "SELECT definition FROM workflow_versions WHERE workflow_id = $1 AND status = 'draft' ORDER BY version DESC LIMIT 1",
          [id],
        );
        const definition = result.rows[0]?.definition;
        const validation = validateWorkflowDraft(definition);
        if (!validation.ok || validation.value.tenantId !== user.tenantId) return undefined;
        return validation.value;
      });
    } finally {
      client.release();
    }
  }

  public async markPolicyPreviewed(id: string, user: AuthenticatedUser, previewedAt: string): Promise<WorkflowDraft | undefined> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ definition: unknown }>(
          "UPDATE workflow_versions SET definition = jsonb_set(definition, '{policyPreviewedAt}', to_jsonb($1::text), true) WHERE workflow_id = $2 AND status = 'draft' RETURNING definition",
          [previewedAt, id],
        );
        const validation = validateWorkflowDraft(result.rows[0]?.definition);
        if (!validation.ok || validation.value.tenantId !== user.tenantId) return undefined;
        await transaction.query(
          "INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, $3, $4, 'workflow.policy_previewed', '{}'::jsonb)",
          [validation.value.tenantId, validation.value.id, validation.value.version, user.userId],
        );
        return validation.value;
      });
    } finally {
      client.release();
    }
  }

  public async activate(draft: PublishedWorkflowVersion, user: AuthenticatedUser): Promise<void> {
    const client = await this.pool.connect();
    try {
      await withTenantTransaction(client, user, async (transaction) => {
        await transaction.query(
          "UPDATE workflow_versions SET status = 'active', published_at = $1, definition = $2::jsonb WHERE workflow_id = $3 AND version = $4 AND status = 'draft'",
          [draft.publishedAt, JSON.stringify(draft), draft.id, draft.version],
        );
        await transaction.query("UPDATE workflows SET active_version = $1, updated_at = now() WHERE id = $2", [draft.version, draft.id]);
        await transaction.query(
          "INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, $3, $4, 'workflow.published', '{}'::jsonb)",
          [draft.tenantId, draft.id, draft.version, user.userId],
        );
      });
    } finally {
      client.release();
    }
  }

  public async createRepairDraft(id: string, user: AuthenticatedUser): Promise<WorkflowDraft | undefined> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const existingDraft = await transaction.query<{ definition: unknown }>(
          "SELECT definition FROM workflow_versions WHERE workflow_id = $1 AND status = 'draft' ORDER BY version DESC LIMIT 1",
          [id],
        );
        const existingValidation = validateWorkflowDraft(existingDraft.rows[0]?.definition);
        if (existingValidation.ok && existingValidation.value.tenantId === user.tenantId) return existingValidation.value;

        const source = await transaction.query<{ definition: unknown }>(
          "SELECT definition FROM workflow_versions WHERE workflow_id = $1 AND status IN ('active', 'archived') ORDER BY version DESC LIMIT 1",
          [id],
        );
        const sourceValidation = validateWorkflowDraft(source.rows[0]?.definition);
        if (!sourceValidation.ok || sourceValidation.value.tenantId !== user.tenantId) return undefined;
        const draft: WorkflowDraft = {
          id: sourceValidation.value.id,
          version: sourceValidation.value.version + 1,
          tenantId: sourceValidation.value.tenantId,
          ownerId: sourceValidation.value.ownerId,
          title: sourceValidation.value.title,
          allowedDomains: [...sourceValidation.value.allowedDomains],
          steps: sourceValidation.value.steps.map((step) => ({ ...step })),
        };
        await transaction.query(
          "INSERT INTO workflow_versions (workflow_id, version, tenant_id, status, definition, created_by) VALUES ($1, $2, $3, 'draft', $4::jsonb, $5)",
          [draft.id, draft.version, draft.tenantId, JSON.stringify(draft), user.userId],
        );
        await transaction.query(
          "INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, $3, $4, 'workflow.repair_draft_created', $5::jsonb)",
          [draft.tenantId, draft.id, draft.version, user.userId, JSON.stringify({ sourceVersion: sourceValidation.value.version })],
        );
        return draft;
      });
    } finally {
      client.release();
    }
  }

  public async disableActive(id: string, user: AuthenticatedUser): Promise<number | undefined> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ version: number }>(
          "UPDATE workflow_versions SET status = 'archived' WHERE workflow_id = $1 AND tenant_id = $2 AND status = 'active' RETURNING version",
          [id, user.tenantId],
        );
        const active = result.rows[0];
        if (!active) return undefined;
        await transaction.query("UPDATE workflows SET active_version = NULL, updated_at = now() WHERE id = $1", [id]);
        await transaction.query(
          "INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, $3, $4, 'workflow.disabled', '{}'::jsonb)",
          [user.tenantId, id, active.version, user.userId],
        );
        return active.version;
      });
    } finally {
      client.release();
    }
  }

  public async listAuditEvents(workflowId: string, user: AuthenticatedUser): Promise<WorkflowAuditEvent[]> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ id: string; workflow_id: string; workflow_version: number; event_type: WorkflowAuditEvent["eventType"]; created_at: Date }>(
          "SELECT id, workflow_id, workflow_version, event_type, created_at FROM workflow_audit_events WHERE workflow_id = $1 ORDER BY created_at ASC",
          [workflowId],
        );
        return result.rows.map((row) => ({ id: row.id, workflowId: row.workflow_id, version: row.workflow_version, eventType: row.event_type, createdAt: row.created_at.toISOString() }));
      });
    } finally {
      client.release();
    }
  }
}
