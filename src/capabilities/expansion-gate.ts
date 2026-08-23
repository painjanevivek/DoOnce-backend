const capabilityKinds = ["action", "site-pattern", "executor", "provider", "connector"] as const;
type CapabilityKind = (typeof capabilityKinds)[number];

export interface ExpansionProposal {
  schemaVersion: 1;
  proposalId: string;
  capability: { kind: CapabilityKind; name: string };
  demand: { evidenceReference: string; workflowIds: string[]; affectedUsers: number; repeatedRuns: number; failureCodes: string[] };
  representation: { workflowSpecReference: string; compatibilityReference: string; unsupportedBoundaryReference: string };
  verification: {
    successCriteriaReference: string;
    failureBehaviorReference: string;
    unitTestReference: string;
    contractTestReference: string;
    integrationTestReference: string;
    browserTestReference: string;
    endToEndTestReference: string;
    modelEvaluationReference?: string;
  };
  authorization: { securityReviewReference: string; privacyReviewReference: string; objectPolicyReference: string };
  operations: { owner: string; costModelReference: string; metricsReference: string; alertReference: string; incidentRunbookReference: string };
  migration: { strategy: "no-change" | "additive" | "explicit-migration" | "major-version"; migrationReference: string; rollbackReference: string; earliestRuntimeVersion: string };
  decision: { outcome: "approved" | "rejected" | "needs-evidence"; reviewers: string[]; decidedAt?: string; decisionReference?: string };
}

export interface ExpansionGateResult { approved: boolean; issues: string[] }

export function evaluateExpansionProposal(input: unknown): ExpansionGateResult {
  const issues: string[] = [];
  if (!isRecord(input) || input.schemaVersion !== 1) return { approved: false, issues: ["proposal.invalid-schema"] };
  if (!isId(input.proposalId)) issues.push("proposal.invalid-id");
  const capability = input.capability;
  if (!isRecord(capability) || !capabilityKinds.includes(capability.kind as CapabilityKind) || !isName(capability.name)) issues.push("proposal.invalid-capability");

  const demand = input.demand;
  if (!isRecord(demand) || !isReference(demand.evidenceReference) || !isUuidArray(demand.workflowIds) || !isPositiveInteger(demand.affectedUsers) || !isPositiveInteger(demand.repeatedRuns) || !isFailureCodes(demand.failureCodes)) issues.push("proposal.demand-evidence-required");

  const representation = input.representation;
  if (!hasReferences(representation, ["workflowSpecReference", "compatibilityReference", "unsupportedBoundaryReference"])) issues.push("proposal.representation-required");

  const verification = input.verification;
  const verificationReferences = ["successCriteriaReference", "failureBehaviorReference", "unitTestReference", "contractTestReference", "integrationTestReference", "browserTestReference", "endToEndTestReference"];
  if (!hasReferences(verification, verificationReferences)) issues.push("proposal.verification-required");
  if (isRecord(capability) && capability.kind === "provider" && (!isRecord(verification) || !isReference(verification.modelEvaluationReference))) issues.push("proposal.model-evaluation-required");

  const authorization = input.authorization;
  if (!hasReferences(authorization, ["securityReviewReference", "privacyReviewReference", "objectPolicyReference"])) issues.push("proposal.authorization-required");

  const operations = input.operations;
  if (!isRecord(operations) || !isOwner(operations.owner) || !hasReferences(operations, ["costModelReference", "metricsReference", "alertReference", "incidentRunbookReference"])) issues.push("proposal.operations-ownership-required");

  const migration = input.migration;
  if (!isRecord(migration) || !["no-change", "additive", "explicit-migration", "major-version"].includes(String(migration.strategy)) || !hasReferences(migration, ["migrationReference", "rollbackReference"]) || !isSemver(migration.earliestRuntimeVersion)) issues.push("proposal.migration-and-rollback-required");

  const decision = input.decision;
  if (!isRecord(decision) || !["approved", "rejected", "needs-evidence"].includes(String(decision.outcome))) {
    issues.push("proposal.invalid-decision");
  } else if (decision.outcome !== "approved") {
    issues.push(`proposal.decision-${String(decision.outcome)}`);
  } else {
    if (!Array.isArray(decision.reviewers) || new Set(decision.reviewers).size < 2 || !decision.reviewers.every(isOwner)) issues.push("proposal.two-reviewers-required");
    if (!isIsoDate(decision.decidedAt) || !isReference(decision.decisionReference)) issues.push("proposal.decision-evidence-required");
  }
  return { approved: issues.length === 0, issues };
}

function hasReferences(value: unknown, keys: string[]): boolean { return isRecord(value) && keys.every((key) => isReference(value[key])); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9-]{2,79}$/.test(value); }
function isName(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{1,79}$/.test(value); }
function isReference(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/.test(value) && !/(?:^|[-_/])(tbd|todo|placeholder)(?:$|[-_./])/i.test(value); }
function isOwner(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._@-]{1,79}$/.test(value); }
function isPositiveInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0; }
function isUuidArray(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.length <= 100 && new Set(value).size === value.length && value.every((item) => typeof item === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(item)); }
function isFailureCodes(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.length <= 30 && new Set(value).size === value.length && value.every((item) => typeof item === "string" && /^[a-z][a-z0-9.-]{2,79}$/.test(item)); }
function isSemver(value: unknown): value is string { return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
