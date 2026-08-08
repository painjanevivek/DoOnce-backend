import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/server.js";
import { AuthService, type AccountRecord, type AuthenticatedUser, type AuthStore, type MembershipRole } from "../src/auth/auth-service.js";
import { ReceiptAlreadyImportedError, type LocalDemoReceiptImport, type LocalDemoReceiptStore } from "../src/runner/postgres-run-receipt-store.js";
import type { RunReceipt } from "../src/runner/run-receipt.js";
import type { SessionIdentity } from "../src/auth/session-token.js";
import type { WorkflowDraft } from "../src/workflow/schema.js";
import type { PublishedWorkflowVersion } from "../src/workflow/versioning.js";
import { WorkflowService, type WorkflowAuditEvent, type WorkflowStore } from "../src/workflow/workflow-service.js";
import type { OperationalControls } from "../src/system/operational-controls.js";
import type { SubmittedSupportReport, SupportDiagnostic, SupportReportCategory, SupportReportStore } from "../src/support/postgres-support-report-store.js";
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

  public constructor(private readonly role: MembershipRole = "owner") {}

  public async register(input: Parameters<AuthStore["register"]>[0]): Promise<void> {
    this.account = { userId: input.userId, email: input.email, passwordHash: input.passwordHash, defaultTenantId: input.tenantId };
    this.identity = { tenantId: input.tenantId, userId: input.userId };
    this.tokenHashes.add(input.sessionTokenHash);
  }

  public async findAccountByEmail(): Promise<AccountRecord | undefined> { return this.account; }
  public async findAccountByIdentity(): Promise<AccountRecord | undefined> { return this.account; }
  public async findRole(): Promise<MembershipRole | undefined> { return this.role; }
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
  public async findDraft(id: string): Promise<WorkflowDraft | undefined> { return [...this.drafts].reverse().find((draft) => draft.id === id); }
  public async markPolicyPreviewed(id: string, _user: unknown, policyPreviewedAt: string): Promise<WorkflowDraft | undefined> {
    const draft = await this.findDraft(id);
    if (!draft) return undefined;
    draft.policyPreviewedAt = policyPreviewedAt;
    this.events.push({ id: `${draft.id}-preview`, workflowId: draft.id, version: draft.version, eventType: "workflow.policy_previewed", createdAt: policyPreviewedAt });
    return draft;
  }
  public async activate(draft: PublishedWorkflowVersion): Promise<void> {
    this.active.push(draft);
    this.events.push({ id: `${draft.id}-published`, workflowId: draft.id, version: draft.version, eventType: "workflow.published", createdAt: new Date().toISOString() });
  }
  public async createRepairDraft(id: string): Promise<WorkflowDraft | undefined> {
    const existing = await this.findDraft(id);
    if (existing?.version !== 1) return existing;
    const active = this.active.find((workflow) => workflow.id === id);
    if (!active) return undefined;
    const repair: WorkflowDraft = { id: active.id, version: active.version + 1, tenantId: active.tenantId, ownerId: active.ownerId, title: active.title, allowedDomains: [...active.allowedDomains], steps: active.steps.map((step) => ({ ...step })) };
    this.drafts.push(repair);
    this.events.push({ id: `${id}-repair`, workflowId: id, version: repair.version, eventType: "workflow.repair_draft_created", createdAt: new Date().toISOString() });
    return repair;
  }
  public async disableActive(id: string): Promise<number | undefined> {
    const active = this.active.find((workflow) => workflow.id === id);
    if (!active) return undefined;
    this.events.push({ id: `${id}-disabled`, workflowId: id, version: active.version, eventType: "workflow.disabled", createdAt: new Date().toISOString() });
    return active.version;
  }
  public async listAuditEvents(workflowId: string): Promise<WorkflowAuditEvent[]> { return this.events.filter((event) => event.workflowId === workflowId); }
}

class FailingWorkflowStore extends ServerWorkflowStore {
  public override async listWorkflows(): Promise<[]> { throw new Error("database password=not-for-clients"); }
}

class ServerRunReceiptStore implements LocalDemoReceiptStore {
  public readonly imports: Array<{ workflowId: string; input: LocalDemoReceiptImport; user: AuthenticatedUser }> = [];

  public async listLocalDemoReceipts(workflowId: string, user: AuthenticatedUser): Promise<RunReceipt[]> {
    return this.imports
      .filter((item) => item.workflowId === workflowId && item.user.tenantId === user.tenantId)
      .map((item) => ({
        id: item.input.sourceId,
        tenantId: item.user.tenantId,
        workflowId: item.workflowId,
        workflowVersion: 1,
        actorId: item.user.userId,
        outcome: item.input.outcome,
        ...(item.input.pauseReason ? { pauseReason: item.input.pauseReason } : {}),
        stepOutcomes: [{ stepId: safeReportWorkflowFixture.steps[0].id, outcome: item.input.outcome === "completed" ? "verified" : "paused" }],
        startedAt: "2026-08-05T00:00:00.000Z",
        finishedAt: "2026-08-05T00:00:00.000Z",
      }));
  }

  public async hasVerifiedTestRun(workflowId: string, workflowVersion: number, user: AuthenticatedUser): Promise<boolean> {
    return this.imports.some((item) => item.workflowId === workflowId && item.user.tenantId === user.tenantId && item.input.outcome === "completed" && workflowVersion === 1);
  }

  public async importLocalDemoReceipt(workflowId: string, input: LocalDemoReceiptImport, user: AuthenticatedUser): Promise<RunReceipt> {
    this.imports.push({ workflowId, input, user });
    return {
      id: input.sourceId,
      tenantId: user.tenantId,
      workflowId,
      workflowVersion: 1,
      actorId: user.userId,
      outcome: input.outcome,
      ...(input.pauseReason ? { pauseReason: input.pauseReason } : {}),
      stepOutcomes: [{ stepId: safeReportWorkflowFixture.steps[0].id, outcome: input.outcome === "completed" ? "verified" : "paused" }],
      startedAt: "2026-08-05T00:00:00.000Z",
      finishedAt: "2026-08-05T00:00:00.000Z",
    };
  }

  public async importDraftTestReceipt(workflowId: string, input: LocalDemoReceiptImport, user: AuthenticatedUser): Promise<RunReceipt> {
    if (input.outcome !== "completed" || input.pauseReason !== undefined) throw new Error("Draft tests require a completed receipt.");
    return this.importLocalDemoReceipt(workflowId, input, user);
  }
}

class DuplicateReceiptStore extends ServerRunReceiptStore {
  public override async importLocalDemoReceipt(): Promise<RunReceipt> {
    throw new ReceiptAlreadyImportedError();
  }
}

class HealthReceiptStore extends ServerRunReceiptStore {
  public constructor(private readonly receipts: RunReceipt[]) { super(); }

  public override async listLocalDemoReceipts(): Promise<RunReceipt[]> {
    return this.receipts;
  }
}

class ServerSupportReportStore implements SupportReportStore {
  public readonly reports: Array<{ category: SupportReportCategory; user: AuthenticatedUser }> = [];
  public readonly diagnostics: SupportDiagnostic[] = [];

  public async submit(category: SupportReportCategory, user: AuthenticatedUser, diagnostic?: SupportDiagnostic): Promise<SubmittedSupportReport> {
    this.reports.push({ category, user });
    if (diagnostic) this.diagnostics.push(diagnostic);
    return { id: "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", category, createdAt: "2026-08-05T00:00:00.000Z", diagnosticIncluded: diagnostic !== undefined };
  }
}

async function workflowApp(operationalControls?: OperationalControls, runReceiptStore?: LocalDemoReceiptStore, role: MembershipRole = "owner") {
  const receipts = runReceiptStore ?? new ServerRunReceiptStore();
  return buildServer({
    authService: new AuthService(new ServerAuthStore(role), "a-session-secret-that-is-longer-than-thirty-two-bytes"),
    workflowService: new WorkflowService(new ServerWorkflowStore(), receipts),
    ...(operationalControls ? { operationalControls } : {}),
    runReceiptStore: receipts,
  });
}

async function failingWorkflowApp() {
  return buildServer({
    authService: new AuthService(new ServerAuthStore(), "a-session-secret-that-is-longer-than-thirty-two-bytes"),
    workflowService: new WorkflowService(new FailingWorkflowStore()),
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

test("unexpected API errors do not disclose internal details", async (t) => {
  const app = await failingWorkflowApp();
  t.after(async () => app.close());
  const signedUp = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    headers: { origin: "http://localhost:3000" },
    payload: { email: "error-boundary@example.com", password: "correct-horse-battery-staple", tenantName: "Error Boundary" },
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/workflows",
    headers: { cookie: signedUp.headers["set-cookie"] ?? "" },
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: "Unexpected service error." });
  assert.doesNotMatch(response.body, /password|database/i);
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

test("stores a tenant-bound categorized support report without browser content", async (t) => {
  const reports = new ServerSupportReportStore();
  const app = await buildServer({
    authService: new AuthService(new ServerAuthStore(), "a-session-secret-that-is-longer-than-thirty-two-bytes"),
    supportReportStore: reports,
  });
  t.after(async () => app.close());
  const signedUp = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    headers: { origin: "http://localhost:3000" },
    payload: { email: "support@example.com", password: "correct-horse-battery-staple", tenantName: "Support tenant" },
  });

  const saved = await app.inject({
    method: "POST",
    url: "/api/v1/support-reports",
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: { category: "workflow-paused" },
  });
  assert.equal(saved.statusCode, 201);
  assert.equal(saved.json().report.category, "workflow-paused");
  assert.equal(reports.reports.length, 1);
  assert.equal(reports.reports[0]?.user.tenantId, signedUp.json().user.tenantId);

  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/support-reports",
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: { category: "page-html" },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(reports.reports.length, 1);
});

test("derives an opted-in support diagnostic from tenant-scoped receipt aggregates", async (t) => {
  const reports = new ServerSupportReportStore();
  const receipts = new ServerRunReceiptStore();
  const app = await buildServer({ authService: new AuthService(new ServerAuthStore(), "a-session-secret-that-is-longer-than-thirty-two-bytes"), supportReportStore: reports, runReceiptStore: receipts });
  t.after(async () => app.close());
  const signedUp = await app.inject({ method: "POST", url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:3000" }, payload: { email: "diagnostic@example.com", password: "correct-horse-battery-staple", tenantName: "Diagnostics" } });
  const workflowId = "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
  const response = await app.inject({ method: "POST", url: "/api/v1/support-reports", headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" }, payload: { category: "workflow-paused", includeRunHealth: true, workflowId, workflowVersion: 1 } });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().report.diagnosticIncluded, true);
  assert.deepEqual(reports.diagnostics, [{ workflowId, workflowVersion: 1, sampleSize: 0, completedRuns: 0, pausedRuns: 0, successRate: 0, pauseReasons: {} }]);
  assert.doesNotMatch(response.body, /workflowId|sampleSize|pauseReasons/i);
});

test("rate limits support reports without affecting authenticated workflow reads", async (t) => {
  const reports = new ServerSupportReportStore();
  const app = await buildServer({ authService: new AuthService(new ServerAuthStore(), "a-session-secret-that-is-longer-than-thirty-two-bytes"), supportReportStore: reports, workflowService: new WorkflowService(new ServerWorkflowStore()) });
  t.after(async () => app.close());
  const signedUp = await app.inject({ method: "POST", url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:3000" }, payload: { email: "support-limit@example.com", password: "correct-horse-battery-staple", tenantName: "Support limits" } });
  const report = { method: "POST" as const, url: "/api/v1/support-reports", headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" }, payload: { category: "other" } };

  for (let count = 0; count < 10; count += 1) assert.equal((await app.inject(report)).statusCode, 201);
  assert.equal((await app.inject(report)).statusCode, 429);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/workflows", headers: { cookie: signedUp.headers["set-cookie"] ?? "" } })).statusCode, 200);
});

test("imports a local receipt only through an authenticated same-origin dashboard request", async (t) => {
  const receipts = new ServerRunReceiptStore();
  const app = await workflowApp(undefined, receipts);
  t.after(async () => app.close());
  const signedUp = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    headers: { origin: "http://localhost:3000" },
    payload: { email: "receipt-owner@example.com", password: "correct-horse-battery-staple", tenantName: "Receipt workspace" },
  });
  const receiptId = "f0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
  const workflowId = "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
  const accepted = await app.inject({
    method: "POST",
    url: `/api/v1/workflows/${workflowId}/run-receipts/import`,
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: { sourceId: receiptId, outcome: "completed" },
  });
  const rejected = await app.inject({
    method: "POST",
    url: `/api/v1/workflows/${workflowId}/run-receipts/import`,
    headers: { cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: { sourceId: receiptId, outcome: "completed" },
  });

  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.json().receipt.id, receiptId);
  assert.equal("tenantId" in accepted.json().receipt, false);
  assert.equal("actorId" in accepted.json().receipt, false);
  assert.equal(receipts.imports.length, 1);
  assert.equal(rejected.statusCode, 403);
});

test("rejects unstructured pause text from a local receipt import", async (t) => {
  const receipts = new ServerRunReceiptStore();
  const app = await workflowApp(undefined, receipts);
  t.after(async () => app.close());
  const signedUp = await app.inject({ method: "POST", url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:3000" }, payload: { email: "receipt-code@example.com", password: "correct-horse-battery-staple", tenantName: "Receipt code" } });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/workflows/a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b/run-receipts/import",
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: { sourceId: "f0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", outcome: "paused", pauseReason: "The page looked unusual." },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(receipts.imports.length, 0);
});

test("allows runners but denies reviewers from saving a run receipt", async (t) => {
  const runnerReceipts = new ServerRunReceiptStore();
  const reviewerReceipts = new ServerRunReceiptStore();
  const runnerApp = await workflowApp(undefined, runnerReceipts, "runner");
  const reviewerApp = await workflowApp(undefined, reviewerReceipts, "reviewer");
  t.after(async () => Promise.all([runnerApp.close(), reviewerApp.close()]));
  const signup = { method: "POST" as const, url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:3000" }, payload: { email: "role-receipt@example.com", password: "correct-horse-battery-staple", tenantName: "Role receipt" } };
  const runner = await runnerApp.inject(signup);
  const reviewer = await reviewerApp.inject(signup);
  const receiptId = "e0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
  const request = (cookie: string | undefined) => ({ method: "POST" as const, url: "/api/v1/workflows/a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b/run-receipts/import", headers: { origin: "http://localhost:3000", cookie: cookie ?? "" }, payload: { sourceId: receiptId, outcome: "completed" } });

  assert.equal((await runnerApp.inject(request(runner.headers["set-cookie"]))).statusCode, 201);
  assert.equal((await reviewerApp.inject(request(reviewer.headers["set-cookie"]))).statusCode, 403);
  assert.equal(reviewerReceipts.imports.length, 0);
});

test("denies runners and reviewers from recording policy previews", async (t) => {
  const runnerApp = await workflowApp(undefined, undefined, "runner");
  const reviewerApp = await workflowApp(undefined, undefined, "reviewer");
  t.after(async () => Promise.all([runnerApp.close(), reviewerApp.close()]));
  const signup = { method: "POST" as const, url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:3000" }, payload: { email: "role-preview@example.com", password: "correct-horse-battery-staple", tenantName: "Role preview" } };
  const runner = await runnerApp.inject(signup);
  const reviewer = await reviewerApp.inject(signup);
  const request = (cookie: string | undefined) => ({ method: "POST" as const, url: "/api/v1/workflows/a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b/preview", headers: { origin: "http://localhost:3000", cookie: cookie ?? "" } });

  assert.equal((await runnerApp.inject(request(runner.headers["set-cookie"]))).statusCode, 403);
  assert.equal((await reviewerApp.inject(request(reviewer.headers["set-cookie"]))).statusCode, 403);
});

test("lists tenant-scoped run receipt history for an authenticated dashboard session", async (t) => {
  const receipts = new ServerRunReceiptStore();
  const app = await workflowApp(undefined, receipts);
  t.after(async () => app.close());
  const signedUp = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    headers: { origin: "http://localhost:3000" },
    payload: { email: "receipt-history@example.com", password: "correct-horse-battery-staple", tenantName: "Receipt history" },
  });
  const workflowId = "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
  const receiptId = "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
  await app.inject({
    method: "POST",
    url: `/api/v1/workflows/${workflowId}/run-receipts/import`,
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: { sourceId: receiptId, outcome: "paused", pauseReason: "slow-network" },
  });
  const unauthorized = await app.inject({ method: "GET", url: `/api/v1/workflows/${workflowId}/run-receipts` });
  const authorized = await app.inject({ method: "GET", url: `/api/v1/workflows/${workflowId}/run-receipts`, headers: { cookie: signedUp.headers["set-cookie"] ?? "" } });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.json().receipts.map((receipt: RunReceipt) => ({ id: receipt.id, outcome: receipt.outcome, pauseReason: receipt.pauseReason })), [{ id: receiptId, outcome: "paused", pauseReason: "slow-network" }]);
  assert.equal("tenantId" in authorized.json().receipts[0], false);
  assert.equal("actorId" in authorized.json().receipts[0], false);
});

test("reports bounded per-version run health without returning individual receipt data", async (t) => {
  const receipts: RunReceipt[] = [
    ...Array.from({ length: 45 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, tenantId: "10000000-0000-4000-8000-000000000001", workflowId: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", workflowVersion: 1, actorId: "20000000-0000-4000-8000-000000000001", outcome: "completed" as const, stepOutcomes: [], startedAt: "2026-08-05T00:00:00.000Z", finishedAt: "2026-08-05T00:00:00.000Z" })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `00000000-0000-4000-8001-${String(index).padStart(12, "0")}`, tenantId: "10000000-0000-4000-8000-000000000001", workflowId: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", workflowVersion: 1, actorId: "20000000-0000-4000-8000-000000000001", outcome: "paused" as const, pauseReason: "slow-network", stepOutcomes: [], startedAt: "2026-08-05T00:00:00.000Z", finishedAt: "2026-08-05T00:00:00.000Z" })),
  ];
  const app = await workflowApp(undefined, new HealthReceiptStore(receipts));
  t.after(async () => app.close());
  const signedUp = await app.inject({ method: "POST", url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:3000" }, payload: { email: "health-owner@example.com", password: "correct-horse-battery-staple", tenantName: "Health workspace" } });
  const url = "/api/v1/workflows/a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b/run-health?version=1";
  const unauthorized = await app.inject({ method: "GET", url });
  const authorized = await app.inject({ method: "GET", url, headers: { cookie: signedUp.headers["set-cookie"] ?? "" } });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.json(), { health: { workflowVersion: 1, sampleSize: 50, completedRuns: 45, pausedRuns: 5, successRate: 90, pauseReasons: { "slow-network": 5 }, meetsManualReliabilityThreshold: true } });
  assert.doesNotMatch(authorized.body, /tenantId|actorId|00000000/i);
});

test("exports only tenant-scoped workflow audit events as a no-store JSON attachment", async (t) => {
  const app = await workflowApp();
  t.after(async () => app.close());
  const signedUp = await app.inject({ method: "POST", url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:3000" }, payload: { email: "audit-export@example.com", password: "correct-horse-battery-staple", tenantName: "Audit export" } });
  const workflowId = "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
  const response = await app.inject({ method: "GET", url: `/api/v1/workflows/${workflowId}/audit-events/export`, headers: { cookie: signedUp.headers["set-cookie"] ?? "" } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["content-disposition"], "attachment; filename=doonce-workflow-audit.json");
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(response.json(), { workflowId, events: [] });
});

test("reports a duplicate local receipt without exposing database details", async (t) => {
  const app = await workflowApp(undefined, new DuplicateReceiptStore());
  t.after(async () => app.close());
  const signedUp = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-up",
    headers: { origin: "http://localhost:3000" },
    payload: { email: "duplicate-receipt@example.com", password: "correct-horse-battery-staple", tenantName: "Duplicate receipt" },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/workflows/a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b/run-receipts/import",
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: { sourceId: "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", outcome: "completed" },
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: "This receipt was already saved." });
  assert.doesNotMatch(response.body, /unique|postgres|database/i);
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

  const review = await app.inject({
    method: "GET",
    url: `/api/v1/workflows/${response.json().workflow.id}`,
    headers: { cookie: signedUp.headers["set-cookie"] ?? "" },
  });
  assert.equal(review.statusCode, 200);
  assert.equal(review.json().workflow.steps[0].kind, "download");
  assert.equal(review.json().workflow.policyPreviewed, false);

  const preview = await app.inject({ method: "POST", url: `/api/v1/workflows/${response.json().workflow.id}/preview`, headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" } });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().preview, "policy-passed");
  assert.equal(preview.json().workflow.policyPreviewed, true);

  const publicationWithoutTest = await app.inject({
    method: "POST",
    url: `/api/v1/workflows/${response.json().workflow.id}/publish`,
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
  });
  assert.equal(publicationWithoutTest.statusCode, 400);

  const pausedTest = await app.inject({
    method: "POST",
    url: `/api/v1/workflows/${response.json().workflow.id}/test-receipts/import`,
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: { sourceId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", outcome: "paused", pauseReason: "changed-page" },
  });
  assert.equal(pausedTest.statusCode, 400);

  const testReceipt = await app.inject({
    method: "POST",
    url: `/api/v1/workflows/${response.json().workflow.id}/test-receipts/import`,
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
    payload: { sourceId: "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", outcome: "completed" },
  });
  assert.equal(testReceipt.statusCode, 201);
  assert.equal(testReceipt.json().workflow.testRunVerified, true);

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
  assert.deepEqual(audit.json().events.map((event: { eventType: string }) => event.eventType), ["workflow.draft_created", "workflow.policy_previewed", "workflow.published"]);

  const disabled = await app.inject({
    method: "POST",
    url: `/api/v1/workflows/${response.json().workflow.id}/disable`,
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.json().disabledVersion, 1);

  const disabledAudit = await app.inject({
    method: "GET",
    url: `/api/v1/workflows/${response.json().workflow.id}/audit-events`,
    headers: { cookie: signedUp.headers["set-cookie"] ?? "" },
  });
  assert.deepEqual(disabledAudit.json().events.map((event: { eventType: string }) => event.eventType), ["workflow.draft_created", "workflow.policy_previewed", "workflow.published", "workflow.disabled"]);

  const repair = await app.inject({
    method: "POST",
    url: `/api/v1/workflows/${response.json().workflow.id}/repair-draft`,
    headers: { origin: "http://localhost:3000", cookie: signedUp.headers["set-cookie"] ?? "" },
  });
  assert.equal(repair.statusCode, 201);
  assert.equal(repair.json().workflow.version, 2);
  assert.equal(repair.json().repair, "reconfirm-safe-step");

  const repairAudit = await app.inject({
    method: "GET",
    url: `/api/v1/workflows/${response.json().workflow.id}/audit-events`,
    headers: { cookie: signedUp.headers["set-cookie"] ?? "" },
  });
  assert.deepEqual(repairAudit.json().events.map((event: { eventType: string }) => event.eventType), ["workflow.draft_created", "workflow.policy_previewed", "workflow.published", "workflow.disabled", "workflow.repair_draft_created"]);
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
  const preview = await app.inject({
    method: "POST",
    url: "/api/v1/workflows/a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b/preview",
    headers: { origin: "http://localhost:3000" },
  });

  assert.equal(safety.json().workflowChangesEnabled, false);
  assert.equal(safety.json().killSwitchActive, true);
  assert.equal(mutation.statusCode, 503);
  assert.equal(preview.statusCode, 503);
});
