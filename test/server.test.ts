import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/server.js";
import { AuthService, type AccountRecord, type AuthStore, type MembershipRole } from "../src/auth/auth-service.js";
import type { SessionIdentity } from "../src/auth/session-token.js";

class ServerAuthStore implements AuthStore {
  private account: AccountRecord | undefined;
  private identity: SessionIdentity | undefined;
  private tokenHashes = new Set<string>();

  public async register(input: Parameters<AuthStore["register"]>[0]): Promise<void> {
    this.account = { userId: input.userId, email: input.email, passwordHash: input.passwordHash, defaultTenantId: input.tenantId };
    this.identity = { tenantId: input.tenantId, userId: input.userId };
    this.tokenHashes.add(input.sessionTokenHash);
  }

  public async findAccountByEmail(): Promise<AccountRecord | undefined> { return this.account; }
  public async findAccountByIdentity(): Promise<AccountRecord | undefined> { return this.account; }
  public async findRole(): Promise<MembershipRole | undefined> { return "owner"; }
  public async createSession(input: SessionIdentity & { tokenHash: string }): Promise<void> { this.tokenHashes.add(input.tokenHash); }
  public async findSession(tokenHash: string, identity: SessionIdentity): Promise<boolean> {
    return this.tokenHashes.has(tokenHash) && identity.tenantId === this.identity?.tenantId && identity.userId === this.identity?.userId;
  }
  public async revokeSession(tokenHash: string): Promise<void> { this.tokenHashes.delete(tokenHash); }
}

function authenticatedApp() {
  return buildServer({ authService: new AuthService(new ServerAuthStore(), "a-session-secret-that-is-longer-than-thirty-two-bytes") });
}

test("health endpoint sends explicit browser security headers", async (t) => {
  const app = buildServer();
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.headers["content-security-policy"], "default-src 'none';base-uri 'none';frame-ancestors 'none';form-action 'none'");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("policy API blocks a prohibited action", async (t) => {
  const app = buildServer();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/policy/evaluate",
    payload: { action: "payment" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    verdict: "blocked",
    risk: "irreversible",
    ruleId: "policy.prohibited-action",
    reason: "Submission, deletion, financial and credential actions are prohibited in version 1.",
  });
});

test("policy API rejects unknown request fields", async (t) => {
  const app = buildServer();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/policy/evaluate",
    payload: { action: "read", unexpected: "value" },
  });

  assert.equal(response.statusCode, 400);
});

test("auth sign-up sends an HttpOnly session cookie and exposes no password material", async (t) => {
  const app = authenticatedApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    payload: { email: "owner@example.com", password: "not-a-real-password", tenantName: "DoOnce demo" },
  });

  assert.equal(response.statusCode, 201);
  assert.match(response.headers["set-cookie"] ?? "", /HttpOnly/i);
  assert.match(response.headers["set-cookie"] ?? "", /SameSite=Lax/i);
  assert.doesNotMatch(response.body, /password|scrypt/i);
});

test("auth me requires a valid session cookie", async (t) => {
  const app = authenticatedApp();
  t.after(async () => app.close());
  const signedUp = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    payload: { email: "owner@example.com", password: "not-a-real-password", tenantName: "DoOnce demo" },
  });

  const unauthorized = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
  const authorized = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { cookie: signedUp.headers["set-cookie"] ?? "" },
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.json().user.email, "owner@example.com");
});
