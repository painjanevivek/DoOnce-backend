import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import type { WebhookEndpoint, WebhookEndpointRecord, WebhookStore } from "./webhook-service.js";

interface Row extends Record<string, unknown> {
  id: string; tenant_id: string; workflow_id: string; session_profile_id: string; signing_secret_reference: string;
  enabled: boolean; created_by: string; created_by_email: string; created_at: Date | string;
}

export class PostgresWebhookStore implements WebhookStore {
  public constructor(private readonly pool: Pool) {}

  public create(user: AuthenticatedUser, endpoint: WebhookEndpointRecord): Promise<WebhookEndpoint> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<Row>(
        `INSERT INTO workflow_webhook_endpoints (id, tenant_id, workflow_id, signing_secret_reference, session_profile_id, created_by)
         SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (
           SELECT 1 FROM workflow_versions WHERE workflow_id = $3 AND status = 'active'
         ) AND EXISTS (
           SELECT 1 FROM browser_session_profiles WHERE id = $5 AND location = 'managed' AND enabled = true
         ) RETURNING *, $7::text AS created_by_email`,
        [endpoint.id, user.tenantId, endpoint.workflowId, endpoint.signingSecretReference, endpoint.sessionProfileId, user.userId, user.email],
      )).rows[0];
      if (!row) throw new Error("Webhook requires a published workflow and enabled managed browser session.");
      return publicEndpoint(row);
    });
  }

  public list(user: AuthenticatedUser, workflowId?: string): Promise<WebhookEndpoint[]> {
    return this.withUser(user, async (db) => (await db.query<Row>(
      `SELECT endpoints.*, ''::text AS created_by_email FROM workflow_webhook_endpoints endpoints ${workflowId ? "WHERE workflow_id = $1" : ""} ORDER BY created_at DESC LIMIT 100`,
      workflowId ? [workflowId] : [],
    )).rows.map(publicEndpoint));
  }

  public async findInternal(id: string): Promise<WebhookEndpointRecord | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM app.resolve_webhook_endpoint($1)",
      [id],
    );
    const row = result.rows[0];
    return row ? { ...publicEndpoint(row), tenantId: row.tenant_id, createdBy: row.created_by, createdByEmail: row.created_by_email, signingSecretReference: row.signing_secret_reference } : undefined;
  }

  public async recordReceipt(endpoint: WebhookEndpointRecord, idempotencyKey: string): Promise<void> {
    const user: AuthenticatedUser = { tenantId: endpoint.tenantId, userId: endpoint.createdBy, email: endpoint.createdByEmail, role: "builder" };
    await this.withUser(user, async (db) => {
      await db.query(
        `INSERT INTO workflow_trigger_receipts (tenant_id, workflow_id, trigger_kind, source_id, idempotency_key)
         VALUES ($1, $2, 'webhook', $3, $4) ON CONFLICT (tenant_id, trigger_kind, idempotency_key) DO NOTHING`,
        [endpoint.tenantId, endpoint.workflowId, endpoint.id, idempotencyKey],
      );
    });
  }

  private async withUser<T>(user: AuthenticatedUser, work: Parameters<typeof withTenantTransaction<T>>[2]): Promise<T> {
    const client = await this.pool.connect();
    try { return await withTenantTransaction(client, user, work); } finally { client.release(); }
  }
}

function publicEndpoint(row: Row): WebhookEndpoint {
  return { id: row.id, workflowId: row.workflow_id, sessionProfileId: row.session_profile_id, enabled: row.enabled, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString() };
}
