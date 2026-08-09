import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService, AuthenticatedUser } from "../auth/auth-service.js";
import { BetaAccessError, BetaConflictError, BetaInputError, BetaService } from "./beta-service.js";
import { betaEnrollmentStatuses, betaFailureCategories, betaObservationStages, betaTaskCategories } from "./beta-types.js";
import { operationalMetrics } from "../observability/metrics.js";

interface BetaRouteOptions {
  authService: AuthService | undefined;
  betaService: BetaService | undefined;
  sessionCookieName: string;
  mutationOriginAllowed(origin: string | undefined): boolean;
}

const idSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } },
} as const;

export async function registerBetaRoutes(app: FastifyInstance, options: BetaRouteOptions): Promise<void> {
  const currentUser = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedUser | undefined> => {
    if (!options.authService || !options.betaService) {
      reply.code(503).send({ error: "Controlled beta tracking is not configured.", code: "beta.unavailable" });
      return undefined;
    }
    const user = await options.authService.currentUser(request.cookies[options.sessionCookieName]);
    if (!user) reply.code(401).send({ error: "Authentication is required.", code: "auth.required" });
    return user;
  };

  app.get("/api/v1/beta/compatibility", async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    return { compatibility: options.betaService!.compatibility() };
  });

  app.get("/api/v1/beta/workflows", async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    try { return { workflows: await options.betaService!.list(user) }; } catch (error) { return betaError(error, reply); }
  });

  app.get("/api/v1/beta/summary", async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    try {
      const summary = await options.betaService!.summary(user);
      operationalMetrics.set("doonce_beta_workflows", { state: "enrolled" }, summary.enrolledWorkflows);
      operationalMetrics.set("doonce_beta_workflows", { state: "independent_ready" }, summary.workflowsReadyForIndependentUse);
      return { summary };
    } catch (error) { return betaError(error, reply); }
  });

  app.post<{ Body: unknown }>("/api/v1/beta/workflows", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        required: ["workflowId", "taskCategory", "baselineDurationMinutes", "baselineErrorRatePercent"],
        additionalProperties: false,
        properties: {
          workflowId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
          taskCategory: { type: "string", enum: [...betaTaskCategories] },
          baselineDurationMinutes: { type: "number", exclusiveMinimum: 0, maximum: 1440 },
          baselineErrorRatePercent: { type: "number", minimum: 0, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    if (!options.mutationOriginAllowed(request.headers.origin)) return reply.code(403).send({ error: "Origin is not allowed.", code: "origin.denied" });
    const user = await currentUser(request, reply);
    if (!user) return reply;
    try { return reply.code(201).send({ workflow: await options.betaService!.enroll(user, request.body) }); } catch (error) { return betaError(error, reply); }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/v1/beta/workflows/:id/status", {
    schema: {
      params: idSchema,
      body: { type: "object", required: ["status"], additionalProperties: false, properties: { status: { type: "string", enum: [...betaEnrollmentStatuses] } } },
    },
  }, async (request, reply) => {
    if (!options.mutationOriginAllowed(request.headers.origin)) return reply.code(403).send({ error: "Origin is not allowed.", code: "origin.denied" });
    const user = await currentUser(request, reply);
    if (!user) return reply;
    try { return { workflow: await options.betaService!.setStatus(user, request.params.id, request.body) }; } catch (error) { return betaError(error, reply); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/beta/workflows/:id/observations", {
    schema: {
      params: idSchema,
      body: {
        type: "object",
        required: ["runId", "stage", "developerIntervened"],
        additionalProperties: false,
        properties: {
          runId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
          stage: { type: "string", enum: [...betaObservationStages] },
          developerIntervened: { type: "boolean" },
        },
      },
    },
  }, async (request, reply) => {
    if (!options.mutationOriginAllowed(request.headers.origin)) return reply.code(403).send({ error: "Origin is not allowed.", code: "origin.denied" });
    const user = await currentUser(request, reply);
    if (!user) return reply;
    try {
      await options.betaService!.observeRun(user, request.params.id, request.body);
      operationalMetrics.increment("doonce_beta_observations_total", { stage: (request.body as { stage: string }).stage });
      return reply.code(201).send({ recorded: true });
    } catch (error) { return betaError(error, reply); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/beta/workflows/:id/failures", {
    schema: {
      params: idSchema,
      body: {
        type: "object",
        required: ["category"],
        additionalProperties: false,
        properties: {
          runId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
          category: { type: "string", enum: [...betaFailureCategories] },
          errorCode: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,119}$" },
        },
      },
    },
  }, async (request, reply) => {
    if (!options.mutationOriginAllowed(request.headers.origin)) return reply.code(403).send({ error: "Origin is not allowed.", code: "origin.denied" });
    const user = await currentUser(request, reply);
    if (!user) return reply;
    try {
      await options.betaService!.recordFailure(user, request.params.id, request.body);
      operationalMetrics.increment("doonce_beta_failures_total", { category: (request.body as { category: string }).category });
      return reply.code(201).send({ recorded: true });
    } catch (error) { return betaError(error, reply); }
  });
}

function betaError(error: unknown, reply: FastifyReply) {
  if (error instanceof BetaAccessError) return reply.code(403).send({ error: error.message, code: "beta.access_denied" });
  if (error instanceof BetaConflictError) return reply.code(409).send({ error: error.message, code: "beta.conflict" });
  if (error instanceof BetaInputError) return reply.code(422).send({ error: error.message, code: "beta.invalid_input" });
  throw error;
}
