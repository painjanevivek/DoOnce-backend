import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import { validateWorkflowDraft, type WorkflowDraft } from "./schema.js";
import type { PublishedWorkflowVersion } from "./versioning.js";
import type { WorkflowStore, WorkflowSummary } from "./workflow-service.js";

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
      });
    } finally {
      client.release();
    }
  }

  public async listWorkflows(user: AuthenticatedUser): Promise<WorkflowSummary[]> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ id: string; title: string; active_version: number | null; updated_at: Date }>(
          "SELECT id, title, active_version, updated_at FROM workflows ORDER BY updated_at DESC",
        );
        return result.rows.map((row) => ({ id: row.id, title: row.title, activeVersion: row.active_version, updatedAt: row.updated_at.toISOString() }));
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

  public async activate(draft: PublishedWorkflowVersion, user: AuthenticatedUser): Promise<void> {
    const client = await this.pool.connect();
    try {
      await withTenantTransaction(client, user, async (transaction) => {
        await transaction.query(
          "UPDATE workflow_versions SET status = 'active', published_at = $1, definition = $2::jsonb WHERE workflow_id = $3 AND version = $4 AND status = 'draft'",
          [draft.publishedAt, JSON.stringify(draft), draft.id, draft.version],
        );
        await transaction.query("UPDATE workflows SET active_version = $1, updated_at = now() WHERE id = $2", [draft.version, draft.id]);
      });
    } finally {
      client.release();
    }
  }
}
