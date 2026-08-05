import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/server.js";
import { AuthService, type AccountRecord, type AuthStore, type MembershipRole } from "../src/auth/auth-service.js";
import type { SessionIdentity } from "../src/auth/session-token.js";
import type { WorkflowDraft } from "../src/workflow/schema.js";
import type { PublishedWorkflowVersion } from "../src/workflow/versioning.js";
import { WorkflowService, type WorkflowAuditEvent, type WorkflowStore } from "../src/workflow/workflow-service.js";
import type { OperationalControls } from "../src/system/operational-controls.js";
import { safeReportWorkflowFixture } from "./fixtures/safe-report-workflow.js";

const workflowCreatePayload = {
  title: safeReportWorkflowFixture.title,
  allowedDomains: safeReportWorkflowFixture.allowedDomains,
  steps: safeReportWorkflowFixture.steps,
};

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

async function authenticatedApp() {
  return buildServer({ authService: new AuthService(new ServerAuthStore(), "a-session-secret-that-is-longer-than-thirty-two-bytes") });
}

class ServerWorkflowStore implements WorkflowStore {
  private readonly drafts: WorkflowDraft[] = [];
  private readonly active: PublishedWorkflowVersion[] = [];
  private readonly events: WorkflowAuditEvent[] = [];
  public async createDraft(draft: WorkflowDraft): Promise<void> {
    this.drafts.push(draft);
    this.events.push({ id: `${draft.id}-draft`, workflowId: draft.id, version: draft.version, eventType: "workflow.draft_created", createdAt: new Date().toISOString() });
  }
  public async listWorkflows(): Promise<[]> { return []; }
  public async findDraft(id: string): Promise<WorkflowDraft | undefined> { return this.drafts.find((draft) => draft.id === id); }
  public async activate(draft: PublishedWorkflowVersion): Promise<void> {
    this.active.push(draft);
    this.events.push({ id: `${draft.id}-published`, workflowId: draft.id, version: draft.version, eventType: "workflow.published", createdAt: new Date().toISOString() });
  }
  public async listAuditEvents(workflowId: string): Promise<WorkflowAuditEvent[]> { return this.events.filter((event) => event.workflowId === workflowId); }
}

async function workflowApp(operationalControls?: OperationalControls) {
  return buildServer({
    authService: new AuthService(new ServerAuthStore(), "a-session-secret-that-is-longer-than-thirty-two-bytes"),
    workflowService: new WorkflowService(new ServerWorkflowStore()),
    ...(operationalControls ? { operationalControls } : {}),
  });
}

test("health endpoint sends explicit browser security headers", async (t) => {
  const app = await buildServer();
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.headers["content-security-policy"], "default-src 'none';base-uri 'none';frame-ancestors 'none';form-action 'none'");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("policy API blocks a prohibited action", async (t) => {
  const app = await buildServer();
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
  const app = await buildServer();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/policy/evaluate",
    payload: { action: "read", unexpected: "value" },
  });

  assert.equal(response.statusCode, 400);
});

test("auth sign-up sends an HttpOnly session cookie and exposes no password material", async (t) => {
  const app = await authenticatedApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    headers: { origin: "http://localhost:3000" },
    payload: { email: "owner@example.com", password: "not-a-real-password", tenantName: "DoOnce demo" },
  });

  assert.equal(response.statusCode, 201);
  assert.match(response.headers["set-cookie"] ?? "", /HttpOnly/i);
  assert.match(response.headers["set-cookie"] ?? "", /SameSite=Lax/i);
  assert.doesNotMatch(response.body, /password|scrypt/i);
});

test("auth me requires a valid session cookie", async (t) => {
  const app = await authenticatedApp();
  t.after(async () => app.close());
  const signedUp = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    headers: { origin: "http://localhost:3000" },
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

test("auth mutations reject a missing or unapproved Origin", async (t) => {
  const app = await authenticatedApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    payload: { email: "owner@example.com", password: "not-a-real-password", tenantName: "DoOnce demo" },
  });

  assert.equal(response.statusCode, 403);
});

test("auth CORS permits the configured browser origin to include credentials", async (t) => {
  const app = await authenticatedApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "OPTIONS",
    url: "/api/v1/auth/sign-in",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:3000");
  assert.equal(response.headers["access-control-allow-credentials"], "true");
});

test("sign-in is rate limited after five requests from one client", async (t) => {
  const app = await authenticatedApp();
  t.after(async () => app.close());
  const request = {
    method: "POST" as const,
    url: "/api/v1/auth/sign-in",
    headers: { origin: "http://localhost:3000" },
    payload: { email: "missing@example.com", password: "not-a-real-password" },
  };
  for (let count = 0; count < 5; count += 1) {
    assert.equal((await app.inject(request)).statusCode, 401);
  }
  assert.equal((await app.inject(request)).statusCode, 429);
});

test("creates and publishes a policy-safe workflow for the authenticated tenant", async (t) => {
  const app = await workflowApp();
  t.after(async () => app.close());
  const signedUp = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    headers: { origin: "http://localhost:3000" },
    payload: { email: "owner@example.com", password: "not-a-real-password", tenantName: "DoOnce demo" },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/workflows",
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: workflowCreatePayload,
  });
  assert.equal(response.statusCode, 201);
  assert.notEqual(response.json().workflow.tenantId, safeReportWorkflowFixture.tenantId);

  const published = await app.inject({
    method: "POST",
    url: `/api/v1/workflows/${response.json().workflow.id}/publish`,
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
  });
  assert.equal(published.statusCode, 200);
  assert.equal(published.json().workflow.status, "active");

  const audit = await app.inject({
    method: "GET",
    url: `/api/v1/workflows/${response.json().workflow.id}/audit-events`,
    headers: { cookie: signedUp.headers["set-cookie"] ?? "" },
  });
  assert.equal(audit.statusCode, 200);
  assert.deepEqual(audit.json().events.map((event: { eventType: string }) => event.eventType), ["workflow.draft_created", "workflow.published"]);
});

test("workflow mutations reject a request without an approved Origin", async (t) => {
  const app = await workflowApp();
  t.after(async () => app.close());
  const response = await app.inject({ method: "POST", url: "/api/v1/workflows", payload: workflowCreatePayload });
  assert.equal(response.statusCode, 403);
});

test("kill switch blocks workflow mutations and is visible in public safety status", async (t) => {
  const app = await workflowApp({ workflowChangesEnabled: false, killSwitchActive: true });
  t.after(async () => app.close());
  const safety = await app.inject({ method: "GET", url: "/api/v1/system/safety" });
  const mutation = await app.inject({
    method: "POST",
    url: "/api/v1/workflows",
    headers: { origin: "http://localhost:3000" },
    payload: workflowCreatePayload,
  });

  assert.equal(safety.json().workflowChangesEnabled, false);
  assert.equal(safety.json().killSwitchActive, true);
  assert.equal(mutation.statusCode, 503);
});
