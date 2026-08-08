import { createHash } from "node:crypto";
import type { LocatorCandidate, LocatorSpec, WorkflowInputDefinition, WorkflowSpec, WorkflowStep as WorkflowSpecStep } from "../contracts/protocol.js";
import { validateWorkflowSpec } from "./workflow-spec.js";
import { validateWorkflowDraft, type WorkflowStep } from "./schema.js";

export type WorkflowMigrationResult =
  | { ok: true; value: WorkflowSpec; checksum: string }
  | { ok: false; errors: string[] };

export function migrateLegacyWorkflow(input: unknown): WorkflowMigrationResult {
  const legacy = validateWorkflowDraft(input);
  if (!legacy.ok) return legacy;
  const inputs: WorkflowInputDefinition[] = [];
  const steps = legacy.value.steps.map((step, index) => migrateStep(step, index, inputs));
  const spec: WorkflowSpec = {
    schemaVersion: 1,
    format: "doonce.workflow-spec.v1",
    title: legacy.value.title,
    allowedDomains: [...new Set(legacy.value.allowedDomains)],
    inputs,
    steps,
  };
  const validation = validateWorkflowSpec(spec);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return { ok: true, value: validation.value, checksum: checksumWorkflowSpec(validation.value) };
}

export function checksumWorkflowSpec(spec: WorkflowSpec): string {
  return createHash("sha256").update(stableJson(spec)).digest("hex");
}

function migrateStep(step: WorkflowStep, index: number, inputs: WorkflowInputDefinition[]): WorkflowSpecStep {
  const base = { id: step.id, name: step.name, expectedOutcome: step.expectedOutcome };
  const pageTarget = { domain: step.domain, path: step.path };
  const target = { ...pageTarget, locator: locatorFromLegacyStep(step) };
  if (step.kind === "navigate") return { ...base, action: "navigate", target: pageTarget };
  if (step.kind === "wait") return { ...base, action: "wait", target, timeoutMs: 5000 };
  if (step.kind === "read") return { ...base, action: "read", target, outputName: `step_${index + 1}_output` };
  if (step.kind === "select" || step.kind === "type") {
    const inputName = `${step.kind}_${index + 1}`;
    inputs.push({ name: inputName, label: step.name, kind: step.kind === "select" ? "select" : "text", required: true, ...(step.kind === "select" ? { options: ["Review required"] } : {}) });
    return step.kind === "select" ? { ...base, action: "select", target, inputName } : { ...base, action: "type", target, inputName };
  }
  if (step.kind === "download") return { ...base, action: "download", target };
  if (step.kind === "compare") return { ...base, action: "compare", target, operator: "contains", expected: step.expectedOutcome };
  if (step.kind === "ask-approval") return { ...base, action: "ask-approval", prompt: step.expectedOutcome };
  if (step.kind === "stop") return { ...base, action: "stop", reason: step.expectedOutcome };
  return { ...base, action: "ask-approval", prompt: `Review the legacy ${step.kind} action before rebuilding it.` };
}

function locatorFromLegacyStep(step: WorkflowStep): LocatorSpec {
  const selector = (step as unknown as { selector?: unknown }).selector;
  const candidate = selectorCandidate(selector) ?? { strategy: "text" as const, value: step.name.slice(0, 256), confidence: 0.5 };
  return { schemaVersion: 1, primary: candidate, fallbacks: [] };
}

function selectorCandidate(selector: unknown): LocatorCandidate | undefined {
  if (typeof selector !== "string") return undefined;
  const id = /^#([a-zA-Z][a-zA-Z0-9_-]{0,63})$/.exec(selector)?.[1];
  if (id) return { strategy: "id", value: id, confidence: 0.95 };
  const captureId = /^\[data-doonce-capture-id="([a-z0-9-]{1,64})"\]$/i.exec(selector)?.[1];
  return captureId ? { strategy: "capture-id", value: captureId, confidence: 1 } : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
