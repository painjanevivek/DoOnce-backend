import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthService,
  type AccountRecord,
  type AuthStore,
  type MembershipRole,
} from "../src/auth/auth-service.js";
import type { SessionIdentity } from "../src/auth/session-token.js";

class MemoryAuthStore implements AuthStore {
  public readonly accounts = new Map<string, AccountRecord>();
  public readonly roles = new Map<string, MembershipRole>();
  public readonly sessions = new Map<string, { identity: SessionIdentity; revoked: boolean }>();

  public async register(input: Parameters<AuthStore["register"]>[0]): Promise<void> {
    if (this.accounts.has(input.email)) {
      const error = Object.assign(new Error("duplicate"), { code: "23505" });
      throw error;
    }
    this.accounts.set(input.email, {
      userId: input.userId,
      email: input.email,
      passwordHash: input.passwordHash,
      defaultTenantId: input.tenantId,
    });
    this.roles.set(key({ tenantId: input.tenantId, userId: input.userId }), "owner");
    this.sessions.set(input.sessionTokenHash, { identity: { tenantId: input.tenantId, userId: input.userId }, revoked: false });
  }

  public async findAccountByEmail(email: string): Promise<AccountRecord | undefined> {
    return this.accounts.get(email);
  }

  public async findAccountByIdentity(identity: SessionIdentity): Promise<AccountRecord | undefined> {
    return [...this.accounts.values()].find((account) => account.userId === identity.userId && account.defaultTenantId === identity.tenantId);
  }

  public async findRole(identity: SessionIdentity): Promise<MembershipRole | undefined> {
    return this.roles.get(key(identity));
  }

  public async createSession(input: SessionIdentity & { tokenHash: string }): Promise<void> {
    this.sessions.set(input.tokenHash, { identity: input, revoked: false });
  }

  public async findSession(tokenHash: string, identity: SessionIdentity): Promise<boolean> {
    const session = this.sessions.get(tokenHash);
    return Boolean(session && !session.revoked && key(session.identity) === key(identity));
  }

  public async revokeSession(tokenHash: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) session.revoked = true;
  }
}

const sessionSecret = "a-session-secret-that-is-longer-than-thirty-two-bytes";

function key(identity: SessionIdentity): string {
  return `${identity.tenantId}:${identity.userId}`;
}

test("creates a hashed password account and validates its signed session", async () => {
  const service = new AuthService(new MemoryAuthStore(), sessionSecret);
  const result = await service.signUp({
    email: "  Owner@Example.com ",
    password: "not-a-real-password",
    tenantName: "DoOnce demo",
  });

  assert.equal(result.user.email, "owner@example.com");
  assert.equal(result.user.role, "owner");
  assert.ok(await service.authenticate(result.token));
  assert.ok(await service.currentUser(result.token));
  assert.equal(await service.authenticate(`${result.token}tampered`), undefined);
});

test("invalidates a session after sign out", async () => {
  const service = new AuthService(new MemoryAuthStore(), sessionSecret);
  const result = await service.signUp({ email: "owner@example.com", password: "not-a-real-password", tenantName: "DoOnce demo" });
  await service.signOut(result.token);
  assert.equal(await service.authenticate(result.token), undefined);
});

test("does not reveal whether a sign-in email exists", async () => {
  const service = new AuthService(new MemoryAuthStore(), sessionSecret);
  await service.signUp({ email: "owner@example.com", password: "not-a-real-password", tenantName: "DoOnce demo" });
  assert.equal(await service.signIn({ email: "missing@example.com", password: "not-a-real-password" }), undefined);
  assert.equal(await service.signIn({ email: "owner@example.com", password: "wrong-password-value" }), undefined);
});
