const automatedGateIds = [
  "source-verification",
  "security-diff",
  "dependency-container-scan",
  "migration-rehearsal",
  "restore-drill",
  "rollback-rehearsal",
  "extension-release-candidate",
] as const;

const externalGateIds = [
  "extension-publisher-approval",
  "infrastructure-provider-selection",
  "legal-policy-approval",
  "support-incident-ownership",
  "pricing-package-evidence",
] as const;

type AutomatedGateId = (typeof automatedGateIds)[number];
type ExternalGateId = (typeof externalGateIds)[number];
type GateStatus = "passed" | "pending" | "failed";

export interface LaunchReadinessManifest {
  schemaVersion: 1;
  releaseId: string;
  backendCommit: string;
  frontendCommit: string;
  gates: Array<{
    id: AutomatedGateId | ExternalGateId;
    type: "automated" | "external";
    status: GateStatus;
    owner?: string;
    evidenceReference?: string;
    recordedAt?: string;
  }>;
}

export interface LaunchReadinessResult {
  ready: boolean;
  blockers: Array<{ gate: string; reason: string }>;
}

export function evaluateLaunchReadiness(input: unknown): LaunchReadinessResult {
  const blockers: LaunchReadinessResult["blockers"] = [];
  if (!isRecord(input) || input.schemaVersion !== 1 || !isReleaseId(input.releaseId) || !isCommit(input.backendCommit) || !isCommit(input.frontendCommit) || !Array.isArray(input.gates)) {
    return { ready: false, blockers: [{ gate: "manifest", reason: "Launch manifest structure or commit provenance is invalid." }] };
  }

  const expected = [
    ...automatedGateIds.map((id) => ({ id, type: "automated" as const })),
    ...externalGateIds.map((id) => ({ id, type: "external" as const })),
  ];
  for (const requirement of expected) {
    const matches = input.gates.filter((gate) => isRecord(gate) && gate.id === requirement.id);
    if (matches.length !== 1) {
      blockers.push({ gate: requirement.id, reason: matches.length === 0 ? "Required gate is missing." : "Gate is duplicated." });
      continue;
    }
    const gate = matches[0]!;
    if (gate.type !== requirement.type) blockers.push({ gate: requirement.id, reason: "Gate type does not match the release policy." });
    if (gate.status !== "passed") {
      blockers.push({ gate: requirement.id, reason: gate.status === "failed" ? "Gate failed." : "Gate is pending real evidence." });
      continue;
    }
    if (!isEvidenceReference(gate.evidenceReference) || !isIsoDate(gate.recordedAt)) blockers.push({ gate: requirement.id, reason: "A passing gate requires dated evidence." });
    if (requirement.type === "external" && !isOwner(gate.owner)) blockers.push({ gate: requirement.id, reason: "External approval requires an accountable owner." });
  }

  for (const gate of input.gates) {
    if (!isRecord(gate) || !expected.some((requirement) => requirement.id === gate.id)) blockers.push({ gate: "manifest", reason: "Unknown launch gate is not permitted." });
  }
  return { ready: blockers.length === 0, blockers };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isReleaseId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(value); }
function isCommit(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function isOwner(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._@-]{1,79}$/.test(value); }
function isEvidenceReference(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/.test(value); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
