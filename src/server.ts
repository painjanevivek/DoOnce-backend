import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError } from "fastify";
import { AuthInputError, AuthService, EmailAlreadyRegisteredError } from "./auth/auth-service.js";
import { WorkflowAccessError, WorkflowInputError, WorkflowService } from "./workflow/workflow-service.js";
import type { LocalDemoReceiptImport, LocalDemoReceiptStore } from "./runner/postgres-run-receipt-store.js";
import { operationalControlsFromEnvironment, type OperationalControls } from "./system/operational-controls.js";
import {
  evaluateActionPolicy,
  isActionKind,
  isSensitiveFieldKind,
  type ActionKind,
  type SensitiveFieldKind,
} from "./policy/action-policy.js";

const defaultAllowedOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

function allowedOriginsFromEnvironment(): string[] {
  const configured = process.env.DOONCE_ALLOWED_ORIGINS;
  if (!configured) return defaultAllowedOrigins;
  return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export interface ServerOptions {
  authService?: AuthService;
  workflowService?: WorkflowService;
  runReceiptStore?: LocalDemoReceiptStore;
  operationalControls?: OperationalControls;
}

const sessionCookieName = "doonce_session";

export async function buildServer(options: ServerOptions = {}) {
  const allowedOrigins = allowedOriginsFromEnvironment();
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
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed."), false);
    },
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["content-type"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false, max: 100, timeWindow: "1 minute" });
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

  app.get("/api/v1/system/safety", async () => ({
    public: true,
    message: "This endpoint describes policy only. It cannot execute or store workflows.",
    blocked: ["submit", "delete", "payment", "credential", "otp"],
    paused: ["unknown"],
    workflowChangesEnabled: operationalControls.workflowChangesEnabled,
    killSwitchActive: operationalControls.killSwitchActive,
  }));

  app.post<{ Body: { action?: unknown; fieldKind?: unknown } }>("/api/v1/policy/evaluate", {
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
  }, async (request, reply) => {
    const { action, fieldKind } = request.body;
    if (!isActionKind(action) || (fieldKind !== undefined && !isSensitiveFieldKind(fieldKind))) {
      return reply.code(400).send({ error: "Invalid policy evaluation input." });
    }
    return evaluateActionPolicy({
      action: action as ActionKind,
      ...(fieldKind === undefined ? {} : { fieldKind: fieldKind as SensitiveFieldKind }),
    });
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
    return { receipts: await runReceipts.listLocalDemoReceipts(request.params.id, user) };
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
          pauseReason: { type: "string", minLength: 1, maxLength: 160 },
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
    const { sourceId, outcome, pauseReason } = request.body;
    if (typeof sourceId !== "string" || (outcome !== "completed" && outcome !== "paused") || ((outcome === "paused") !== (typeof pauseReason === "string"))) return reply.code(400).send({ error: "Invalid run receipt import." });
    const receipt = await runReceipts.importLocalDemoReceipt(request.params.id, { sourceId, outcome, ...(typeof pauseReason === "string" ? { pauseReason } : {}) } satisfies LocalDemoReceiptImport, user);
    if (!receipt) return reply.code(404).send({ error: "Workflow not found." });
    return reply.code(201).send({ receipt });
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
      if (error instanceof WorkflowInputError) return reply.code(400).send({ error: "Workflow does not meet the safety requirements." });
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
      if (error instanceof WorkflowInputError) return reply.code(400).send({ error: "Workflow cannot be published under the current safety policy." });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/workflows/:id/preview", {
    schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    if (!hasAllowedOrigin(request.headers.origin, allowedOrigins)) return reply.code(403).send({ error: "Origin is not allowed." });
    const auth = options.authService;
    const workflows = options.workflowService;
    if (!auth || !workflows) return reply.code(503).send({ error: "Workflow service is not configured." });
    const user = await auth.currentUser(request.cookies[sessionCookieName]);
    if (!user) return reply.code(401).send({ error: "Authentication is required." });
    try {
      const workflow = await workflows.previewDraft(user, request.params.id);
      if (!workflow) return reply.code(404).send({ error: "Workflow not found." });
      return { workflow, preview: "policy-passed" };
    } catch (error) {
      if (error instanceof WorkflowInputError) return reply.code(400).send({ error: "Workflow cannot pass the current safety policy." });
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
