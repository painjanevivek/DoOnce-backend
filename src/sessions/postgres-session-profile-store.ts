import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import { withTenantTransaction } from "../database/tenant-context.js";
import type { BrowserSessionProfile, BrowserSessionProfileRecord, SessionProfileStore } from "./session-profile-service.js";

interface ProfileRow extends Record<string, unknown> {
  id: string;
  name: string;
  location: "managed";
  secret_reference: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresSessionProfileStore implements SessionProfileStore {
  public constructor(private readonly pool: Pool) {}

  public create(user: AuthenticatedUser, profile: BrowserSessionProfileRecord): Promise<BrowserSessionProfile> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<ProfileRow>(
        `INSERT INTO browser_session_profiles (id, tenant_id, name, location, secret_reference, enabled, created_by)
         VALUES ($1, $2, $3, 'managed', $4, true, $5)
         RETURNING *`,
        [profile.id, user.tenantId, profile.name, profile.secretReference, user.userId],
      )).rows[0];
      if (!row) throw new Error("Browser session creation did not return a record.");
      return publicProfile(row);
    });
  }

  public list(user: AuthenticatedUser): Promise<BrowserSessionProfile[]> {
    return this.withUser(user, async (db) => (await db.query<ProfileRow>(
      "SELECT * FROM browser_session_profiles WHERE location = 'managed' ORDER BY name LIMIT 100",
    )).rows.map(publicProfile));
  }

  public findInternal(user: AuthenticatedUser, id: string): Promise<BrowserSessionProfileRecord | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<ProfileRow>("SELECT * FROM browser_session_profiles WHERE id = $1", [id])).rows[0];
      return row ? { ...publicProfile(row), secretReference: row.secret_reference } : undefined;
    });
  }

  public setEnabled(user: AuthenticatedUser, id: string, enabled: boolean): Promise<BrowserSessionProfile | undefined> {
    return this.withUser(user, async (db) => {
      const row = (await db.query<ProfileRow>(
        "UPDATE browser_session_profiles SET enabled = $2, updated_at = now() WHERE id = $1 RETURNING *",
        [id, enabled],
      )).rows[0];
      return row ? publicProfile(row) : undefined;
    });
  }

  public remove(user: AuthenticatedUser, id: string): Promise<boolean> {
    return this.withUser(user, async (db) => Boolean((await db.query<{ id: string }>(
      "DELETE FROM browser_session_profiles WHERE id = $1 RETURNING id",
      [id],
    )).rows[0]));
  }

  private async withUser<T>(user: AuthenticatedUser, work: Parameters<typeof withTenantTransaction<T>>[2]): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await withTenantTransaction(client, user, work);
    } finally {
      client.release();
    }
  }
}

function publicProfile(row: ProfileRow): BrowserSessionProfile {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    enabled: row.enabled,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
