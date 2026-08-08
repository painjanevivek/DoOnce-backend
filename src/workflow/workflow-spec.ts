import { evaluateActionPolicy } from "../policy/action-policy.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const inputNamePattern = /^[a-z][a-z0-9_]{0,63}$/;
const idSelectorPattern = /^#[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const captureSelectorPattern = /^\[data-doonce-capture-id="[a-z0-9-]{1,64}"\]$/i;
const localDevelopmentDomains = new Set(["localhost", "127.0.0.1"]);

export const workflowSpecFormat = "doonce.workflow-spec.v1";
export const workflowSpecActionKinds = ["navigate", "wait", "read", "select", "type", "download", "compare", "ask-approval", "stop"] as const;
export const workflowSpecInputKinds = ["text", "date", "select"] as const;

export type WorkflowSpecActionKind = (typeof workflowSpecActionKinds)[number];
export type WorkflowSpecInputKind = (typeof workflowSpecInputKinds)[number];

export interface WorkflowSpecInput {
  name: string;
  label: string;
  kind: WorkflowSpecInputKind;
  required: boolean;
}

export interface WorkflowSpecTarget {
  domain: string;
  path: string;
  selector?: string;
}

export interface WorkflowSpecStep {
  id: string;
  action: WorkflowSpecActionKind;
  name: string;
  expectedOutcome: string;
  target: WorkflowSpecTarget;
  inputName?: string;
}

export interface WorkflowSpec {
  format: typeof workflowSpecFormat;
  title: string;
  allowedDomains: string[];
  inputs: WorkflowSpecInput[];
  steps: WorkflowSpecStep[];
}

export type WorkflowSpecValidationResult =
  | { ok: true; value: WorkflowSpec }
  | { ok: false; errors: string[] };

export function validateWorkflowSpec(input: unknown): WorkflowSpecValidationResult {
  if (!isRecord(input) || !hasOnlyKeys(input, ["format", "title", "allowedDomains", "inputs", "steps"])) {
    return { ok: false, errors: ["WorkflowSpec must be an object with only supported fields."] };
  }

  const errors: string[] = [];
  if (input.format !== workflowSpecFormat) errors.push("WorkflowSpec format must be doonce.workflow-spec.v1.");
  if (!isNonEmptyString(input.title, 120)) errors.push("WorkflowSpec title is required and must be at most 120 characters.");

  const allowedDomains = input.allowedDomains;
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0 || allowedDomains.length > 20 || allowedDomains.some((domain) => !isValidDomain(domain))) {
    errors.push("WorkflowSpec must contain one to twenty valid allowed domains.");
  }

  const inputs = input.inputs;
  const inputNames = new Set<string>();
  if (!Array.isArray(inputs) || inputs.length > 20) {
    errors.push("WorkflowSpec inputs must contain at most twenty fields.");
  } else {
    inputs.forEach((definition, index) => validateInput(definition, index, inputNames, errors));
  }

  const steps = input.steps;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 100) {
    errors.push("WorkflowSpec must contain between 1 and 100 steps.");
  } else {
    steps.forEach((step, index) => validateStep(step, index, allowedDomains, inputNames, errors));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as WorkflowSpec };
}

function validateInput(input: unknown, index: number, inputNames: Set<string>, errors: string[]): void {
  if (!isRecord(input) || !hasOnlyKeys(input, ["name", "label", "kind", "required"])) {
    errors.push(`Input ${index + 1} must contain only name, label, kind, and required.`);
    return;
  }
  if (typeof input.name !== "string" || !inputNamePattern.test(input.name) || inputNames.has(input.name)) {
    errors.push(`Input ${index + 1} needs a unique safe name.`);
  } else {
    inputNames.add(input.name);
  }
  if (!isNonEmptyString(input.label, 120)) errors.push(`Input ${index + 1} needs a readable label.`);
  if (!workflowSpecInputKinds.includes(input.kind as WorkflowSpecInputKind)) errors.push(`Input ${index + 1} has an unsupported kind.`);
  if (typeof input.required !== "boolean") errors.push(`Input ${index + 1} must state whether it is required.`);
}

function validateStep(step: unknown, index: number, allowedDomains: unknown, inputNames: Set<string>, errors: string[]): void {
  if (!isRecord(step) || !hasOnlyKeys(step, ["id", "action", "name", "expectedOutcome", "target", "inputName"])) {
    errors.push(`Step ${index + 1} must contain only supported fields.`);
    return;
  }
  if (!isUuid(step.id)) errors.push(`Step ${index + 1} id must be a UUID.`);
  if (!workflowSpecActionKinds.includes(step.action as WorkflowSpecActionKind)) errors.push(`Step ${index + 1} has an unsupported action kind.`);
  if (!isNonEmptyString(step.name, 120)) errors.push(`Step ${index + 1} needs a readable name.`);
  if (!isNonEmptyString(step.expectedOutcome, 240)) errors.push(`Step ${index + 1} needs an expected outcome.`);
  validateTarget(step.target, index, allowedDomains, step.action, errors);

  const usesInput = step.action === "type" || step.action === "select";
  if (usesInput && (typeof step.inputName !== "string" || !inputNames.has(step.inputName))) {
    errors.push(`Step ${index + 1} must reference a declared input instead of storing a value.`);
  }
  if (!usesInput && step.inputName !== undefined) errors.push(`Step ${index + 1} cannot include an input reference.`);

  if (workflowSpecActionKinds.includes(step.action as WorkflowSpecActionKind)) {
    const decision = evaluateActionPolicy({ action: step.action as WorkflowSpecActionKind });
    if (decision.verdict === "blocked") errors.push(`Step ${index + 1} is blocked by ${decision.ruleId}.`);
  }
}

function validateTarget(target: unknown, index: number, allowedDomains: unknown, action: unknown, errors: string[]): void {
  if (!isRecord(target) || !hasOnlyKeys(target, ["domain", "path", "selector"])) {
    errors.push(`Step ${index + 1} target must contain only domain, path, and selector.`);
    return;
  }
  if (!isValidDomain(target.domain) || !Array.isArray(allowedDomains) || !allowedDomains.includes(target.domain)) {
    errors.push(`Step ${index + 1} target domain must be in the workflow allowlist.`);
  }
  if (!isValidPath(target.path)) errors.push(`Step ${index + 1} target path must be a safe relative path.`);
  const needsSelector = ["read", "select", "type", "download", "compare"].includes(action as string);
  if (needsSelector && !isSafeSelector(target.selector)) errors.push(`Step ${index + 1} needs a stable safe selector.`);
  if (!needsSelector && target.selector !== undefined && !isSafeSelector(target.selector)) errors.push(`Step ${index + 1} selector must be a stable safe selector.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isValidPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 && value.startsWith("/") && !value.startsWith("//") && !value.includes("..");
}

function isValidDomain(value: unknown): value is string {
  return typeof value === "string" && (localDevelopmentDomains.has(value) || domainPattern.test(value));
}

function isSafeSelector(value: unknown): value is string {
  return typeof value === "string" && (idSelectorPattern.test(value) || captureSelectorPattern.test(value));
}

function isNonEmptyString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}
