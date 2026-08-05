import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import { AuthInputError, AuthService, EmailAlreadyRegisteredError } from "./auth/auth-service.js";
import {
  evaluateActionPolicy,
  isActionKind,
  isSensitiveFieldKind,
  type ActionKind,
  type SensitiveFieldKind,
} from "./policy/action-policy.js";

const defaultAllowedOrigins = ["http://localhost:3000"];

function allowedOriginsFromEnvironment(): string[] {
  const configured = process.env.DOONCE_ALLOWED_ORIGINS;
  if (!configured) return defaultAllowedOrigins;
  return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export interface ServerOptions {
  authService?: AuthService;
}

const sessionCookieName = "doonce_session";

export function buildServer(options: ServerOptions = {}) {
  const allowedOrigins = allowedOriginsFromEnvironment();
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

  void app.register(helmet, {
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
  void app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed."), false);
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["content-type"],
  });
  void app.register(cookie);

  app.get("/health", async () => ({ status: "ok", service: "doonce-api" }));

  app.get("/api/v1/system/safety", async () => ({
    public: true,
    message: "This endpoint describes policy only. It cannot execute or store workflows.",
    blocked: ["submit", "delete", "payment", "credential", "otp"],
    paused: ["unknown"],
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
