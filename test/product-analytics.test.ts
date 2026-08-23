import assert from "node:assert/strict";
import test from "node:test";
import { MetricsRegistry } from "../src/observability/metrics.js";
import { ProductAnalytics } from "../src/observability/product-analytics.js";

test("records the approved activation, reliability, and unit-cost taxonomy", () => {
  const metrics = new MetricsRegistry();
  const analytics = new ProductAnalytics(metrics);
  analytics.record({ name: "workflow_published" });
  analytics.record({ name: "run_started", executor: "hosted-browser", trigger: "schedule" });
  analytics.record({ name: "run_outcome", executor: "hosted-browser", outcome: "completed" });
  analytics.record({ name: "unit_cost", costType: "hosted_browser_seconds", amount: 12.5 });
  const output = metrics.prometheus();
  assert.match(output, /doonce_product_funnel_total\{event="workflow_published"\} 1/);
  assert.match(output, /doonce_product_runs_started_total\{executor="hosted-browser",trigger="schedule"\} 1/);
  assert.match(output, /doonce_product_cost_units_total\{cost_type="hosted_browser_seconds"\} 12.5/);
});

test("rejects URLs, custom labels, unknown events, and invalid amounts", () => {
  const metrics = new MetricsRegistry();
  const analytics = new ProductAnalytics(metrics);
  assert.throws(() => analytics.record({ name: "run_started", executor: "extension", trigger: "manual", url: "https://private.example/report?id=7" }), /sensitive dimensions/);
  assert.throws(() => analytics.record({ name: "customer_email", value: "person@example.test" }), /approved taxonomy/);
  assert.throws(() => analytics.record({ name: "unit_cost", costType: "hosted_browser_seconds", amount: -1 }), /invalid/);
  assert.doesNotMatch(metrics.prometheus(), /private\.example|person@example/);
});
