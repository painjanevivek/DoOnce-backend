import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { CaptureSession, CaptureSessionSummary, CaptureSyncAck, CaptureSyncRequest, RecordedAction } from "../contracts/protocol.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import { CaptureConflictError, type CaptureStore } from "./capture-service.js";

export class PostgresCaptureStore implements CaptureStore {
  public constructor(private readonly pool: Pool) {}

  public async syncBatch(user: AuthenticatedUser, request: CaptureSyncRequest): Promise<CaptureSyncAck> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const duplicate = await transaction.query<{ accepted_through: number; status: CaptureSyncAck["status"] }>(
          "SELECT accepted_through, status FROM capture_batches WHERE session_id = $1 AND batch_id = $2",
          [request.sessionId, request.batchId],
        );
        if (duplicate.rows[0]) return ack(request, duplicate.rows[0].accepted_through, "duplicate");

        await transaction.query(
          "INSERT INTO capture_sessions (id, tenant_id, created_by, status, approved_origins) VALUES ($1, $2, $3, 'recording', $4::text[]) ON CONFLICT (id) DO NOTHING",
          [request.sessionId, user.tenantId, user.userId, [...new Set(request.actions.map((action) => action.origin))]],
        );
        const locked = await transaction.query<{ accepted_through: number; status: string; approved_origins: string[] }>(
          "SELECT accepted_through, status, approved_origins FROM capture_sessions WHERE id = $1 FOR UPDATE",
          [request.sessionId],
        );
        const session = locked.rows[0];
        if (!session) throw new CaptureConflictError("Capture session is not available in this workspace.");
        if (session.status === "finalized") throw new CaptureConflictError("Capture session is already finalized.");
        if (session.accepted_through !== request.cursor) throw new CaptureConflictError(`Capture synchronization must resume after sequence ${session.accepted_through}.`);
        if ((request.actions.at(-1)?.sequence ?? request.cursor) > 999) throw new CaptureConflictError("Capture sessions are limited to 1,000 actions.");
        const approvedOrigins = [...new Set([...session.approved_origins, ...request.actions.map((action) => action.origin)])];
        if (approvedOrigins.length > 20) throw new CaptureConflictError("Capture sessions are limited to 20 browser origins.");

        if (request.actions.length > 0) {
          await transaction.query(
            "INSERT INTO capture_actions (id, tenant_id, session_id, sequence, action) SELECT (item->>'id')::uuid, $2, $1, (item->>'sequence')::integer, item FROM jsonb_array_elements($3::jsonb) AS item",
            [request.sessionId, user.tenantId, JSON.stringify(request.actions)],
          );
        }
        const acceptedThrough = request.actions.at(-1)?.sequence ?? request.cursor;
        const status: CaptureSyncAck["status"] = request.final ? "finalized" : "accepted";
        await transaction.query(
          "UPDATE capture_sessions SET accepted_through = $2, status = $3, approved_origins = (SELECT ARRAY(SELECT DISTINCT value FROM unnest(approved_origins || $4::text[]) value)), updated_at = now(), finalized_at = CASE WHEN $3 = 'finalized' THEN now() ELSE finalized_at END WHERE id = $1",
          [request.sessionId, acceptedThrough, request.final ? "finalized" : "recording", approvedOrigins],
        );
        await transaction.query(
          "INSERT INTO capture_batches (tenant_id, session_id, batch_id, cursor, accepted_through, status) VALUES ($1, $2, $3, $4, $5, $6)",
          [user.tenantId, request.sessionId, request.batchId, request.cursor, acceptedThrough, status],
        );
        return ack(request, acceptedThrough, status);
      });
    } finally {
      client.release();
    }
  }

  public async findSession(user: AuthenticatedUser, sessionId: string): Promise<CaptureSession | undefined> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const sessionResult = await transaction.query<{
          id: string; status: CaptureSession["status"]; approved_origins: string[]; accepted_through: number;
          created_at: Date | string; updated_at: Date | string; finalized_at: Date | string | null;
        }>("SELECT id, status, approved_origins, accepted_through, created_at, updated_at, finalized_at FROM capture_sessions WHERE id = $1", [sessionId]);
        const row = sessionResult.rows[0];
        if (!row) return undefined;
        const actionResult = await transaction.query<{ action: RecordedAction }>("SELECT action FROM capture_actions WHERE session_id = $1 ORDER BY sequence", [sessionId]);
        return {
          schemaVersion: 1,
          format: "doonce.capture-session.v1",
          id: row.id,
          startedAt: asIso(row.created_at),
          ...(row.finalized_at ? { endedAt: asIso(row.finalized_at) } : {}),
          status: row.status,
          approvedOrigins: row.approved_origins,
          actions: actionResult.rows.map(({ action }) => action),
          updatedAt: asIso(row.updated_at),
          syncCursor: row.accepted_through,
        };
      });
    } finally { client.release(); }
  }

  public async listSessions(user: AuthenticatedUser, limit: number): Promise<CaptureSessionSummary[]> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, async (transaction) => {
        const result = await transaction.query<{
          id: string; status: CaptureSessionSummary["status"]; created_at: Date | string; finalized_at: Date | string | null;
          action_count: number | string; workflow_id: string | null; compiler_version: string | null;
        }>(
          "SELECT sessions.id, sessions.status, sessions.created_at, sessions.finalized_at, count(actions.id)::integer AS action_count, compiled.workflow_id, compiled.compiler_version FROM capture_sessions sessions LEFT JOIN capture_actions actions ON actions.session_id = sessions.id LEFT JOIN LATERAL (SELECT versions.workflow_id, versions.compiler_version FROM workflow_versions versions WHERE versions.source_capture_session_id = sessions.id AND versions.status = 'draft' ORDER BY versions.created_at DESC LIMIT 1) compiled ON true GROUP BY sessions.id, compiled.workflow_id, compiled.compiler_version ORDER BY sessions.updated_at DESC LIMIT $1",
          [limit],
        );
        return result.rows.map((row) => ({
          schemaVersion: 1,
          id: row.id,
          status: row.status,
          startedAt: asIso(row.created_at),
          ...(row.finalized_at ? { endedAt: asIso(row.finalized_at) } : {}),
          actionCount: Number(row.action_count),
          ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
          ...(row.compiler_version ? { compilerVersion: row.compiler_version } : {}),
        }));
      });
    } finally { client.release(); }
  }

  public async createPairingCode(user: AuthenticatedUser, codeHash: string, expiresAt: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await withTenantTransaction(client, user, async (transaction) => {
        await transaction.query("DELETE FROM capture_pairing_codes WHERE tenant_id = $1 AND user_id = $2", [user.tenantId, user.userId]);
        await transaction.query("INSERT INTO capture_pairing_codes (tenant_id, user_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)", [user.tenantId, user.userId, codeHash, expiresAt]);
      });
    } finally { client.release(); }
  }

  public async exchangePairingCode(codeHash: string, tokenHash: string): Promise<AuthenticatedUser | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ tenant_id: string; user_id: string; role: AuthenticatedUser["role"]; email: string }>(
        "UPDATE capture_pairing_codes codes SET used_at = now() FROM memberships memberships, users users WHERE codes.code_hash = $1 AND codes.used_at IS NULL AND codes.expires_at > now() AND memberships.tenant_id = codes.tenant_id AND memberships.user_id = codes.user_id AND users.id = codes.user_id RETURNING codes.tenant_id, codes.user_id, memberships.role, users.email",
        [codeHash],
      );
      const identity = result.rows[0];
      if (!identity) { await client.query("ROLLBACK"); return undefined; }
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [identity.tenant_id]);
      await client.query("SELECT set_config('app.user_id', $1, true)", [identity.user_id]);
      await client.query("INSERT INTO capture_extension_tokens (tenant_id, user_id, token_hash) VALUES ($1, $2, $3)", [identity.tenant_id, identity.user_id, tokenHash]);
      await client.query("COMMIT");
      return { tenantId: identity.tenant_id, userId: identity.user_id, role: identity.role, email: identity.email };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  public async findExtensionIdentity(tokenHash: string): Promise<AuthenticatedUser | undefined> {
    const result = await this.pool.query<{ tenant_id: string; user_id: string; role: AuthenticatedUser["role"]; email: string }>(
      "SELECT tokens.tenant_id, tokens.user_id, memberships.role, users.email FROM capture_extension_tokens tokens JOIN memberships ON memberships.tenant_id = tokens.tenant_id AND memberships.user_id = tokens.user_id JOIN users ON users.id = tokens.user_id WHERE tokens.token_hash = $1 AND tokens.revoked_at IS NULL AND tokens.expires_at > now()",
      [tokenHash],
    );
    const identity = result.rows[0];
    return identity ? { tenantId: identity.tenant_id, userId: identity.user_id, role: identity.role, email: identity.email } : undefined;
  }

  public async revokeExtensionToken(tokenHash: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE capture_extension_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [tokenHash]);
    return (result.rowCount ?? 0) > 0;
  }
}

function ack(request: CaptureSyncRequest, acceptedThrough: number, status: CaptureSyncAck["status"]): CaptureSyncAck {
  return { schemaVersion: 1, sessionId: request.sessionId, batchId: request.batchId, acceptedThrough, status };
}

function asIso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
