import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { AuthoringJob } from "../src/authoring/authoring-service.js";
import { PostgresAuthoringJobStore } from "../src/authoring/postgres-authoring-job-store.js";

const user: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };
const job: AuthoringJob = { id: "33333333-3333-4333-8333-333333333333", status: "queued", request: { taskDescription: "Download the weekly report as CSV.", startingUrl: "https://example.test/reports", availableInputs: [], executorCapabilities: { schemaVersion: 1, executor: "extension", actions: ["navigate", "wait", "read", "select", "type", "download", "compare", "branch", "ask-approval", "stop"], maxSteps: 500, supportsDownloads: true }, workflowSchemaVersion: 1 }, provider: "doonce", model: "template-rules-v1", promptVersion: "text-workflow-v1.0.0", progress: { phase: "queued", message: "Waiting to start." }, attempts: 0, validationRetries: 0, usage: { promptTokens: 0, completionTokens: 0, estimatedCostMicrousd: 0 }, latencyMs: 0, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z" };

test("queues authoring under tenant context after checking workspace quotas", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresAuthoringJobStore(poolWithQuery(async (sql, values) => {
    queries.push({ sql, values });
    if (sql.startsWith("SELECT enabled")) return { rows: [{ enabled: true, daily_job_limit: 20, daily_token_limit: 200000 }] };
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ jobs: 0, tokens: 0 }] };
    if (sql.startsWith("INSERT INTO authoring_jobs")) return { rows: [row()] };
    return { rows: [] };
  }));
  const result = await store.enqueue(user, job, "authoring:test-store", "a".repeat(64));
  assert.equal(result.created, true);
  assert.equal(result.job.id, job.id);
  assert.ok(queries.some(({ sql, values }) => sql.includes("set_config('app.tenant_id'") && values?.[0] === user.tenantId));
  assert.ok(queries.some(({ sql }) => sql.includes("date_trunc('day'") && sql.includes("AT TIME ZONE 'UTC'")));
  assert.ok(queries.some(({ sql }) => sql.startsWith("INSERT INTO authoring_job_events")));
});

test("returns an idempotent job before applying quota checks", async () => {
  const queries: string[] = [];
  const store = new PostgresAuthoringJobStore(poolWithQuery(async (sql) => {
    queries.push(sql);
    if (sql.startsWith("SELECT enabled")) return { rows: [{ enabled: true, daily_job_limit: 1, daily_token_limit: 1000 }] };
    if (sql.startsWith("SELECT * FROM authoring_jobs")) return { rows: [row()] };
    return { rows: [] };
  }));
  const result = await store.enqueue(user, job, "authoring:test-store", "a".repeat(64));
  assert.equal(result.created, false);
  assert.equal(result.requestDigest, "a".repeat(64));
  assert.equal(queries.some((sql) => sql.startsWith("SELECT count(*)")), false);
});

function row() { return { id: job.id, status: job.status, task_description: job.request.taskDescription, starting_url: job.request.startingUrl, available_inputs: [], observation_session_id: null, executor_capabilities: job.request.executorCapabilities, workflow_schema_version: 1, provider: job.provider, model: job.model, prompt_version: job.promptVersion, progress_phase: job.progress.phase, progress_message: job.progress.message, result: null, workflow_id: null, error_code: null, attempts: 0, validation_retries: 0, prompt_tokens: 0, completion_tokens: 0, estimated_cost_microusd: 0, latency_ms: 0, created_at: job.createdAt, updated_at: job.updatedAt, started_at: null, finished_at: null, request_digest: "a".repeat(64) }; }
function poolWithQuery(query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>): Pool { return { connect: async () => ({ query, release: () => undefined }) } as unknown as Pool; }
