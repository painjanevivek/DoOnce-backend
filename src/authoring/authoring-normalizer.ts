import type { WorkflowSpec } from "../contracts/protocol.js";
import { validateProtocolContract, type ValidationIssue } from "../contracts/validation.js";

export type NormalizedAuthoringCandidate = { ok: true; workflow: WorkflowSpec } | { ok: false; issues: ValidationIssue[] };

export function normalizeAuthoringCandidate(candidate: unknown): NormalizedAuthoringCandidate {
  const normalized = normalizeStrings(structuredClone(candidate));
  const validation = validateProtocolContract<WorkflowSpec>("WorkflowSpec", normalized);
  return validation.ok ? { ok: true, workflow: validation.value } : { ok: false, issues: validation.errors };
}

function normalizeStrings(candidate: unknown): unknown {
  if (!isRecord(candidate)) return candidate;
  if (Array.isArray(candidate.allowedDomains)) candidate.allowedDomains = candidate.allowedDomains.map((domain) => typeof domain === "string" ? domain.trim().toLowerCase() : domain);
  if (typeof candidate.title === "string") candidate.title = candidate.title.trim();
  if (typeof candidate.description === "string") candidate.description = candidate.description.trim();
  if (Array.isArray(candidate.steps)) for (const step of candidate.steps) normalizeTarget(step);
  if (Array.isArray(candidate.successCriteria)) for (const assertion of candidate.successCriteria) normalizeTarget(assertion);
  return candidate;
}
function normalizeTarget(value: unknown): void { if (!isRecord(value)) return; if (isRecord(value.target) && typeof value.target.domain === "string") value.target.domain = value.target.domain.trim().toLowerCase(); if (Array.isArray(value.assertions)) for (const assertion of value.assertions) normalizeTarget(assertion); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
