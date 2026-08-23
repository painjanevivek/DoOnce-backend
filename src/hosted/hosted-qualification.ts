import type { WorkflowSpec } from "../contracts/protocol.js";
import { qualifyAttendedWedge, type WedgeQualification } from "../beta/wedge-policy.js";
import type { attendedWedgeCategories } from "../beta/beta-types.js";

type HostedPattern = (typeof attendedWedgeCategories)[number];

export interface HostedQualification {
  id: string;
  pattern: HostedPattern;
  workflowChecksum: string;
  allowedDomain: string;
  browserImageDigest: string;
  evidenceReference: string;
  qualifiedAt: string;
  expiresAt: string;
  controls: {
    isolation: "verified";
    egress: "verified";
    managedSession: "verified";
  };
}

export interface HostedQualificationPolicy {
  requireQualified(spec: WorkflowSpec, workflowChecksum: string, now?: Date): HostedQualification;
}

export class HostedQualificationError extends Error {}

export class HostedQualificationRegistry implements HostedQualificationPolicy {
  public constructor(private readonly entries: readonly HostedQualification[]) {}

  public requireQualified(spec: WorkflowSpec, workflowChecksum: string, now = new Date()): HostedQualification {
    const pattern = inferPattern(spec);
    const wedge = pattern ? qualifyAttendedWedge(pattern, spec) : undefined;
    const entry = pattern
      ? this.entries.find((candidate) => candidate.pattern === pattern
        && candidate.workflowChecksum === workflowChecksum
        && candidate.allowedDomain === spec.allowedDomains[0])
      : undefined;

    if (!entry || !wedge?.qualified) {
      throw new HostedQualificationError(qualificationMessage(wedge));
    }
    if (new Date(entry.expiresAt).getTime() <= now.getTime()) {
      throw new HostedQualificationError("Hosted qualification has expired; re-run the managed-browser evidence suite.");
    }
    return entry;
  }
}

export function parseHostedQualifications(value: string | undefined): HostedQualification[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new HostedQualificationError("HOSTED_QUALIFICATIONS_JSON must be valid JSON."); }
  if (!Array.isArray(parsed) || parsed.length > 50) throw new HostedQualificationError("Hosted qualifications must be an array of at most 50 entries.");
  return parsed.map((entry, index) => parseEntry(entry, index));
}

function parseEntry(value: unknown, index: number): HostedQualification {
  if (!isRecord(value)) throw new HostedQualificationError(`Hosted qualification ${index + 1} must be an object.`);
  const allowedKeys = new Set(["id", "pattern", "workflowChecksum", "allowedDomain", "browserImageDigest", "evidenceReference", "qualifiedAt", "expiresAt", "controls"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new HostedQualificationError(`Hosted qualification ${index + 1} contains an unknown field.`);
  if (!isIdentifier(value.id)) throw new HostedQualificationError(`Hosted qualification ${index + 1} has an invalid id.`);
  if (value.pattern !== "report-download" && value.pattern !== "table-extraction") throw new HostedQualificationError(`Hosted qualification ${index + 1} has an unsupported pattern.`);
  if (typeof value.workflowChecksum !== "string" || !/^[a-f0-9]{64}$/.test(value.workflowChecksum)) throw new HostedQualificationError(`Hosted qualification ${index + 1} requires a SHA-256 workflow checksum.`);
  if (!isExactDomain(value.allowedDomain)) throw new HostedQualificationError(`Hosted qualification ${index + 1} requires one exact DNS domain.`);
  if (typeof value.browserImageDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.browserImageDigest)) throw new HostedQualificationError(`Hosted qualification ${index + 1} requires a pinned browser image digest.`);
  if (typeof value.evidenceReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value.evidenceReference)) throw new HostedQualificationError(`Hosted qualification ${index + 1} has an invalid evidence reference.`);
  if (!isIsoDate(value.qualifiedAt) || !isIsoDate(value.expiresAt) || new Date(value.expiresAt).getTime() <= new Date(value.qualifiedAt).getTime()) throw new HostedQualificationError(`Hosted qualification ${index + 1} has an invalid validity window.`);
  if (!isRecord(value.controls) || value.controls.isolation !== "verified" || value.controls.egress !== "verified" || value.controls.managedSession !== "verified" || Object.keys(value.controls).length !== 3) {
    throw new HostedQualificationError(`Hosted qualification ${index + 1} requires verified isolation, egress, and managed-session controls.`);
  }
  return value as unknown as HostedQualification;
}

function inferPattern(spec: WorkflowSpec): HostedPattern | undefined {
  if (spec.steps.some((step) => step.action === "download")) return "report-download";
  if (spec.steps.some((step) => step.action === "read")) return "table-extraction";
  return undefined;
}

function qualificationMessage(wedge: WedgeQualification | undefined): string {
  if (wedge && wedge.issues.length > 0) return `Workflow is outside the qualified hosted wedge: ${wedge.issues.join(", ")}.`;
  return "This exact workflow version and domain have not passed hosted qualification.";
}

function isIdentifier(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value); }
function isExactDomain(value: unknown): value is string { return typeof value === "string" && value.length <= 253 && /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
