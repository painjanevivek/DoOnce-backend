import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
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

export function buildServer() {
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

  void app.register(helmet, { global: true });
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

  return app;
}
