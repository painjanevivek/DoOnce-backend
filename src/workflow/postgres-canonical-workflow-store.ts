import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { WorkflowSpec } from "../contracts/protocol.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import type { CanonicalWorkflowDraft, CanonicalWorkflowStore } from "./canonical-workflow-service.js";

export class PostgresCanonicalWorkflowStore implements CanonicalWorkflowStore {
  public constructor(private readonly pool: Pool) {}

  public async createDraft(user: AuthenticatedUser, workflowId: string, spec: WorkflowSpec): Promise<CanonicalWorkflowDraft> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        await transaction.query("INSERT INTO workflows (id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)", [workflowId, user.tenantId, user.userId, spec.title]);
        const inserted = await transaction.query<{ definition_checksum: string }>(
          "INSERT INTO workflow_versions (workflow_id, version, tenant_id, status, definition, created_by, schema_version, source) VALUES ($1, 1, $2, 'draft', $3::jsonb, $4, 1, 'workflow-spec-v1') RETURNING definition_checksum",
          [workflowId, user.tenantId, JSON.stringify(spec), user.userId],
        );
        await transaction.query(
          "INSERT INTO workflow_audit_events (tenant_id, workflow_id, workflow_version, actor_id, event_type, metadata) VALUES ($1, $2, 1, $3, 'workflow.draft_created', $4::jsonb)",
          [user.tenantId, workflowId, user.userId, JSON.stringify({ schemaVersion: 1, stepCount: spec.steps.length, allowedDomainCount: spec.allowedDomains.length })],
        );
        const checksum = inserted.rows[0]?.definition_checksum;
        if (!checksum) throw new Error("Workflow checksum was not generated.");
        return { id: workflowId, version: 1, status: "draft", spec, checksum };
      });
    } finally {
      client.release();
    }
  }

  public async findDraft(user: AuthenticatedUser, workflowId: string): Promise<CanonicalWorkflowDraft | undefined> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{ version: number; definition: WorkflowSpec; definition_checksum: string }>(
          "SELECT version, definition, definition_checksum FROM workflow_versions WHERE workflow_id = $1 AND schema_version = 1 AND status = 'draft' ORDER BY version DESC LIMIT 1",
          [workflowId],
        );
        const row = result.rows[0];
        return row ? { id: workflowId, version: row.version, status: "draft", spec: row.definition, checksum: row.definition_checksum } : undefined;
      });
    } finally {
      client.release();
    }
  }
}
