import type { Pool } from "pg";
import { withTenantTransaction } from "../database/tenant-context.js";
import type { AccountRecord, AuthStore, MembershipRole } from "./auth-service.js";
import type { SessionIdentity } from "./session-token.js";

const roleValues = new Set<MembershipRole>(["owner", "builder", "runner", "reviewer"]);

export class PostgresAuthStore implements AuthStore {
  public constructor(private readonly pool: Pool) {}

  public async register(input: Parameters<AuthStore["register"]>[0]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await withTenantTransaction(client, input, async (transaction) => {
        await transaction.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", [input.tenantId, input.tenantName]);
        await transaction.query(
          "INSERT INTO users (id, email, password_hash, default_tenant_id) VALUES ($1, $2, $3, $4)",
          [input.userId, input.email, input.passwordHash, input.tenantId],
        );
        await transaction.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [input.tenantId, input.userId]);
        await transaction.query(
          "INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
          [input.tenantId, input.userId, input.sessionTokenHash, input.sessionExpiresAt],
        );
      });
    } finally {
      client.release();
    }
  }

  public async findAccountByEmail(email: string): Promise<AccountRecord | undefined> {
    const result = await this.pool.query<{ id: string; email: string; password_hash: string; default_tenant_id: string | null }>(
      "SELECT id, email, password_hash, default_tenant_id FROM users WHERE email = $1",
      [email],
    );
    const account = result.rows[0];
    return account ? { userId: account.id, email: account.email, passwordHash: account.password_hash, defaultTenantId: account.default_tenant_id } : undefined;
  }

  public async findAccountByIdentity(identity: SessionIdentity): Promise<AccountRecord | undefined> {
    const result = await this.pool.query<{ id: string; email: string; password_hash: string; default_tenant_id: string | null }>(
      "SELECT id, email, password_hash, default_tenant_id FROM users WHERE id = $1 AND default_tenant_id = $2",
      [identity.userId, identity.tenantId],
    );
    const account = result.rows[0];
    return account ? { userId: account.id, email: account.email, passwordHash: account.password_hash, defaultTenantId: account.default_tenant_id } : undefined;
  }

  public async findRole(identity: SessionIdentity): Promise<MembershipRole | undefined> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, identity, async (transaction) => {
        const result = await transaction.query<{ role: string }>(
          "SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2",
          [identity.tenantId, identity.userId],
        );
        const role = result.rows[0]?.role;
        return role && roleValues.has(role as MembershipRole) ? role as MembershipRole : undefined;
      });
    } finally {
      client.release();
    }
  }

  public async createSession(input: SessionIdentity & { tokenHash: string; expiresAt: Date }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await withTenantTransaction(client, input, (transaction) => transaction.query(
        "INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
        [input.tenantId, input.userId, input.tokenHash, input.expiresAt],
      ));
    } finally {
      client.release();
    }
  }

  public async findSession(tokenHash: string, identity: SessionIdentity): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, identity, async (transaction) => {
        const result = await transaction.query(
          "SELECT 1 FROM sessions WHERE token_hash = $1 AND tenant_id = $2 AND user_id = $3 AND revoked_at IS NULL AND expires_at > now()",
          [tokenHash, identity.tenantId, identity.userId],
        );
        return result.rows.length === 1;
      });
    } finally {
      client.release();
    }
  }

  public async revokeSession(tokenHash: string, identity: SessionIdentity): Promise<void> {
    const client = await this.pool.connect();
    try {
      await withTenantTransaction(client, identity, (transaction) => transaction.query(
        "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND tenant_id = $2 AND user_id = $3",
        [tokenHash, identity.tenantId, identity.userId],
      ));
    } finally {
      client.release();
    }
  }
}
