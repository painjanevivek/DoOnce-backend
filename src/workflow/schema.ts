import {
  executableActionKinds,
  type ExecutableActionKind,
} from "../policy/action-policy.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export interface WorkflowStep {
  id: string;
  kind: ExecutableActionKind;
  name: string;
  expectedOutcome: string;
  domain: string;
  path: string;
}

export interface WorkflowDraft {
  id: string;
  version: number;
  tenantId: string;
  ownerId: string;
  title: string;
  policyPreviewedAt?: string;
  allowedDomains: string[];
  steps: WorkflowStep[];
}

export type WorkflowValidationResult =
  | { ok: true; value: WorkflowDraft }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("..");
}

function isValidDomain(value: unknown): value is string {
  return typeof value === "string" && domainPattern.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isNonEmptyString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

export function validateWorkflowDraft(input: unknown): WorkflowValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["Workflow must be an object."] };
  }

  const errors: string[] = [];
  if (!isUuid(input.id)) errors.push("Workflow id must be a UUID.");
  if (!Number.isInteger(input.version) || (input.version as number) < 1) errors.push("Workflow version must be a positive integer.");
  if (!isUuid(input.tenantId)) errors.push("Workflow tenantId must be a UUID.");
  if (!isUuid(input.ownerId)) errors.push("Workflow ownerId must be a UUID.");
  if (!isNonEmptyString(input.title, 120)) errors.push("Workflow title is required and must be at most 120 characters.");
  if (input.policyPreviewedAt !== undefined && (typeof input.policyPreviewedAt !== "string" || Number.isNaN(Date.parse(input.policyPreviewedAt)))) errors.push("Workflow policy preview timestamp must be valid.");

  const allowedDomains = input.allowedDomains;
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0 || allowedDomains.some((domain) => !isValidDomain(domain))) {
    errors.push("Workflow must contain one or more valid allowed domains.");
  }

  const steps = input.steps;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 100) {
    errors.push("Workflow must contain between 1 and 100 steps.");
  } else {
    steps.forEach((step, index) => validateStep(step, index, allowedDomains, errors));
  }

  if (errors.length > 0) return { ok: false, errors };
  // The checks above establish the runtime boundary before this typed handoff.
  return { ok: true, value: input as unknown as WorkflowDraft };
}

function validateStep(step: unknown, index: number, allowedDomains: unknown, errors: string[]): void {
  if (!isRecord(step)) {
    errors.push(`Step ${index + 1} must be an object.`);
    return;
  }
  if (!isUuid(step.id)) errors.push(`Step ${index + 1} id must be a UUID.`);
  if (!executableActionKinds.includes(step.kind as ExecutableActionKind)) errors.push(`Step ${index + 1} has an unsupported action kind.`);
  if (!isNonEmptyString(step.name, 120)) errors.push(`Step ${index + 1} needs a readable name.`);
  if (!isNonEmptyString(step.expectedOutcome, 240)) errors.push(`Step ${index + 1} needs an expected outcome.`);
  if (!isValidDomain(step.domain) || !Array.isArray(allowedDomains) || !allowedDomains.includes(step.domain)) {
    errors.push(`Step ${index + 1} domain must be in the workflow allowlist.`);
  }
  if (!isValidPath(step.path)) errors.push(`Step ${index + 1} path must be a safe relative path.`);
}
