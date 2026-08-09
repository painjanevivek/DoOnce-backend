import assert from "node:assert/strict";
import test from "node:test";
import { MetricsRegistry, operationalMetrics } from "../src/observability/metrics.js";
import type { JobQueue } from "../src/queue/job-queue.js";
import { buildServer } from "../src/server.js";

test("renders bounded counters, gauges, and cumulative duration buckets", () => {
  const metrics = new MetricsRegistry();
  metrics.increment("doonce_test_total", { outcome: "ok" }, 2);
  metrics.set("doonce_test_depth", { queue: "runs" }, 3);
  metrics.observe("doonce_test_duration_seconds", { operation: "load" }, 0.08);
  const output = metrics.prometheus();
  assert.match(output, /doonce_test_total\{outcome="ok"\} 2/);
  assert.match(output, /doonce_test_depth\{queue="runs"\} 3/);
  assert.match(output, /doonce_test_duration_seconds_bucket\{operation="load",le="0.1"\} 1/);
  assert.match(output, /doonce_test_duration_seconds_count\{operation="load"\} 1/);
});

test("keeps metrics private, reports queue age, and fails readiness closed", { concurrency: false }, async () => {
  const previous = process.env.METRICS_BEARER_TOKEN;
  process.env.METRICS_BEARER_TOKEN = "metrics-secret-with-enough-entropy";
  operationalMetrics.reset();
  const queue = { async health() { return [{ name: "workflow-runs" as const, queued: 4, ready: 3, active: 1, failed: 0, deferred: 0, total: 4, oldestJobAgeSeconds: 42 }]; } };
  const app = await buildServer({ jobQueue: queue as unknown as JobQueue, readinessCheck: async () => { throw new Error("database unavailable"); } });
  try {
    assert.equal((await app.inject({ method: "GET", url: "/internal/metrics" })).statusCode, 401);
    const metrics = await app.inject({ method: "GET", url: "/internal/metrics", headers: { authorization: "Bearer metrics-secret-with-enough-entropy" } });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.body, /doonce_queue_jobs\{queue="workflow-runs",state="queued"\} 4/);
    assert.match(metrics.body, /doonce_queue_oldest_job_age_seconds\{queue="workflow-runs"\} 42/);
    assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 503);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.METRICS_BEARER_TOKEN; else process.env.METRICS_BEARER_TOKEN = previous;
    operationalMetrics.reset();
  }
});
