import { operationalMetrics, type MetricsRegistry } from "./metrics.js";

const funnelEvents = new Set(["extension_paired", "capture_finalized", "draft_created", "draft_tested", "workflow_published", "verified_outcome"]);
const executors = new Set(["extension", "hosted-browser"]);
const triggers = new Set(["manual", "schedule", "webhook"]);
const outcomes = new Set(["completed", "paused", "failed", "cancelled"]);
const costTypes = new Set(["authoring_tokens", "hosted_browser_seconds", "artifact_bytes", "support_seconds"]);

export class ProductAnalytics {
  public constructor(private readonly metrics: MetricsRegistry = operationalMetrics) {}

  public record(event: unknown): void {
    if (!isRecord(event) || typeof event.name !== "string") throw new Error("Product analytics require a named event.");
    if (funnelEvents.has(event.name)) {
      requireExactKeys(event, ["name"]);
      this.metrics.increment("doonce_product_funnel_total", { event: event.name });
      return;
    }
    if (event.name === "run_started") {
      requireExactKeys(event, ["name", "executor", "trigger"]);
      if (!executors.has(String(event.executor)) || !triggers.has(String(event.trigger))) throw new Error("Run analytics dimensions are invalid.");
      this.metrics.increment("doonce_product_runs_started_total", { executor: String(event.executor), trigger: String(event.trigger) });
      return;
    }
    if (event.name === "run_outcome") {
      requireExactKeys(event, ["name", "executor", "outcome"]);
      if (!executors.has(String(event.executor)) || !outcomes.has(String(event.outcome))) throw new Error("Run outcome dimensions are invalid.");
      this.metrics.increment("doonce_product_run_outcomes_total", { executor: String(event.executor), outcome: String(event.outcome) });
      return;
    }
    if (event.name === "unit_cost") {
      requireExactKeys(event, ["name", "costType", "amount"]);
      if (!costTypes.has(String(event.costType)) || typeof event.amount !== "number" || !Number.isFinite(event.amount) || event.amount < 0) throw new Error("Unit-cost analytics are invalid.");
      this.metrics.increment("doonce_product_cost_units_total", { cost_type: String(event.costType) }, event.amount);
      return;
    }
    throw new Error("Product analytics event is not in the approved taxonomy.");
  }
}

export const productAnalytics = new ProductAnalytics();

function requireExactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) throw new Error("Product analytics cannot contain custom or sensitive dimensions.");
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
