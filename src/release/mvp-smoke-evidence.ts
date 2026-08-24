import { createHash } from "node:crypto";

export const mvpSmokeCases = [
  { id: "lifecycle.clean-install", expectedOutcome: "completed" },
  { id: "lifecycle.extension-update", expectedOutcome: "completed" },
  { id: "lifecycle.uninstall-reinstall", expectedOutcome: "completed" },
  { id: "identity.invited-sign-up", expectedOutcome: "completed" },
  { id: "identity.sign-in-out", expectedOutcome: "completed" },
  { id: "identity.session-expiry", expectedOutcome: "rejected" },
  { id: "identity.pairing-recovery", expectedOutcome: "completed" },
  { id: "authorization.cross-tenant", expectedOutcome: "rejected" },
  { id: "authorization.cross-role", expectedOutcome: "rejected" },
  { id: "consent.grant-revoke", expectedOutcome: "completed" },
  { id: "capture.sensitive-fields", expectedOutcome: "rejected" },
  { id: "journey.record-to-receipt", expectedOutcome: "completed" },
  { id: "journey.draft-refresh-resume", expectedOutcome: "completed" },
  { id: "journey.disable-and-report", expectedOutcome: "completed" },
  { id: "download.declared-verification", expectedOutcome: "completed" },
  { id: "failure.changed-page", expectedOutcome: "paused" },
  { id: "failure.expired-site-login", expectedOutcome: "paused" },
  { id: "failure.missing-element", expectedOutcome: "paused" },
  { id: "failure.slow-network", expectedOutcome: "paused" },
  { id: "failure.unexpected-popup", expectedOutcome: "paused" },
  { id: "failure.tab-origin-change", expectedOutcome: "paused" },
  { id: "failure.api-interruption", expectedOutcome: "paused" },
  { id: "failure.extension-suspension", expectedOutcome: "paused" },
  { id: "failure.approval-expiry", expectedOutcome: "rejected" },
  { id: "failure.approval-replay", expectedOutcome: "rejected" },
  { id: "operations.alert-delivery", expectedOutcome: "completed" },
  { id: "operations.workflow-disable", expectedOutcome: "rejected" },
  { id: "operations.global-kill-switch", expectedOutcome: "rejected" },
  { id: "operations.deployment-rollback", expectedOutcome: "completed" },
  { id: "operations.database-restore", expectedOutcome: "completed" },
  { id: "accessibility.desktop", expectedOutcome: "completed" },
  { id: "accessibility.minimum-viewport", expectedOutcome: "completed" },
  { id: "accessibility.keyboard-focus-errors", expectedOutcome: "completed" },
  { id: "accessibility.reduced-motion", expectedOutcome: "completed" },
] as const;

type SmokeCaseId = (typeof mvpSmokeCases)[number]["id"];
type ObservedOutcome = "completed" | "paused" | "rejected";
type ResultStatus = "passed" | "pending" | "failed";
type FailureClass = "product-defect" | "environment" | "site-change" | "identity-session" | "network" | "extension-lifecycle" | "operator-error" | "evidence-missing" | "unclassified";

export interface MvpSmokeReleaseContext {
  releaseId: string;
  deploymentId: string;
  environment: string;
  backendCommit: string;
  frontendCommit: string;
  extensionId: string;
  extensionVersion: string;
  extensionPackageSha256: string;
  migrationSetSha256: string;
  workflowChecksum: string;
  chromeVersion: string;
}

export interface MvpSmokeManifest {
  schemaVersion: 1;
  format: "doonce.mvp-smoke-evidence.v1";
  release: MvpSmokeReleaseContext;
  results: Array<{
    id: SmokeCaseId;
    status: ResultStatus;
    contextSha256: string;
    observedOutcome?: ObservedOutcome;
    tester?: string;
    recordedAt?: string;
    evidenceReference?: string;
    failureClass?: FailureClass;
  }>;
}

export interface MvpSmokeEvaluation {
  ready: boolean;
  contextSha256?: string;
  blockers: Array<{ case: string; reason: string }>;
}

export function createPendingMvpSmokeManifest(input: unknown): MvpSmokeManifest {
  const release = parseMvpSmokeReleaseContext(input);
  if (!release) throw new Error("Smoke release context is invalid.");
  const contextSha256 = smokeContextSha256(release);
  return {
    schemaVersion: 1,
    format: "doonce.mvp-smoke-evidence.v1",
    release,
    results: mvpSmokeCases.map(({ id }) => ({ id, status: "pending", contextSha256 })),
  };
}

export function evaluateMvpSmokeManifest(input: unknown): MvpSmokeEvaluation {
  if (!isRecord(input) || !hasExactKeys(input, ["schemaVersion", "format", "release", "results"]) || input.schemaVersion !== 1 || input.format !== "doonce.mvp-smoke-evidence.v1" || !Array.isArray(input.results)) {
    return { ready: false, blockers: [{ case: "manifest", reason: "Smoke manifest structure is invalid." }] };
  }
  const release = parseMvpSmokeReleaseContext(input.release);
  if (!release) return { ready: false, blockers: [{ case: "manifest", reason: "Smoke release context is invalid." }] };
  const contextSha256 = smokeContextSha256(release);
  const blockers: MvpSmokeEvaluation["blockers"] = [];

  for (const definition of mvpSmokeCases) {
    const matches = input.results.filter((result) => isRecord(result) && result.id === definition.id);
    if (matches.length !== 1) {
      blockers.push({ case: definition.id, reason: matches.length === 0 ? "Required smoke case is missing." : "Smoke case is duplicated." });
      continue;
    }
    const result = matches[0]!;
    if (!hasOnlyKeys(result, ["id", "status", "contextSha256", "observedOutcome", "tester", "recordedAt", "evidenceReference", "failureClass"])) blockers.push({ case: definition.id, reason: "Smoke result contains an unknown field." });
    if (result.contextSha256 !== contextSha256) blockers.push({ case: definition.id, reason: "Result is not bound to this release context." });
    if (result.status === "pending") {
      blockers.push({ case: definition.id, reason: "Smoke case is pending deployed evidence." });
      continue;
    }
    if (result.status === "failed") {
      blockers.push({ case: definition.id, reason: isFailureClass(result.failureClass) ? `Smoke case failed (${result.failureClass}).` : "Failed smoke case requires a bounded failure class." });
      continue;
    }
    if (result.status !== "passed") {
      blockers.push({ case: definition.id, reason: "Smoke result status is invalid." });
      continue;
    }
    if (result.observedOutcome !== definition.expectedOutcome) blockers.push({ case: definition.id, reason: `Expected ${definition.expectedOutcome}, observed ${String(result.observedOutcome)}.` });
    if (!isTester(result.tester) || !isIsoDate(result.recordedAt) || !isEvidenceReference(result.evidenceReference)) blockers.push({ case: definition.id, reason: "Passing smoke evidence requires a tester, timestamp, and stable evidence reference." });
    if (result.failureClass !== undefined) blockers.push({ case: definition.id, reason: "Passing smoke evidence cannot retain a failure class." });
  }

  for (const result of input.results) {
    if (!isRecord(result) || !mvpSmokeCases.some(({ id }) => id === result.id)) blockers.push({ case: "manifest", reason: "Unknown smoke case is not permitted." });
  }
  return { ready: blockers.length === 0, contextSha256, blockers };
}

export function smokeContextSha256(context: MvpSmokeReleaseContext): string {
  const canonical = JSON.stringify({
    releaseId: context.releaseId,
    deploymentId: context.deploymentId,
    environment: context.environment,
    backendCommit: context.backendCommit,
    frontendCommit: context.frontendCommit,
    extensionId: context.extensionId,
    extensionVersion: context.extensionVersion,
    extensionPackageSha256: context.extensionPackageSha256,
    migrationSetSha256: context.migrationSetSha256,
    workflowChecksum: context.workflowChecksum,
    chromeVersion: context.chromeVersion,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function parseMvpSmokeReleaseContext(value: unknown): MvpSmokeReleaseContext | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["releaseId", "deploymentId", "environment", "backendCommit", "frontendCommit", "extensionId", "extensionVersion", "extensionPackageSha256", "migrationSetSha256", "workflowChecksum", "chromeVersion"])) return undefined;
  if (!isSlug(value.releaseId) || !isSlug(value.deploymentId) || !isSlug(value.environment)) return undefined;
  if (!isCommit(value.backendCommit) || !isCommit(value.frontendCommit) || !isSha256(value.extensionPackageSha256) || !isSha256(value.migrationSetSha256) || !isSha256(value.workflowChecksum)) return undefined;
  if (typeof value.extensionId !== "string" || !/^[a-p]{32}$/.test(value.extensionId)) return undefined;
  if (typeof value.extensionVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(value.extensionVersion)) return undefined;
  if (typeof value.chromeVersion !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(value.chromeVersion)) return undefined;
  return value as unknown as MvpSmokeReleaseContext;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys); }
function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function isSlug(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(value); }
function isCommit(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function isSha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isTester(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._@-]{1,79}$/.test(value); }
function isEvidenceReference(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/.test(value); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function isFailureClass(value: unknown): value is FailureClass { return ["product-defect", "environment", "site-change", "identity-session", "network", "extension-lifecycle", "operator-error", "evidence-missing", "unclassified"].includes(String(value)); }
