import { smokeContextSha256, parseMvpSmokeReleaseContext, type MvpSmokeReleaseContext } from "./mvp-smoke-evidence.js";

const comprehensionChecks = [
  "authorizedDomainAndTask",
  "excludedData",
  "freshApproval",
  "safePause",
  "disableAndReport",
] as const;

type ParticipantStatus = "pending" | "passed" | "failed";
type PromotionDecisionStatus = "pending" | "go" | "no-go";
type ProductionStage = "first-production" | "repeat-production";

interface PromotionInput {
  release: MvpSmokeReleaseContext;
  charterSha256: string;
  minimumTimeSavedSeconds: number;
  pilotIds: [string, string, string];
}

interface ProductionRunEvidence {
  runId: string;
  stage: ProductionStage;
  contextSha256: string;
  verified: boolean;
  developerIntervened: boolean;
  sensitiveDataLeakage: boolean;
  activeDurationSeconds: number;
  elapsedDurationSeconds: number;
  supportDurationSeconds: number;
  approvalEvidenceReference: string;
  receiptEvidenceReference: string;
  recordedAt: string;
}

interface ParticipantEvidence {
  pilotId: string;
  status: ParticipantStatus;
  contextSha256: string;
  observer?: string;
  recordedAt?: string;
  consentEvidenceReference?: string;
  expectationEvidenceReference?: string;
  baselineDurationSeconds?: number;
  historicalErrorRatePercent?: number;
  productionRuns?: ProductionRunEvidence[];
  comprehension?: Record<(typeof comprehensionChecks)[number], boolean> & { evidenceReference: string };
  uncertaintyObservations?: Array<{
    id: string;
    outcome: "safely-paused" | "continued-unsafe";
    evidenceReference: string;
    recordedAt: string;
  }>;
  safePauseEvidenceReference?: string;
  leakageReviewReference?: string;
  failureReason?: string;
}

export interface MvpPromotionManifest {
  schemaVersion: 1;
  format: "doonce.mvp-promotion-evidence.v1";
  release: MvpSmokeReleaseContext;
  charterSha256: string;
  minimumTimeSavedSeconds: number;
  smokeGate: {
    status: "pending" | "passed" | "failed";
    contextSha256: string;
    evidenceReference?: string;
    recordedAt?: string;
  };
  participants: ParticipantEvidence[];
  decision: {
    status: PromotionDecisionStatus;
    owner?: string;
    recordedAt?: string;
    evidenceReference?: string;
    launchReadinessEvidenceReference?: string;
    capabilityMatrixEvidenceReference?: string;
  };
}

export interface MvpPromotionEvaluation {
  ready: boolean;
  contextSha256?: string;
  participantMetrics: Array<{
    pilotId: string;
    medianActiveDurationSeconds?: number;
    medianElapsedDurationSeconds?: number;
    medianTimeSavedSeconds?: number;
  }>;
  blockers: Array<{ subject: string; reason: string }>;
}

export function createPendingMvpPromotionManifest(input: unknown): MvpPromotionManifest {
  const parsed = parsePromotionInput(input);
  if (!parsed) throw new Error("MVP promotion input is invalid.");
  const contextSha256 = smokeContextSha256(parsed.release);
  return {
    schemaVersion: 1,
    format: "doonce.mvp-promotion-evidence.v1",
    release: parsed.release,
    charterSha256: parsed.charterSha256,
    minimumTimeSavedSeconds: parsed.minimumTimeSavedSeconds,
    smokeGate: { status: "pending", contextSha256 },
    participants: parsed.pilotIds.map((pilotId) => ({ pilotId, status: "pending", contextSha256 })),
    decision: { status: "pending" },
  };
}

export function evaluateMvpPromotionManifest(input: unknown): MvpPromotionEvaluation {
  const empty: MvpPromotionEvaluation = { ready: false, participantMetrics: [], blockers: [] };
  if (!isRecord(input) || !hasExactKeys(input, ["schemaVersion", "format", "release", "charterSha256", "minimumTimeSavedSeconds", "smokeGate", "participants", "decision"]) || input.schemaVersion !== 1 || input.format !== "doonce.mvp-promotion-evidence.v1") {
    return { ...empty, blockers: [{ subject: "manifest", reason: "Promotion manifest structure is invalid." }] };
  }
  const release = parseMvpSmokeReleaseContext(input.release);
  if (!release || !isSha256(input.charterSha256) || !isPositiveInteger(input.minimumTimeSavedSeconds) || !Array.isArray(input.participants) || !isRecord(input.smokeGate) || !isRecord(input.decision)) {
    return { ...empty, blockers: [{ subject: "manifest", reason: "Promotion release, charter, threshold, or evidence collections are invalid." }] };
  }

  const contextSha256 = smokeContextSha256(release);
  const blockers: MvpPromotionEvaluation["blockers"] = [];
  const participantMetrics: MvpPromotionEvaluation["participantMetrics"] = [];
  evaluateSmokeGate(input.smokeGate, contextSha256, blockers);

  if (input.participants.length !== 3) blockers.push({ subject: "participants", reason: "Promotion requires exactly three pilot participants." });
  const pilotIds = new Set<string>();
  for (const participant of input.participants) {
    if (!isRecord(participant) || !isPilotId(participant.pilotId)) {
      blockers.push({ subject: "participant", reason: "Every participant requires a stable pseudonymous pilot ID." });
      continue;
    }
    if (pilotIds.has(participant.pilotId)) blockers.push({ subject: participant.pilotId, reason: "Pilot participant is duplicated." });
    pilotIds.add(participant.pilotId);
    const result = evaluateParticipant(participant, contextSha256, input.minimumTimeSavedSeconds);
    blockers.push(...result.blockers);
    participantMetrics.push({ pilotId: participant.pilotId, ...result.metrics });
  }

  evaluateDecision(input.decision, blockers);
  return { ready: blockers.length === 0, contextSha256, participantMetrics, blockers };
}

function evaluateSmokeGate(gate: Record<string, unknown>, contextSha256: string, blockers: MvpPromotionEvaluation["blockers"]): void {
  if (!hasOnlyKeys(gate, ["status", "contextSha256", "evidenceReference", "recordedAt"])) blockers.push({ subject: "smoke-gate", reason: "Smoke gate contains an unknown field." });
  if (gate.contextSha256 !== contextSha256) blockers.push({ subject: "smoke-gate", reason: "Smoke evidence is not bound to this release context." });
  if (gate.status !== "passed") {
    blockers.push({ subject: "smoke-gate", reason: gate.status === "failed" ? "Release smoke gate failed." : "Release smoke gate is pending." });
    return;
  }
  if (!isEvidenceReference(gate.evidenceReference) || !isIsoDate(gate.recordedAt)) blockers.push({ subject: "smoke-gate", reason: "Passing smoke evidence requires a stable reference and timestamp." });
}

function evaluateParticipant(participant: Record<string, unknown>, contextSha256: string, minimumTimeSavedSeconds: number): { blockers: MvpPromotionEvaluation["blockers"]; metrics: Omit<MvpPromotionEvaluation["participantMetrics"][number], "pilotId"> } {
  const subject = String(participant.pilotId);
  const blockers: MvpPromotionEvaluation["blockers"] = [];
  const metrics: Omit<MvpPromotionEvaluation["participantMetrics"][number], "pilotId"> = {};
  if (!hasOnlyKeys(participant, ["pilotId", "status", "contextSha256", "observer", "recordedAt", "consentEvidenceReference", "expectationEvidenceReference", "baselineDurationSeconds", "historicalErrorRatePercent", "productionRuns", "comprehension", "uncertaintyObservations", "safePauseEvidenceReference", "leakageReviewReference", "failureReason"])) blockers.push({ subject, reason: "Participant evidence contains an unknown field." });
  if (participant.contextSha256 !== contextSha256) blockers.push({ subject, reason: "Participant evidence is not bound to this release context." });
  if (participant.status === "pending") {
    blockers.push({ subject, reason: "Pilot evidence is pending real-user observation." });
    return { blockers, metrics };
  }
  if (participant.status === "failed") {
    blockers.push({ subject, reason: isStableText(participant.failureReason) ? `Pilot evidence failed (${participant.failureReason}).` : "Failed pilot evidence requires a bounded reason." });
    return { blockers, metrics };
  }
  if (participant.status !== "passed") {
    blockers.push({ subject, reason: "Participant status is invalid." });
    return { blockers, metrics };
  }

  if (!isOwner(participant.observer) || !isIsoDate(participant.recordedAt) || !isEvidenceReference(participant.consentEvidenceReference) || !isEvidenceReference(participant.expectationEvidenceReference) || !isEvidenceReference(participant.safePauseEvidenceReference) || !isEvidenceReference(participant.leakageReviewReference)) blockers.push({ subject, reason: "Passing pilot evidence requires dated consent, expectation, safe-pause, leakage-review, and observer references." });
  if (!isPositiveInteger(participant.baselineDurationSeconds)) blockers.push({ subject, reason: "Manual baseline duration must be a positive whole number of seconds." });
  if (!isPercentage(participant.historicalErrorRatePercent)) blockers.push({ subject, reason: "Historical error rate must be between 0 and 100 percent." });
  evaluateComprehension(participant.comprehension, subject, blockers);
  evaluateUncertainties(participant.uncertaintyObservations, subject, blockers);

  if (!Array.isArray(participant.productionRuns) || participant.productionRuns.length !== 3) {
    blockers.push({ subject, reason: "Exactly three verified production runs are required." });
    return { blockers, metrics };
  }
  const runIds = new Set<string>();
  let firstRuns = 0;
  let repeatRuns = 0;
  const activeDurations: number[] = [];
  const elapsedDurations: number[] = [];
  for (const run of participant.productionRuns) {
    if (!isRecord(run) || !hasExactKeys(run, ["runId", "stage", "contextSha256", "verified", "developerIntervened", "sensitiveDataLeakage", "activeDurationSeconds", "elapsedDurationSeconds", "supportDurationSeconds", "approvalEvidenceReference", "receiptEvidenceReference", "recordedAt"])) {
      blockers.push({ subject, reason: "Production run evidence structure is invalid." });
      continue;
    }
    if (!isUuid(run.runId) || runIds.has(run.runId)) blockers.push({ subject, reason: "Production run IDs must be distinct UUIDs." });
    if (typeof run.runId === "string") runIds.add(run.runId);
    if (run.stage === "first-production") firstRuns += 1;
    else if (run.stage === "repeat-production") repeatRuns += 1;
    else blockers.push({ subject, reason: "Production run stage is invalid." });
    if (run.contextSha256 !== contextSha256) blockers.push({ subject, reason: "Production run is not bound to this release context." });
    if (run.verified !== true || run.developerIntervened !== false || run.sensitiveDataLeakage !== false) blockers.push({ subject, reason: "Every counted run must be verified, intervention-free, and leakage-free." });
    if (!isPositiveInteger(run.activeDurationSeconds) || !isPositiveInteger(run.elapsedDurationSeconds) || !isNonNegativeInteger(run.supportDurationSeconds) || (typeof run.activeDurationSeconds === "number" && typeof run.elapsedDurationSeconds === "number" && run.activeDurationSeconds > run.elapsedDurationSeconds)) blockers.push({ subject, reason: "Run timing must be non-negative, integral, and active time cannot exceed elapsed time." });
    if (!isEvidenceReference(run.approvalEvidenceReference) || !isEvidenceReference(run.receiptEvidenceReference) || !isIsoDate(run.recordedAt)) blockers.push({ subject, reason: "Every counted run requires fresh-approval, receipt, and timestamp evidence." });
    if (isPositiveInteger(run.activeDurationSeconds)) activeDurations.push(run.activeDurationSeconds);
    if (isPositiveInteger(run.elapsedDurationSeconds)) elapsedDurations.push(run.elapsedDurationSeconds);
  }
  if (firstRuns !== 1 || repeatRuns !== 2) blockers.push({ subject, reason: "Counted runs must contain one first production run and two repeat production runs." });
  if (activeDurations.length === 3 && elapsedDurations.length === 3 && isPositiveInteger(participant.baselineDurationSeconds)) {
    metrics.medianActiveDurationSeconds = median(activeDurations);
    metrics.medianElapsedDurationSeconds = median(elapsedDurations);
    metrics.medianTimeSavedSeconds = participant.baselineDurationSeconds - metrics.medianActiveDurationSeconds;
    if (metrics.medianTimeSavedSeconds < minimumTimeSavedSeconds) blockers.push({ subject, reason: `Median time saved (${metrics.medianTimeSavedSeconds}s) is below the charter threshold (${minimumTimeSavedSeconds}s).` });
  }
  return { blockers, metrics };
}

function evaluateComprehension(value: unknown, subject: string, blockers: MvpPromotionEvaluation["blockers"]): void {
  if (!isRecord(value) || !hasExactKeys(value, [...comprehensionChecks, "evidenceReference"]) || !isEvidenceReference(value.evidenceReference) || comprehensionChecks.some((key) => value[key] !== true)) blockers.push({ subject, reason: "User comprehension must pass all five checks with stable evidence." });
}

function evaluateUncertainties(value: unknown, subject: string, blockers: MvpPromotionEvaluation["blockers"]): void {
  if (!Array.isArray(value)) {
    blockers.push({ subject, reason: "Uncertainty observations must be explicitly recorded, including an empty set." });
    return;
  }
  const ids = new Set<string>();
  for (const observation of value) {
    if (!isRecord(observation) || !hasExactKeys(observation, ["id", "outcome", "evidenceReference", "recordedAt"]) || !isStableText(observation.id) || ids.has(String(observation.id)) || observation.outcome !== "safely-paused" || !isEvidenceReference(observation.evidenceReference) || !isIsoDate(observation.recordedAt)) blockers.push({ subject, reason: "Every distinct observed uncertainty must have dated safely-paused evidence." });
    if (isStableText(observation.id)) ids.add(observation.id);
  }
}

function evaluateDecision(decision: Record<string, unknown>, blockers: MvpPromotionEvaluation["blockers"]): void {
  if (!hasOnlyKeys(decision, ["status", "owner", "recordedAt", "evidenceReference", "launchReadinessEvidenceReference", "capabilityMatrixEvidenceReference"])) blockers.push({ subject: "decision", reason: "Founder decision contains an unknown field." });
  if (decision.status !== "go") {
    blockers.push({ subject: "decision", reason: decision.status === "no-go" ? "Founder decision is no-go." : "Founder go/no-go decision is pending." });
    return;
  }
  if (!isOwner(decision.owner) || !isIsoDate(decision.recordedAt) || !isEvidenceReference(decision.evidenceReference) || !isEvidenceReference(decision.launchReadinessEvidenceReference) || !isEvidenceReference(decision.capabilityMatrixEvidenceReference)) blockers.push({ subject: "decision", reason: "A go decision requires a dated owner record plus launch-readiness and capability-matrix evidence." });
}

function parsePromotionInput(value: unknown): PromotionInput | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["release", "charterSha256", "minimumTimeSavedSeconds", "pilotIds"])) return undefined;
  const release = parseMvpSmokeReleaseContext(value.release);
  if (!release || !isSha256(value.charterSha256) || !isPositiveInteger(value.minimumTimeSavedSeconds) || !Array.isArray(value.pilotIds) || value.pilotIds.length !== 3 || !value.pilotIds.every(isPilotId) || new Set(value.pilotIds).size !== 3) return undefined;
  return { release, charterSha256: value.charterSha256, minimumTimeSavedSeconds: value.minimumTimeSavedSeconds, pilotIds: value.pilotIds as [string, string, string] };
}

function median(values: number[]): number { return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys); }
function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function isSha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isPilotId(value: unknown): value is string { return typeof value === "string" && /^pilot-[a-z0-9][a-z0-9-]{0,31}$/.test(value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function isPositiveInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0; }
function isNonNegativeInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function isPercentage(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100; }
function isOwner(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._@-]{1,79}$/.test(value); }
function isStableText(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,159}$/.test(value); }
function isEvidenceReference(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/.test(value); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
