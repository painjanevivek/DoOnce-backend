import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyError } from "fastify";
import { AuthInputError, AuthService, EmailAlreadyRegisteredError } from "./auth/auth-service.js";
import { WorkflowAccessError, WorkflowInputError, WorkflowService } from "./workflow/workflow-service.js";
import { CanonicalWorkflowAccessError, CanonicalWorkflowInputError, CanonicalWorkflowService } from "./workflow/canonical-workflow-service.js";
import { ReceiptAlreadyImportedError, type LocalDemoReceiptImport, type LocalDemoReceiptStore } from "./runner/postgres-run-receipt-store.js";
import { summarizeRunHealth } from "./runner/run-health.js";
import type { RunReceipt } from "./runner/run-receipt.js";
import { operationalControlsFromEnvironment, type OperationalControls } from "./system/operational-controls.js";
import { supportReportCategories, type SupportDiagnostic, type SupportReportCategory, type SupportReportStore } from "./support/postgres-support-report-store.js";
import {
  evaluateActionCapabilities,
  isActionKind,
  isSensitiveFieldKind,
  type ActionKind,
  type SensitiveFieldKind,
} from "./execution/action-capabilities.js";
import { CaptureConflictError, CaptureInputError, CaptureService } from "./capture/capture-service.js";
import { CaptureCompilationNotFoundError, CaptureCompilationService } from "./compiler/capture-compilation-service.js";
import { CaptureCompilationError } from "./compiler/capture-workflow-compiler.js";
import { RunAccessError, RunConflictError, RunInputError, RunService } from "./runner/run-service.js";
import { ArtifactInputError, ArtifactNotFoundError, ArtifactService } from "./artifacts/artifact-service.js";
import { AuthoringAccessError, AuthoringConflictError, AuthoringInputError, AuthoringLimitError, AuthoringService } from "./authoring/authoring-service.js";
import { RepairAccessError, RepairConflictError, RepairInputError, RepairService } from "./repair/repair-service.js";
import { ScheduleAccessError, ScheduleInputError, ScheduleService } from "./scheduling/schedule-service.js";
import { SessionProfileAccessError, SessionProfileInputError, SessionProfileService } from "./sessions/session-profile-service.js";
import type { JobQueue } from "./queue/job-queue.js";
import type { DurableWorkers } from "./queue/workers.js";
import { WebhookAccessError, WebhookAuthenticationError, WebhookInputError, WebhookService } from "./triggers/webhook-service.js";
import { VideoAccessError, VideoConflictError, VideoInputError, VideoService } from "./video/video-service.js";

const defaultAllowedOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

function allowedOriginsFromEnvironment(): string[] {
  const configured = process.env.DOONCE_ALLOWED_ORIGINS;
  if (!configured) return defaultAllowedOrigins;
  return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export interface ServerOptions {
  authService?: AuthService;
  workflowService?: WorkflowService;
  canonicalWorkflowService?: CanonicalWorkflowService;
  captureService?: CaptureService;
  captureCompilationService?: CaptureCompilationService;
  extensionOrigins?: string[];
  runReceiptStore?: LocalDemoReceiptStore;
  runService?: RunService;
  artifactService?: ArtifactService;
  authoringService?: AuthoringService;
  repairService?: RepairService;
  scheduleService?: ScheduleService;
  sessionProfileService?: SessionProfileService;
  jobQueue?: JobQueue;
  durableWorkers?: DurableWorkers;
  webhookService?: WebhookService;
  supportReportStore?: SupportReportStore;
  operationalControls?: OperationalControls;
  videoService?: VideoService;
}

const sessionCookieName = "doonce_session";

function repairError(error: unknown, reply: import("fastify").FastifyReply) {
  if (error instanceof RepairAccessError) return reply.code(403).send({ error: error.message, code: "repair.access_denied" });
  if (error instanceof RepairConflictError) return reply.code(409).send({ error: error.message, code: "repair.conflict" });
  if (error instanceof RepairInputError) return reply.code(422).send({ error: error.message, code: "repair.invalid_input" });
  throw error;
}

function scheduleError(error: unknown, reply: import("fastify").FastifyReply) {
  if (error instanceof ScheduleAccessError || error instanceof SessionProfileAccessError) return reply.code(403).send({ error: error.message });
  if (error instanceof ScheduleInputError || error instanceof SessionProfileInputError) return reply.code(422).send({ error: error.message });
  throw error;
}

function webhookError(error: unknown, reply: import("fastify").FastifyReply) {
  if (error instanceof WebhookAuthenticationError) return reply.code(401).send({ error: "Webhook authentication failed." });
  if (error instanceof WebhookAccessError) return reply.code(403).send({ error: error.message });
  if (error instanceof WebhookInputError) return reply.code(422).send({ error: error.message });
  throw error;
}

function videoError(error: unknown, reply: import("fastify").FastifyReply) {
  if (error instanceof VideoAccessError) return reply.code(403).send({ error: error.message, code: "video.access_denied" });
  if (error instanceof VideoConflictError) {
    if (error.expectedOffset !== undefined) reply.header("upload-offset", error.expectedOffset);
    return reply.code(409).send({ error: error.message, code: "video.conflict", ...(error.expectedOffset !== undefined ? { expectedOffset: error.expectedOffset } : {}) });
  }
  if (error instanceof VideoInputError) return reply.code(422).send({ error: error.message, code: "video.invalid_input" });
  throw error;
}

export async function buildServer(options: ServerOptions = {}) {
  const allowedOrigins = allowedOriginsFromEnvironment();
  const extensionOrigins = options.extensionOrigins ?? (process.env.DOONCE_EXTENSION_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  const browserOrigins = [...allowedOrigins, ...extensionOrigins];
  const operationalControls = options.operationalControls ?? operationalControlsFromEnvironment();
  const app = Fastify({
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
    logger: {
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
    },
    trustProxy: false,
  });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  if (process.env.NODE_ENV !== "production") {
    await app.register(swagger, {
      openapi: {
        openapi: "3.1.0",
        info: { title: "DoOnce API", version: "1.0.0", description: "Versioned workflow authoring and execution API." },
        servers: [{ url: "http://127.0.0.1:4000", description: "Local development" }],
      },
    });
  }

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
      },
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || browserOrigins.includes(origin) || isExtensionOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed."), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization", "upload-offset"],
    exposedHeaders: ["upload-offset"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false, max: 100, timeWindow: "1 minute" });
  app.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/api/")) reply.header("cache-control", "no-store");
  });
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({
      error: {
        name: error.name,
        code: error.code,
        statusCode: error.statusCode,
        stack: error.stack?.split(/\r?\n/).slice(1).join("\n"),
      },
    }, "Unhandled API error");
    if (error.validation) return reply.code(400).send({ error: "Invalid request." });
    if (error.statusCode === 429) return reply.code(429).send({ error: "Too many requests. Please try again shortly." });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) return reply.code(error.statusCode).send({ error: "Request rejected." });
    return reply.code(500).send({ error: "Unexpected service error." });
  });

  app.get("/health", async () => ({ status: "ok", service: "doonce-api" }));

  if (process.env.NODE_ENV !== "production") {
    app.get("/api/v1/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  }

  const capabilitiesSummary = () => ({
    public: true,
    message: "This endpoint describes the actions available to the current workflow runtime.",
    blocked: ["submit", "delete", "payment", "credential", "otp"],
    paused: ["unknown"],
    workflowChangesEnabled: operationalControls.workflowChangesEnabled,
    killSwitchActive: operationalControls.killSwitchActive,
  });

  app.get("/api/v1/system/capabilities", async () => capabilitiesSummary());

  app.post<{ Body: unknown }>("/api/v1/capture-sessions/handshake", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { body: { type: "object" } },
  }, async (request, reply) => {
    const captures = options.captureService;
    if (!captures) return reply.code(503).send({ error: "Capture synchronization is not configured." });
    try {
      return captures.handshake(request.body);
    } catch (error) {
      if (error instanceof CaptureInputError) return reply.code(400).send({ error: error.message, code: "capture.handshake_invalid" });
      throw error;
    }
  });

  app.post("/api/v1/capture-sessions/pairing-codes", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const captures = options.captureService;
    const auth = options.authService;
    if (!captures || !auth) return reply.code(503).send({ error: "Capture pairing is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    return captures.createPairingCode(user);
  });

  app.post<{ Body: unknown }>("/api/v1/capture-sessions/pair", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    schema: { body: { type: "object", required: ["code"], additionalProperties: false, properties: { code: { type: "string", minLength: 12, maxLength: 32 } } } },
  }, async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !isExtensionOrigin(origin) && !browserOrigins.includes(origin)) return reply.code(403).send({ error: "Origin is not allowed." });
    const captures = options.captureService;
    if (!captures) return reply.code(503).send({ error: "Capture pairing is not configured." });
    try {
      return await captures.exchangePairingCode(request.body);
    } catch (error) {
      if (error instanceof CaptureInputError) return reply.code(400).send({ error: error.message, code: "capture.pairing_invalid" });
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/capture-sessions/:id/sync", {
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } }, body: { type: "object" } },
  }, async (request, reply) => {
    const requestOrigin = request.headers.origin;
    if (requestOrigin && !browserOrigins.includes(requestOrigin) && !isExtensionOrigin(requestOrigin)) return reply.code(403).send({ error: "Origin is not allowed." });
    const captures = options.captureService;
    const auth = options.authService;
    if (!captures || !auth) return reply.code(503).send({ error: "Capture synchronization is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]) ?? await captures.authenticateExtension(request.headers.authorization);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return await captures.sync(user, request.params.id, request.body);
    } catch (error) {
      if (error instanceof CaptureInputError) return reply.code(400).send({ error: error.message, code: "capture.batch_invalid" });
      if (error instanceof CaptureConflictError) return reply.code(409).send({ error: error.message, code: "capture.cursor_conflict" });
      throw error;
    }
  });

  app.get("/api/v1/capture-sessions", async (request, reply) => {
    const captures = options.captureService;
    const auth = options.authService;
    if (!captures || !auth) return reply.code(503).send({ error: "Capture sessions are not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    return { sessions: await captures.listSessions(user) };
  });

  app.post<{ Params: { id: string } }>("/api/v1/capture-sessions/:id/compile", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService;
    const compilations = options.captureCompilationService;
    if (!auth || !compilations) return reply.code(503).send({ error: "Capture compilation is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return reply.code(201).send(await compilations.compile(user, request.params.id));
    } catch (error) {
      if (error instanceof CaptureCompilationNotFoundError) return reply.code(404).send({ error: error.message, code: "capture.not_found" });
      if (error instanceof CaptureCompilationError) return reply.code(409).send({ error: error.message, code: "capture.not_ready" });
      if (error instanceof CanonicalWorkflowAccessError) return reply.code(403).send({ error: error.message, code: "workflow.access_denied" });
      if (error instanceof CanonicalWorkflowInputError || error instanceof CaptureInputError) return reply.code(400).send({ error: error.message, code: "capture.compilation_invalid" });
      throw error;
    }
  });

  app.post("/api/v1/capture-sessions/unpair", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
  }, async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !isExtensionOrigin(origin) && !browserOrigins.includes(origin)) return reply.code(403).send({ error: "Origin is not allowed." });
    const captures = options.captureService;
    if (!captures) return reply.code(503).send({ error: "Capture pairing is not configured." });
    return (await captures.revokeExtension(request.headers.authorization)) ? { disconnected: true } : reply.code(401).send({ error: "Extension credential is invalid." });
  });

  app.get("/api/v1/system/safety", async (_request, reply) => {
    reply
      .header("deprecation", "true")
      .header("sunset", "Sun, 31 Jan 2027 00:00:00 GMT")
      .header("link", '</api/v1/system/capabilities>; rel="successor-version"');
    return capabilitiesSummary();
  });

  const actionEvaluationSchema = {
    schema: {
      body: {
        type: "object",
        required: ["action"],
        additionalProperties: false,
        properties: {
          action: { type: "string", maxLength: 32 },
          fieldKind: { type: "string", maxLength: 32 },
        },
      },
    },
  } as const;

  app.post<{ Body: { action?: unknown; fieldKind?: unknown } }>("/api/v1/capabilities/evaluate", actionEvaluationSchema, async (request, reply) => {
    const { action, fieldKind } = request.body;
    if (!isActionKind(action) || (fieldKind !== undefined && !isSensitiveFieldKind(fieldKind))) {
      return reply.code(400).send({ error: "Invalid capability evaluation input.", code: "capabilities.invalid_input" });
    }
    return evaluateActionCapabilities({
      action: action as ActionKind,
      ...(fieldKind === undefined ? {} : { fieldKind: fieldKind as SensitiveFieldKind }),
    });
  });

  app.post<{ Body: { action?: unknown; fieldKind?: unknown } }>("/api/v1/policy/evaluate", actionEvaluationSchema, async (request, reply) => {
    reply
      .header("deprecation", "true")
      .header("sunset", "Sun, 31 Jan 2027 00:00:00 GMT")
      .header("link", '</api/v1/capabilities/evaluate>; rel="successor-version"');
    const { action, fieldKind } = request.body;
    if (!isActionKind(action) || (fieldKind !== undefined && !isSensitiveFieldKind(fieldKind))) {
      return reply.code(400).send({ error: "Invalid capability evaluation input.", code: "capabilities.invalid_input" });
    }
    const decision = evaluateActionCapabilities({
      action: action as ActionKind,
      ...(fieldKind === undefined ? {} : { fieldKind: fieldKind as SensitiveFieldKind }),
    });
    return { ...decision, ruleId: decision.ruleId.replace(/^capability\./, "policy.") };
  });

  app.post<{ Body: { email?: unknown; password?: unknown; tenantName?: unknown } }>("/api/v1/auth/sign-up", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        required: ["email", "password", "tenantName"],
        additionalProperties: false,
        properties: {
          email: { type: "string", maxLength: 320 },
          password: { type: "string", minLength: 12, maxLength: 128 },
          tenantName: { type: "string", minLength: 1, maxLength: 120 },
        },
      },
    },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    if (!auth) return reply.code(503).send({ error: "Authentication is not configured." });
    try {
      const session = await auth.signUp(request.body);
      setSessionCookie(reply, session.token);
      return reply.code(201).send({ user: session.user });
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) return reply.code(409).send({ error: "Unable to create account." });
      if (error instanceof AuthInputError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  app.post<{ Body: { email?: unknown; password?: unknown } }>("/api/v1/auth/sign-in", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        additionalProperties: false,
        properties: {
          email: { type: "string", maxLength: 320 },
          password: { type: "string", minLength: 1, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    if (!auth) return reply.code(503).send({ error: "Authentication is not configured." });
    try {
      const session = await auth.signIn(request.body);
      if (!session) return reply.code(401).send({ error: "Invalid email or password." });
      setSessionCookie(reply, session.token);
      return { user: session.user };
    } catch (error) {
      if (error instanceof AuthInputError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  app.post("/api/v1/auth/sign-out", async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    if (!auth) return reply.code(503).send({ error: "Authentication is not configured." });
    await auth.signOut(request.cookies[sessionCookieName]);
    reply.clearCookie(sessionCookieName, sessionCookieOptions());
    return reply.code(204).send();
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const auth = options.authService;
    if (!auth) return reply.code(503).send({ error: "Authentication is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    return { user };
  });

  app.post<{ Body: unknown }>("/api/v1/authoring-jobs", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { body: { type: "object" } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService; const authoring = options.authoringService;
    if (!auth || !authoring) return reply.code(503).send({ error: "Text authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const queued = await authoring.enqueue(user, request.body);
      if (options.durableWorkers) await options.durableWorkers.enqueueAuthoring(user, queued.job.id);
      else queueMicrotask(() => { void authoring.process(user, queued.job.id).catch((error: unknown) => request.log.error({ name: error instanceof Error ? error.name : "UnknownError" }, "Authoring worker failed")); });
      return reply.code(queued.created ? 202 : 200).send(queued);
    } catch (error) {
      if (error instanceof AuthoringAccessError) return reply.code(403).send({ error: error.message, code: "authoring.access_denied" });
      if (error instanceof AuthoringConflictError) return reply.code(409).send({ error: error.message, code: "authoring.idempotency_conflict" });
      if (error instanceof AuthoringLimitError) return reply.code(429).send({ error: error.message, code: "authoring.limit_reached" });
      if (error instanceof AuthoringInputError) return reply.code(400).send({ error: error.message, code: "authoring.invalid_input" });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/api/v1/authoring-jobs/:id", { schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } } }, async (request, reply) => {
    const auth = options.authService; const authoring = options.authoringService;
    if (!auth || !authoring) return reply.code(503).send({ error: "Text authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const job = await authoring.find(user, request.params.id);
      if (!job) return reply.code(404).send({ error: "Authoring job not found." });
      if (job.status === "queued") queueMicrotask(() => { void authoring.process(user, job.id).catch((error: unknown) => request.log.error({ name: error instanceof Error ? error.name : "UnknownError" }, "Authoring worker failed")); });
      return { job };
    } catch (error) { if (error instanceof AuthoringInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.get<{ Params: { id: string } }>("/api/v1/authoring-jobs/:id/events", { schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } } }, async (request, reply) => {
    const auth = options.authService; const authoring = options.authoringService;
    if (!auth || !authoring) return reply.code(503).send({ error: "Text authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { return { events: await authoring.events(user, request.params.id) }; }
    catch (error) { if (error instanceof AuthoringInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.post<{ Params: { id: string } }>("/api/v1/authoring-jobs/:id/cancel", { schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService; const authoring = options.authoringService;
    if (!auth || !authoring) return reply.code(503).send({ error: "Text authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { const job = await authoring.cancel(user, request.params.id); return job ? { job } : reply.code(404).send({ error: "Authoring job not found." }); }
    catch (error) { if (error instanceof AuthoringAccessError) return reply.code(403).send({ error: error.message }); if (error instanceof AuthoringInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  const videoIdSchema = { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } as const;
  app.post<{ Body: unknown }>("/api/v1/video-imports", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        required: ["mode", "fileName", "contentType", "byteSize"],
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["video-with-telemetry", "pure-video"] },
          captureSessionId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
          fileName: { type: "string", minLength: 1, maxLength: 255 },
          contentType: { type: "string", enum: ["video/mp4", "video/webm", "video/quicktime"] },
          byteSize: { type: "integer", minimum: 1, maximum: 524288000 },
        },
      },
    },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService; const videos = options.videoService;
    if (!auth || !videos) return reply.code(503).send({ error: "Video authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const video = await videos.create(user, request.body);
      await options.durableWorkers?.registerVideoCleanup(user);
      return reply.code(201).header("upload-offset", video.uploadedBytes).send({ video });
    } catch (error) { return videoError(error, reply); }
  });

  app.put<{ Params: { id: string }; Headers: { "upload-offset"?: string }; Body: Buffer }>("/api/v1/video-imports/:id/chunks", {
    bodyLimit: 8 * 1024 * 1024,
    config: { rateLimit: { max: 180, timeWindow: "1 minute" } },
    schema: { params: videoIdSchema },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService; const videos = options.videoService;
    if (!auth || !videos) return reply.code(503).send({ error: "Video authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    const offset = Number(request.headers["upload-offset"]);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "A valid upload offset and binary chunk are required." });
    try {
      const video = await videos.append(user, request.params.id, offset, request.body);
      return reply.header("upload-offset", video.uploadedBytes).send({ video });
    } catch (error) { return videoError(error, reply); }
  });

  app.post<{ Params: { id: string } }>("/api/v1/video-imports/:id/complete", { schema: { params: videoIdSchema } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService; const videos = options.videoService;
    if (!auth || !videos) return reply.code(503).send({ error: "Video authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { return { video: await videos.completeUpload(user, request.params.id) }; }
    catch (error) { return videoError(error, reply); }
  });

  app.post<{ Params: { id: string } }>("/api/v1/video-imports/:id/analyze", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } }, schema: { params: videoIdSchema } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService; const videos = options.videoService;
    if (!auth || !videos) return reply.code(503).send({ error: "Video authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const video = await videos.find(user, request.params.id);
      if (!video) return reply.code(404).send({ error: "Video import not found." });
      if (video.status !== "uploaded") return reply.code(409).send({ error: "Complete the upload before analysis.", code: "video.conflict" });
      if (options.durableWorkers) await options.durableWorkers.enqueueVideoAnalysis(user, video.id);
      else queueMicrotask(() => { void videos.analyze(user, video.id).catch((error: unknown) => request.log.error({ name: error instanceof Error ? error.name : "UnknownError" }, "Video analysis worker failed")); });
      return reply.code(202).send({ video });
    } catch (error) { return videoError(error, reply); }
  });

  app.get<{ Params: { id: string } }>("/api/v1/video-imports/:id", { schema: { params: videoIdSchema } }, async (request, reply) => {
    const auth = options.authService; const videos = options.videoService;
    if (!auth || !videos) return reply.code(503).send({ error: "Video authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { const video = await videos.find(user, request.params.id); return video ? { video } : reply.code(404).send({ error: "Video import not found." }); }
    catch (error) { return videoError(error, reply); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/video-imports/:id/calibrate", { schema: { params: videoIdSchema, body: { type: "object" } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService; const videos = options.videoService;
    if (!auth || !videos) return reply.code(503).send({ error: "Video authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { return { video: await videos.calibrate(user, request.params.id, request.body) }; }
    catch (error) { return videoError(error, reply); }
  });

  app.post<{ Params: { id: string } }>("/api/v1/video-imports/:id/compile", { schema: { params: videoIdSchema } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService; const videos = options.videoService;
    if (!auth || !videos) return reply.code(503).send({ error: "Video authoring is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { return reply.code(201).send({ video: await videos.compile(user, request.params.id) }); }
    catch (error) { return videoError(error, reply); }
  });

  app.post<{ Params: { id: string } }>("/api/v1/runs/:id/repair-proposals", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService; const repair = options.repairService; if (!auth || !repair) return reply.code(503).send({ error: "Workflow repair is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]); if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { return reply.code(201).send({ proposal: await repair.propose(user, request.params.id) }); } catch (error) { return repairError(error, reply); }
  });
  app.get<{ Params: { id: string } }>("/api/v1/repair-proposals/:id", { schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } } }, async (request, reply) => {
    const auth = options.authService; const repair = options.repairService; if (!auth || !repair) return reply.code(503).send({ error: "Workflow repair is not configured." }); const user = await auth.currentUser(request.cookies[sessionCookieName]); if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { const proposal = await repair.find(user, request.params.id); return proposal ? { proposal } : reply.code(404).send({ error: "Repair proposal not found." }); } catch (error) { return repairError(error, reply); }
  });
  app.get<{ Params: { id: string } }>("/api/v1/workflows/:id/repair-proposals", { schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } } }, async (request, reply) => {
    const auth = options.authService; const repair = options.repairService; if (!auth || !repair) return reply.code(503).send({ error: "Workflow repair is not configured." }); const user = await auth.currentUser(request.cookies[sessionCookieName]); if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { return { proposals: await repair.list(user, request.params.id) }; } catch (error) { return repairError(error, reply); }
  });
  app.post<{ Params: { id: string } }>("/api/v1/repair-proposals/:id/accept", { schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." }); if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." }); const auth = options.authService; const repair = options.repairService; if (!auth || !repair) return reply.code(503).send({ error: "Workflow repair is not configured." }); const user = await auth.currentUser(request.cookies[sessionCookieName]); if (!user) return reply.code(401).send({ error: "Authentication is required." }); try { return { proposal: await repair.accept(user, request.params.id) }; } catch (error) { return repairError(error, reply); }
  });
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>("/api/v1/repair-proposals/:id/reject", {
    schema: {
      params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } },
      body: { type: "object", additionalProperties: false, properties: { reason: { type: "string", maxLength: 500 } } },
    },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." }); const auth = options.authService; const repair = options.repairService; if (!auth || !repair) return reply.code(503).send({ error: "Workflow repair is not configured." }); const user = await auth.currentUser(request.cookies[sessionCookieName]); if (!user) return reply.code(401).send({ error: "Authentication is required." }); try { return { proposal: await repair.reject(user, request.params.id, request.body?.reason) }; } catch (error) { return repairError(error, reply); }
  });

  app.post<{ Body: { category?: unknown; includeRunHealth?: unknown; workflowId?: unknown; workflowVersion?: unknown } }>("/api/v1/support-reports", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        required: ["category"],
        additionalProperties: false,
        properties: { category: { type: "string", enum: [...supportReportCategories] }, includeRunHealth: { type: "boolean" }, workflowId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, workflowVersion: { type: "integer", minimum: 1, maximum: 1000000000 } },
      },
    },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const supportReports = options.supportReportStore;
    if (!auth || !supportReports) return reply.code(503).send({ error: "Support reporting is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    const category = request.body.category;
    if (typeof category !== "string" || !supportReportCategories.includes(category as SupportReportCategory)) return reply.code(400).send({ error: "Invalid support report category." });
    const wantsRunHealth = request.body.includeRunHealth === true;
    if (wantsRunHealth !== (typeof request.body.workflowId === "string" && typeof request.body.workflowVersion === "number")) return reply.code(400).send({ error: "Invalid diagnostic selection." });
    let diagnostic: SupportDiagnostic | undefined;
    if (wantsRunHealth) {
      const runReceipts = options.runReceiptStore;
      if (!runReceipts) return reply.code(503).send({ error: "Run diagnostics are not configured." });
      const health = summarizeRunHealth(await runReceipts.listLocalDemoReceipts(request.body.workflowId as string, user), request.body.workflowVersion as number);
      diagnostic = { workflowId: request.body.workflowId as string, workflowVersion: health.workflowVersion, sampleSize: health.sampleSize, completedRuns: health.completedRuns, pausedRuns: health.pausedRuns, successRate: health.successRate, pauseReasons: health.pauseReasons };
    }
    const report = await supportReports.submit(category as SupportReportCategory, user, diagnostic);
    return reply.code(201).send({ report });
  });

  app.post<{ Body: unknown }>("/api/v1/workflow-specs", {
    schema: { body: { type: "object" } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService;
    const workflows = options.canonicalWorkflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "WorkflowSpec service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return reply.code(201).send({ workflow: await workflows.createDraft(user, request.body) });
    } catch (error) {
      if (error instanceof CanonicalWorkflowAccessError) return reply.code(403).send({ error: error.message, code: "workflow.access_denied" });
      if (error instanceof CanonicalWorkflowInputError) return reply.code(400).send({ error: error.message, code: "workflow_spec.validation_failed", issues: error.issues });
      throw error;
    }
  });

  app.get("/api/v1/workflow-specs", async (request, reply) => {
    const auth = options.authService;
    const workflows = options.canonicalWorkflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "WorkflowSpec service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    return { workflows: await workflows.listWorkflows(user) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/workflow-specs/:id", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    const auth = options.authService;
    const workflows = options.canonicalWorkflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "WorkflowSpec service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const workflow = await workflows.findDraft(user, request.params.id);
      return workflow ? { workflow } : reply.code(404).send({ error: "WorkflowSpec draft not found." });
    } catch (error) {
      if (error instanceof CanonicalWorkflowInputError) return reply.code(500).send({ error: "Stored workflow data is invalid." });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/api/v1/workflow-specs/:id/versions", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    const auth = options.authService;
    const workflows = options.canonicalWorkflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "WorkflowSpec service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    const versions = await workflows.listVersions(user, request.params.id);
    return versions.length > 0 ? { versions } : reply.code(404).send({ error: "Workflow history not found." });
  });

  app.post<{ Params: { id: string }; Body: { expectedChecksum?: unknown; spec?: unknown } }>("/api/v1/workflow-specs/:id/save", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } }, body: { type: "object", required: ["expectedChecksum", "spec"], additionalProperties: false, properties: { expectedChecksum: { type: "string", pattern: "^[a-f0-9]{64}$" }, spec: { type: "object" } } } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService;
    const workflows = options.canonicalWorkflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "WorkflowSpec service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const result = await workflows.updateDraft(user, request.params.id, String(request.body.expectedChecksum), request.body.spec);
      if (result.status === "missing") return reply.code(404).send({ error: "Workflow draft not found." });
      if (result.status === "conflict") return reply.code(409).send({ error: "This draft changed in another session.", code: "workflow_spec.edit_conflict", workflow: result.draft });
      return { workflow: result.draft };
    } catch (error) {
      if (error instanceof CanonicalWorkflowAccessError) return reply.code(403).send({ error: error.message, code: "workflow.access_denied" });
      if (error instanceof CanonicalWorkflowInputError) return reply.code(400).send({ error: error.message, code: "workflow_spec.validation_failed", issues: error.issues });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/workflow-specs/:id/next-draft", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService;
    const workflows = options.canonicalWorkflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "WorkflowSpec service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const result = await workflows.createNextDraft(user, request.params.id);
      if (result.status === "missing") return reply.code(404).send({ error: "Published workflow not found." });
      return reply.code(result.status === "created" ? 201 : 200).send({ workflow: result.draft, created: result.status === "created" });
    } catch (error) {
      if (error instanceof CanonicalWorkflowAccessError) return reply.code(403).send({ error: error.message, code: "workflow.access_denied" });
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Body: { expectedChecksum?: unknown } }>("/api/v1/workflow-specs/:id/publish", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } }, body: { type: "object", required: ["expectedChecksum"], additionalProperties: false, properties: { expectedChecksum: { type: "string", pattern: "^[a-f0-9]{64}$" } } } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService;
    const workflows = options.canonicalWorkflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "WorkflowSpec service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const result = await workflows.publishDraft(user, request.params.id, String(request.body.expectedChecksum));
      if (result.status === "missing") return reply.code(404).send({ error: "Workflow draft not found." });
      if (result.status === "conflict") return reply.code(409).send({ error: "This draft changed before publication.", code: "workflow_spec.publish_conflict", workflow: result.draft });
      return { workflow: result.version };
    } catch (error) {
      if (error instanceof CanonicalWorkflowAccessError) return reply.code(403).send({ error: error.message, code: "workflow.access_denied" });
      if (error instanceof CanonicalWorkflowInputError) return reply.code(400).send({ error: error.message, code: "workflow_spec.publication_blocked", issues: error.issues });
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/workflow-specs/:id/test-preview", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } }, body: { type: "object" } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const workflows = options.canonicalWorkflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "WorkflowSpec service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const preview = await workflows.previewTest(user, request.params.id, request.body);
      return preview ? { preview } : reply.code(404).send({ error: "Workflow draft not found." });
    } catch (error) {
      if (error instanceof CanonicalWorkflowInputError) return reply.code(400).send({ error: error.message, code: "workflow_spec.test_input_invalid" });
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/webhooks/:id", {
    bodyLimit: 256_000,
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    schema: { body: { type: "object" } },
  }, async (request, reply) => {
    const webhooks = options.webhookService;
    if (!webhooks) return reply.code(503).send({ error: "Webhook execution is not configured." });
    try {
      const timestamp = request.headers["x-doonce-timestamp"];
      const signature = request.headers["x-doonce-signature"];
      const idempotencyKey = request.headers["idempotency-key"];
      const result = await webhooks.trigger(request.params.id, request.body, {
        ...(typeof timestamp === "string" ? { timestamp } : {}),
        ...(typeof signature === "string" ? { signature } : {}),
        ...(typeof idempotencyKey === "string" ? { idempotencyKey } : {}),
      });
      return reply.code(result.created ? 202 : 200).send(result);
    } catch (error) {
      return webhookError(error, reply);
    }
  });

  app.get<{ Querystring: { workflowId?: string } }>("/api/v1/webhook-endpoints", async (request, reply) => {
    const auth = options.authService;
    const webhooks = options.webhookService;
    if (!auth || !webhooks) return reply.code(503).send({ error: "Webhook execution is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return { endpoints: await webhooks.list(user, request.query.workflowId) };
    } catch (error) {
      return webhookError(error, reply);
    }
  });

  app.post<{ Body: unknown }>("/api/v1/webhook-endpoints", { schema: { body: { type: "object" } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const webhooks = options.webhookService;
    if (!auth || !webhooks) return reply.code(503).send({ error: "Webhook execution is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return reply.code(201).send({ endpoint: await webhooks.create(user, request.body) });
    } catch (error) {
      return webhookError(error, reply);
    }
  });

  app.get("/api/v1/queue/health", async (request, reply) => {
    const auth = options.authService;
    if (!auth || !options.jobQueue) return reply.code(503).send({ error: "Durable execution is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    if (user.role !== "owner") return reply.code(403).send({ error: "Only workspace owners can view queue health." });
    return { queues: await options.jobQueue.health() };
  });

  app.get("/api/v1/browser-session-profiles", async (request, reply) => {
    const auth = options.authService;
    const profiles = options.sessionProfileService;
    if (!auth || !profiles) return reply.code(503).send({ error: "Managed browser sessions are not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    return { profiles: await profiles.list(user) };
  });

  app.post<{ Body: unknown }>("/api/v1/browser-session-profiles", { schema: { body: { type: "object" } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const profiles = options.sessionProfileService;
    if (!auth || !profiles) return reply.code(503).send({ error: "Managed browser sessions are not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return reply.code(201).send({ profile: await profiles.create(user, request.body) });
    } catch (error) {
      return scheduleError(error, reply);
    }
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean } }>("/api/v1/browser-session-profiles/:id", { schema: { body: { type: "object", required: ["enabled"], additionalProperties: false, properties: { enabled: { type: "boolean" } } } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const profiles = options.sessionProfileService;
    if (!auth || !profiles) return reply.code(503).send({ error: "Managed browser sessions are not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return { profile: await profiles.setEnabled(user, request.params.id, request.body.enabled === true) };
    } catch (error) {
      return scheduleError(error, reply);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/v1/browser-session-profiles/:id", async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const profiles = options.sessionProfileService;
    if (!auth || !profiles) return reply.code(503).send({ error: "Managed browser sessions are not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      await profiles.remove(user, request.params.id);
      return reply.code(204).send();
    } catch (error) {
      return scheduleError(error, reply);
    }
  });

  app.post<{ Body: unknown }>("/api/v1/schedules/preview", { schema: { body: { type: "object" } } }, async (request, reply) => {
    const auth = options.authService;
    const schedules = options.scheduleService;
    if (!auth || !schedules) return reply.code(503).send({ error: "Workflow scheduling is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return { nextRuns: schedules.preview(request.body) };
    } catch (error) {
      return scheduleError(error, reply);
    }
  });

  app.get<{ Querystring: { workflowId?: string } }>("/api/v1/schedules", async (request, reply) => {
    const auth = options.authService;
    const schedules = options.scheduleService;
    if (!auth || !schedules) return reply.code(503).send({ error: "Workflow scheduling is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return { schedules: await schedules.list(user, request.query.workflowId) };
    } catch (error) {
      return scheduleError(error, reply);
    }
  });

  app.post<{ Body: unknown }>("/api/v1/schedules", { schema: { body: { type: "object" } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const schedules = options.scheduleService;
    if (!auth || !schedules) return reply.code(503).send({ error: "Workflow scheduling is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const schedule = await schedules.create(user, request.body);
      await options.durableWorkers?.registerScheduleExpansion(user);
      return reply.code(201).send({ schedule });
    } catch (error) {
      return scheduleError(error, reply);
    }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/v1/schedules/:id", { schema: { body: { type: "object" } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const schedules = options.scheduleService;
    if (!auth || !schedules) return reply.code(503).send({ error: "Workflow scheduling is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return { schedule: await schedules.update(user, request.params.id, request.body) };
    } catch (error) {
      return scheduleError(error, reply);
    }
  });

  app.post<{ Params: { id: string }; Body: { enabled?: boolean } }>("/api/v1/schedules/:id/enabled", { schema: { body: { type: "object", required: ["enabled"], additionalProperties: false, properties: { enabled: { type: "boolean" } } } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const schedules = options.scheduleService;
    if (!auth || !schedules) return reply.code(503).send({ error: "Workflow scheduling is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      return { schedule: await schedules.setEnabled(user, request.params.id, request.body.enabled === true) };
    } catch (error) {
      return scheduleError(error, reply);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/v1/schedules/:id", async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const schedules = options.scheduleService;
    if (!auth || !schedules) return reply.code(503).send({ error: "Workflow scheduling is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      await schedules.remove(user, request.params.id);
      return reply.code(204).send();
    } catch (error) {
      return scheduleError(error, reply);
    }
  });

  app.post<{ Body: unknown }>("/api/v1/runs", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { body: { type: "object" } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const runs = options.runService;
    if (!auth || !runs) return reply.code(503).send({ error: "Workflow execution is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const created = await runs.create(user, request.body);
      return reply.code(created.created ? 201 : 200).send(created);
    } catch (error) {
      if (error instanceof RunAccessError) return reply.code(403).send({ error: error.message, code: "run.access_denied" });
      if (error instanceof RunConflictError) return reply.code(409).send({ error: error.message, code: "run.idempotency_conflict" });
      if (error instanceof RunInputError) return reply.code(400).send({ error: error.message, code: "run.invalid_request" });
      throw error;
    }
  });

  app.get("/api/v1/runs", async (request, reply) => {
    const auth = options.authService; const runs = options.runService;
    if (!auth || !runs) return reply.code(503).send({ error: "Workflow execution is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    return { runs: await runs.list(user) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/runs/:id", async (request, reply) => {
    const auth = options.authService; const runs = options.runService;
    if (!auth || !runs) return reply.code(503).send({ error: "Workflow execution is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { const run = await runs.find(user, request.params.id); return run ? { run } : reply.code(404).send({ error: "Run not found." }); }
    catch (error) { if (error instanceof RunInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.get<{ Params: { id: string } }>("/api/v1/runs/:id/timeline", async (request, reply) => {
    const auth = options.authService; const runs = options.runService;
    if (!auth || !runs) return reply.code(503).send({ error: "Workflow execution is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { const timeline = await runs.timeline(user, request.params.id); return timeline ? { timeline } : reply.code(404).send({ error: "Run not found." }); }
    catch (error) { if (error instanceof RunInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.post<{ Params: { id: string } }>("/api/v1/runs/:id/cancel", async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService; const runs = options.runService;
    if (!auth || !runs) return reply.code(503).send({ error: "Workflow execution is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { const run = await runs.cancel(user, request.params.id); return run ? { run } : reply.code(404).send({ error: "Run not found." }); }
    catch (error) { if (error instanceof RunAccessError) return reply.code(403).send({ error: error.message }); if (error instanceof RunInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/runs/:id/artifacts", { bodyLimit: 7_000_000, config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { body: { type: "object" } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins) && !isExtensionOrigin(request.headers.origin ?? "")) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService; const artifacts = options.artifactService;
    if (!auth || !artifacts) return reply.code(503).send({ error: "Artifact storage is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]) ?? (options.captureService ? await options.captureService.authenticateExtension(request.headers.authorization) : undefined);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const artifact = await artifacts.create(user, request.params.id, request.body);
      await options.durableWorkers?.registerArtifactCleanup(user);
      return reply.code(201).send({ artifact });
    }
    catch (error) { if (error instanceof ArtifactInputError) return reply.code(400).send({ error: error.message, code: "artifact.invalid" }); throw error; }
  });

  app.get<{ Params: { id: string } }>("/api/v1/runs/:id/artifacts", async (request, reply) => {
    const auth = options.authService; const artifacts = options.artifactService;
    if (!auth || !artifacts) return reply.code(503).send({ error: "Artifact storage is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { return { artifacts: await artifacts.list(user, request.params.id) }; }
    catch (error) { if (error instanceof ArtifactInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.post<{ Params: { id: string }; Body: { lifetimeSeconds?: unknown } }>("/api/v1/artifacts/:id/download-link", { schema: { body: { type: "object", additionalProperties: false, properties: { lifetimeSeconds: { type: "integer", minimum: 30, maximum: 3600 } } } } }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService; const artifacts = options.artifactService;
    if (!auth || !artifacts) return reply.code(503).send({ error: "Artifact storage is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try { const grant = await artifacts.createDownloadGrant(user, request.params.id, typeof request.body.lifetimeSeconds === "number" ? request.body.lifetimeSeconds : undefined); return { ...grant, url: `/api/v1/artifact-downloads/${grant.token}` }; }
    catch (error) { if (error instanceof ArtifactNotFoundError) return reply.code(404).send({ error: error.message }); if (error instanceof ArtifactInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.get<{ Params: { token: string } }>("/api/v1/artifact-downloads/:token", async (request, reply) => {
    const artifacts = options.artifactService;
    if (!artifacts) return reply.code(503).send({ error: "Artifact storage is not configured." });
    try {
      const download = await artifacts.download(request.params.token);
      reply.header("content-type", download.artifact.contentType).header("content-length", download.artifact.byteSize).header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(download.artifact.fileName)}`);
      return reply.send(Buffer.from(download.bytes));
    } catch (error) { if (error instanceof ArtifactInputError || error instanceof ArtifactNotFoundError) return reply.code(404).send({ error: "Artifact link is invalid or expired." }); throw error; }
  });

  app.post<{ Body: unknown }>("/api/v1/extension/runs/claim", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } }, schema: { body: { type: "object" } } }, async (request, reply) => {
    const captures = options.captureService; const runs = options.runService;
    if (!captures || !runs) return reply.code(503).send({ error: "Extension execution is not configured." });
    const user = await captures.authenticateExtension(request.headers.authorization);
    if (!user) return reply.code(401).send({ error: "Extension authentication is required." });
    try { const lease = await runs.claim(user, request.body); return lease ? { lease } : reply.code(204).send(); }
    catch (error) { if (error instanceof RunInputError) return reply.code(400).send({ error: error.message, code: "run.extension_incompatible" }); throw error; }
  });

  app.post<{ Params: { id: string }; Body: { leaseToken?: unknown } }>("/api/v1/extension/runs/:id/heartbeat", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } }, schema: { body: { type: "object" } } }, async (request, reply) => {
    const user = options.captureService ? await options.captureService.authenticateExtension(request.headers.authorization) : undefined;
    if (!user || !options.runService) return reply.code(401).send({ error: "Extension authentication is required." });
    try { const run = await options.runService.heartbeat(user, request.params.id, request.body.leaseToken); return run ? { run } : reply.code(409).send({ error: "The run lease expired.", code: "run.lease_expired" }); }
    catch (error) { if (error instanceof RunInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/extension/runs/:id/checkpoint", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } }, schema: { body: { type: "object" } } }, async (request, reply) => {
    const user = options.captureService ? await options.captureService.authenticateExtension(request.headers.authorization) : undefined;
    if (!user || !options.runService) return reply.code(401).send({ error: "Extension authentication is required." });
    try { const run = await options.runService.checkpoint(user, request.params.id, request.body); return run ? { run } : reply.code(409).send({ error: "The run lease expired.", code: "run.lease_expired" }); }
    catch (error) { if (error instanceof RunInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/extension/runs/:id/result", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } }, schema: { body: { type: "object" } } }, async (request, reply) => {
    const user = options.captureService ? await options.captureService.authenticateExtension(request.headers.authorization) : undefined;
    if (!user || !options.runService) return reply.code(401).send({ error: "Extension authentication is required." });
    try { const run = await options.runService.finish(user, request.params.id, request.body); return run ? { run } : reply.code(409).send({ error: "The run lease expired.", code: "run.lease_expired" }); }
    catch (error) { if (error instanceof RunConflictError) return reply.code(409).send({ error: error.message, code: "run.result_conflict" }); if (error instanceof RunInputError) return reply.code(400).send({ error: error.message }); throw error; }
  });

  app.get("/api/v1/workflows", async (request, reply) => {
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    return { workflows: await workflows.listWorkflows(user) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/workflows/:id/audit-events", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        additionalProperties: false,
        properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } },
      },
    },
  }, async (request, reply) => {
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    return { events: await workflows.listAuditEvents(user, request.params.id) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/workflows/:id/audit-events/export", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    const events = await workflows.listAuditEvents(user, request.params.id);
    reply.header("cache-control", "no-store");
    reply.header("content-disposition", "attachment; filename=doonce-workflow-audit.json");
    return reply.type("application/json").send({ workflowId: request.params.id, events });
  });

  app.get<{ Params: { id: string } }>("/api/v1/workflows/:id", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    const workflow = await workflows.reviewDraft(user, request.params.id);
    if (!workflow) return reply.code(404).send({ error: "Workflow not found." });
    return { workflow };
  });

  app.get<{ Params: { id: string } }>("/api/v1/workflows/:id/run-receipts", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    const auth = options.authService;
    const runReceipts = options.runReceiptStore;
    if (!auth || !runReceipts) return reply.code(503).send({ error: "Run receipt history is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    return { receipts: (await runReceipts.listLocalDemoReceipts(request.params.id, user)).map(redactRunReceipt) };
  });

  app.get<{ Params: { id: string }; Querystring: { version?: string } }>("/api/v1/workflows/:id/run-health", {
    schema: {
      params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } },
      querystring: { type: "object", required: ["version"], additionalProperties: false, properties: { version: { type: "string", pattern: "^[1-9][0-9]{0,8}$" } } },
    },
  }, async (request, reply) => {
    const auth = options.authService;
    const runReceipts = options.runReceiptStore;
    if (!auth || !runReceipts) return reply.code(503).send({ error: "Run health reporting is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    const workflowVersion = Number(request.query.version);
    if (!Number.isSafeInteger(workflowVersion) || workflowVersion < 1) return reply.code(400).send({ error: "Invalid workflow version." });
    return { health: summarizeRunHealth(await runReceipts.listLocalDemoReceipts(request.params.id, user), workflowVersion) };
  });

  app.post<{ Params: { id: string }; Body: { sourceId?: unknown; outcome?: unknown; pauseReason?: unknown } }>("/api/v1/workflows/:id/test-receipts/import", {
    schema: {
      params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } },
      body: {
        type: "object",
        required: ["sourceId", "outcome"],
        additionalProperties: false,
        properties: { sourceId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, outcome: { type: "string", enum: ["completed", "paused"] }, pauseReason: { type: "string", enum: ["changed-page", "slow-network", "unknown"] } },
      },
    },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const workflows = options.workflowService;
    const runReceipts = options.runReceiptStore;
    if (!auth || !workflows || !runReceipts) return reply.code(503).send({ error: "Draft test verification is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    if (!canImportRunReceipts(user.role)) return reply.code(403).send({ error: "This role cannot confirm draft tests." });
    const { sourceId, outcome, pauseReason } = request.body;
    if (typeof sourceId !== "string" || outcome !== "completed" || pauseReason !== undefined) return reply.code(400).send({ error: "Only a completed local test receipt can unlock publication." });
    try {
      const receipt = await runReceipts.importDraftTestReceipt(request.params.id, { sourceId, outcome }, user);
      if (!receipt) return reply.code(404).send({ error: "Draft workflow not found or unsupported for local testing." });
      const workflow = await workflows.reviewDraft(user, request.params.id);
      if (!workflow) return reply.code(409).send({ error: "Draft test was recorded, but the draft is no longer available for publication." });
      return reply.code(201).send({ receipt: redactRunReceipt(receipt), workflow });
    } catch (error) {
      if (error instanceof ReceiptAlreadyImportedError) return reply.code(409).send({ error: "This receipt was already saved." });
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Body: { sourceId?: unknown; outcome?: unknown; pauseReason?: unknown } }>("/api/v1/workflows/:id/run-receipts/import", {
    schema: {
      params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } },
      body: {
        type: "object",
        required: ["sourceId", "outcome"],
        additionalProperties: false,
        properties: {
          sourceId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
          outcome: { type: "string", enum: ["completed", "paused"] },
          pauseReason: { type: "string", enum: ["changed-page", "slow-network", "unknown"] },
        },
      },
    },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const runReceipts = options.runReceiptStore;
    if (!auth || !runReceipts) return reply.code(503).send({ error: "Run receipt import is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    if (!canImportRunReceipts(user.role)) return reply.code(403).send({ error: "This role cannot save run receipts." });
    const { sourceId, outcome, pauseReason } = request.body;
    if (typeof sourceId !== "string" || (outcome !== "completed" && outcome !== "paused") || ((outcome === "paused") !== (typeof pauseReason === "string"))) return reply.code(400).send({ error: "Invalid run receipt import." });
    try {
      const receipt = await runReceipts.importLocalDemoReceipt(request.params.id, { sourceId, outcome, ...(typeof pauseReason === "string" ? { pauseReason } : {}) } satisfies LocalDemoReceiptImport, user);
      if (!receipt) return reply.code(404).send({ error: "Workflow not found." });
      return reply.code(201).send({ receipt: redactRunReceipt(receipt) });
    } catch (error) {
      if (error instanceof ReceiptAlreadyImportedError) return reply.code(409).send({ error: "This receipt was already saved." });
      throw error;
    }
  });

  app.post<{ Body: unknown }>("/api/v1/workflows", {
    schema: {
      body: {
        type: "object",
        required: ["title", "allowedDomains", "steps"],
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 120 },
          allowedDomains: { type: "array", minItems: 1, items: { type: "string", maxLength: 253 } },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: {
              type: "object",
              required: ["id", "kind", "name", "expectedOutcome", "domain", "path"],
              additionalProperties: false,
              properties: {
                id: { type: "string", maxLength: 36 },
                kind: { type: "string", maxLength: 32 },
                name: { type: "string", maxLength: 120 },
                expectedOutcome: { type: "string", maxLength: 240 },
                domain: { type: "string", maxLength: 253 },
                path: { type: "string", maxLength: 2048 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const draft = await workflows.createDraft(user, request.body);
      return reply.code(201).send({ workflow: draft });
    } catch (error) {
      if (error instanceof WorkflowAccessError) return reply.code(403).send({ error: "This role cannot create workflows." });
      if (error instanceof WorkflowInputError) return reply.code(400).send({ error: error.message, code: "workflow.validation_failed" });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/workflows/:id/publish", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        additionalProperties: false,
        properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } },
      },
    },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const workflow = await workflows.publishDraft(user, request.params.id);
      if (!workflow) return reply.code(404).send({ error: "Workflow not found." });
      return { workflow };
    } catch (error) {
      if (error instanceof WorkflowAccessError) return reply.code(403).send({ error: "This role cannot publish workflows." });
      if (error instanceof WorkflowInputError) return reply.code(400).send({ error: error.message, code: "workflow.publication_blocked" });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/workflows/:id/disable", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const version = await workflows.disableActive(user, request.params.id);
      if (!version) return reply.code(404).send({ error: "Active workflow not found." });
      return { workflowId: request.params.id, disabledVersion: version };
    } catch (error) {
      if (error instanceof WorkflowAccessError) return reply.code(403).send({ error: "Only an owner can disable workflows." });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/workflows/:id/repair-draft", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const workflow = await workflows.createRepairDraft(user, request.params.id);
      if (!workflow) return reply.code(404).send({ error: "Published workflow not found." });
      return reply.code(201).send({ workflow, repair: "reconfirm-step" });
    } catch (error) {
      if (error instanceof WorkflowAccessError) return reply.code(403).send({ error: "This role cannot repair workflows." });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/workflows/:id/preview", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    if (!operationalControls.workflowChangesEnabled) return reply.code(503).send({ error: "Workflow changes are temporarily disabled." });
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const workflow = await workflows.previewDraft(user, request.params.id);
      if (!workflow) return reply.code(404).send({ error: "Workflow not found." });
      return { workflow, preview: "capabilities-passed" };
    } catch (error) {
      if (error instanceof WorkflowAccessError) return reply.code(403).send({ error: "This role cannot record capability previews." });
      if (error instanceof WorkflowInputError) return reply.code(400).send({ error: error.message, code: "workflow.capability_check_failed" });
      throw error;
    }
  });

  return app;
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  };
}

function setSessionCookie(reply: { setCookie(name: string, value: string, options: ReturnType<typeof sessionCookieOptions>): unknown }, token: string): void {
  reply.setCookie(sessionCookieName, token, sessionCookieOptions());
}

function hasAllowedOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  return typeof origin === "string" && allowedOrigins.includes(origin);
}

function isExtensionOrigin(origin: string): boolean {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}

function redactRunReceipt(receipt: RunReceipt) {
  return {
    id: receipt.id,
    workflowVersion: receipt.workflowVersion,
    outcome: receipt.outcome,
    ...(receipt.pauseReason ? { pauseReason: receipt.pauseReason } : {}),
    stepOutcomes: receipt.stepOutcomes,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt,
  };
}

function canImportRunReceipts(role: "owner" | "builder" | "runner" | "reviewer"): boolean {
  return role === "owner" || role === "builder" || role === "runner";
}
