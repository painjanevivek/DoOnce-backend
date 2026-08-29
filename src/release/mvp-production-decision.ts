const requiredAccounts = ["render", "cloudflare", "chrome-web-store"] as const;
const requiredAccountabilities = ["operations", "privacy", "chrome-publishing", "legal", "launch"] as const;
const requiredPilotIds = ["pilot-alpha", "pilot-bravo", "pilot-charlie"] as const;
const forbiddenRetentionData = ["credentials", "otps", "captcha-data", "page-bodies"] as const;

type ReadinessStage = "provisioning" | "pilot";

export interface MvpProductionDecisionEvaluation {
  provisioningReady: boolean;
  pilotReady: boolean;
  blockers: Array<{ stage: ReadinessStage; field: string; reason: string }>;
}

export function evaluateMvpProductionDecision(input: unknown): MvpProductionDecisionEvaluation {
  if (!isRecord(input) || !hasExactKeys(input, ["schemaVersion", "format", "provider", "topology", "domains", "accountAccess", "distribution", "retention", "accountabilities", "pilotAuthorization", "reportContract", "pilots", "valueThresholdSeconds"]) || input.schemaVersion !== 1 || input.format !== "doonce.mvp-production-decision.v1") return invalidManifest();

  const blockers: MvpProductionDecisionEvaluation["blockers"] = [];
  validateProvider(input.provider, blockers);
  validateTopology(input.topology, blockers);
  validateDomains(input.domains, blockers);
  validateAccounts(input.accountAccess, blockers);
  validateDistribution(input.distribution, blockers);
  validateRetention(input.retention, blockers);
  validateAccountabilities(input.accountabilities, blockers);
  const approvedOrigin = validatePilotAuthorization(input.pilotAuthorization, blockers);
  validateReportContract(input.reportContract, approvedOrigin, blockers);
  validatePilots(input.pilots, blockers);
  if (input.valueThresholdSeconds !== 300) add(blockers, "pilot", "valueThresholdSeconds", "The founder-approved minimum saving is exactly 300 seconds per run.");

  const provisioningReady = !blockers.some(({ stage }) => stage === "provisioning");
  return { provisioningReady, pilotReady: provisioningReady && blockers.length === 0, blockers };
}

function validateProvider(value: unknown, blockers: MvpProductionDecisionEvaluation["blockers"]): void {
  if (!isRecord(value) || !hasExactKeys(value, ["name", "project", "region", "regionReconfirmed", "monthlyHardBudgetUsd", "paidPostgres", "pitrEnabled", "pitrDays"])) {
    add(blockers, "provisioning", "provider", "Provider decision structure is invalid.");
    return;
  }
  if (value.name !== "render" || value.project !== "doonce-pilot-production") add(blockers, "provisioning", "provider", "The approved provider is Render project doonce-pilot-production.");
  if (value.region !== "singapore" || value.regionReconfirmed !== true) add(blockers, "provisioning", "provider.region", "Singapore must be reconfirmed immediately before provisioning.");
  if (value.monthlyHardBudgetUsd !== 150) add(blockers, "provisioning", "provider.monthlyHardBudgetUsd", "The hard monthly ceiling is USD 150.");
  if (value.paidPostgres !== true || value.pitrEnabled !== true || value.pitrDays !== 7) add(blockers, "provisioning", "provider.database", "Paid PostgreSQL with seven-day PITR is required.");
}

function validateTopology(value: unknown, blockers: MvpProductionDecisionEvaluation["blockers"]): void {
  if (!isRecord(value) || !hasExactKeys(value, ["frontendServices", "apiServices", "workerServices", "additionalServicesApproved"]) || value.frontendServices !== 1 || value.apiServices !== 1 || value.workerServices !== 0 || value.additionalServicesApproved !== false) add(blockers, "provisioning", "topology", "Pilot topology must be one frontend, one API, no worker, and no additional service.");
}

function validateDomains(value: unknown, blockers: MvpProductionDecisionEvaluation["blockers"]): void {
  if (!isRecord(value) || !hasExactKeys(value, ["proposedFrontendOrigin", "proposedApiOrigin", "registrarControlVerified", "cloudflareZoneAccessVerified", "evidenceReference"])) {
    add(blockers, "provisioning", "domains", "Domain decision structure is invalid.");
    return;
  }
  if (value.proposedFrontendOrigin !== "https://pilot.doonce.dev" || value.proposedApiOrigin !== "https://api-pilot.doonce.dev") add(blockers, "provisioning", "domains.origins", "The proposed pilot frontend and API origins must remain exact HTTPS origins until replaced by a founder-approved decision.");
  if (value.registrarControlVerified !== true || value.cloudflareZoneAccessVerified !== true || !isEvidenceReference(value.evidenceReference)) add(blockers, "provisioning", "domains.control", "Registrar ownership and Cloudflare zone access require stable evidence before production.");
}

function validateAccounts(value: unknown, blockers: MvpProductionDecisionEvaluation["blockers"]): void {
  if (!Array.isArray(value)) {
    add(blockers, "provisioning", "accountAccess", "Account access evidence is missing.");
    return;
  }
  for (const id of requiredAccounts) {
    const matches = value.filter((entry) => isRecord(entry) && entry.id === id);
    if (matches.length !== 1 || !hasExactKeys(matches[0]!, ["id", "authenticatedLocally", "accountOwner", "evidenceReference"]) || matches[0]!.authenticatedLocally !== true || !isHumanName(matches[0]!.accountOwner) || !isEvidenceReference(matches[0]!.evidenceReference)) add(blockers, id === "chrome-web-store" ? "pilot" : "provisioning", `accountAccess.${id}`, "A named owner must authenticate locally and retain a stable access evidence reference.");
  }
  if (value.some((entry) => !isRecord(entry) || !requiredAccounts.includes(entry.id as (typeof requiredAccounts)[number]))) add(blockers, "provisioning", "accountAccess", "Unknown account access entries are not permitted.");
}

function validateDistribution(value: unknown, blockers: MvpProductionDecisionEvaluation["blockers"]): void {
  if (!isRecord(value) || !hasExactKeys(value, ["primary", "fallback", "fallbackAudience", "extensionId", "installUrl", "publisherApprovalReference"]) || value.primary !== "unlisted-chrome-web-store" || value.fallback !== "checksum-verified-manual" || value.fallbackAudience !== "three-named-pilots-only") {
    add(blockers, "pilot", "distribution", "Primary distribution must be unlisted Chrome Web Store with a three-pilot checksum-verified fallback.");
    return;
  }
  if (typeof value.extensionId !== "string" || !/^[a-p]{32}$/.test(value.extensionId) || !isHttpsUrl(value.installUrl) || !isEvidenceReference(value.publisherApprovalReference)) add(blockers, "pilot", "distribution.approval", "Pilot distribution requires the final extension ID, HTTPS install URL, and publisher approval evidence.");
}

function validateRetention(value: unknown, blockers: MvpProductionDecisionEvaluation["blockers"]): void {
  const expected = {
    rawCapturesDays: 14,
    abandonedCapturesDays: 7,
    downloadedArtifactsDays: 7,
    receiptAuditEvidenceMonths: 12,
    operationalLogsDays: 30,
    securityIncidentLogsDays: 180,
    supportRecordsMonthsAfterClosure: 12,
    pitrDays: 7,
    logicalBackupFrequency: "weekly",
    logicalBackupRetentionDays: 30,
    legalHoldOnlyException: true,
  } as const;
  if (!isRecord(value) || !hasExactKeys(value, [...Object.keys(expected), "neverRetain", "enforcementEvidenceReference"])) {
    add(blockers, "provisioning", "retention", "Retention policy structure is invalid.");
    return;
  }
  for (const [key, expectedValue] of Object.entries(expected)) if (value[key] !== expectedValue) add(blockers, "provisioning", `retention.${key}`, `Retention value must remain ${String(expectedValue)}.`);
  const neverRetain = value.neverRetain;
  if (!Array.isArray(neverRetain) || neverRetain.length !== forbiddenRetentionData.length || forbiddenRetentionData.some((item) => !neverRetain.includes(item))) add(blockers, "provisioning", "retention.neverRetain", "Credentials, OTPs, CAPTCHA data, and page bodies must never be retained.");
  if (!isEvidenceReference(value.enforcementEvidenceReference)) add(blockers, "provisioning", "retention.enforcementEvidenceReference", "Production requires evidence that database, artifact, log, support, PITR, and backup retention are actually enforced.");
}

function validateAccountabilities(value: unknown, blockers: MvpProductionDecisionEvaluation["blockers"]): void {
  if (!Array.isArray(value)) {
    add(blockers, "provisioning", "accountabilities", "Named accountable owners are missing.");
    return;
  }
  for (const id of requiredAccountabilities) {
    const matches = value.filter((entry) => isRecord(entry) && entry.id === id);
    const entry = matches[0];
    if (matches.length !== 1 || !entry || !hasExactKeys(entry, ["id", "primary", "backup", "reviewers", "acceptedAt", "evidenceReference"]) || !isHumanName(entry.primary) || (!["legal", "launch"].includes(id) && !isHumanName(entry.backup)) || (entry.backup !== null && !isHumanName(entry.backup)) || !Array.isArray(entry.reviewers) || (id === "launch" && (entry.reviewers.length < 2 || !entry.reviewers.every(isHumanName))) || !isIsoDate(entry.acceptedAt) || !isEvidenceReference(entry.evidenceReference)) add(blockers, "provisioning", `accountabilities.${id}`, "Actual named owners must accept accountability with dated evidence; launch requires technical and legal reviewers.");
  }
  if (value.some((entry) => !isRecord(entry) || !requiredAccountabilities.includes(entry.id as (typeof requiredAccountabilities)[number]))) add(blockers, "provisioning", "accountabilities", "Unknown accountability entries are not permitted.");
}

function validatePilotAuthorization(value: unknown, blockers: MvpProductionDecisionEvaluation["blockers"]): string | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["organization", "approverName", "approverTitle", "exactOrigin", "reportPath", "reportName", "authorizedPilotIds", "startsAt", "endsAt", "evidenceReference", "authenticationMethods", "fileRemainsOnApprovedOrigin"])) {
    add(blockers, "pilot", "pilotAuthorization", "Written pilot authorization structure is invalid.");
    return undefined;
  }
  if (!isStableText(value.organization) || !isHumanName(value.approverName) || !isStableText(value.approverTitle) || !isEvidenceReference(value.evidenceReference)) add(blockers, "pilot", "pilotAuthorization.approver", "Written authorization requires the organization, named approver and title, and a stable reference.");
  if (!isExactHttpsOrigin(value.exactOrigin)) add(blockers, "pilot", "pilotAuthorization.exactOrigin", "Authorization requires one exact public HTTPS origin with no path or nonstandard port.");
  if (!isExactPath(value.reportPath) || !isStableText(value.reportName)) add(blockers, "pilot", "pilotAuthorization.report", "Authorization requires the exact bounded report path and name.");
  if (!isExactPilotIdSet(value.authorizedPilotIds)) add(blockers, "pilot", "pilotAuthorization.authorizedPilotIds", "Authorization must name exactly the three pseudonymous pilot IDs.");
  if (!isIsoDate(value.startsAt) || !isIsoDate(value.endsAt) || (typeof value.startsAt === "string" && typeof value.endsAt === "string" && Date.parse(value.endsAt) <= Date.parse(value.startsAt))) add(blockers, "pilot", "pilotAuthorization.dates", "Authorization requires a valid bounded pilot window.");
  if (!Array.isArray(value.authenticationMethods) || value.authenticationMethods.length === 0 || value.authenticationMethods.some((method) => !["password", "sso", "mfa"].includes(String(method))) || value.fileRemainsOnApprovedOrigin !== true) add(blockers, "pilot", "pilotAuthorization.boundaries", "Only manual password/SSO/MFA is allowed, CAPTCHA is excluded, and the file must remain on the approved origin.");
  return typeof value.exactOrigin === "string" ? value.exactOrigin : undefined;
}

function validateReportContract(value: unknown, approvedOrigin: string | undefined, blockers: MvpProductionDecisionEvaluation["blockers"]): void {
  if (!isRecord(value) || !hasExactKeys(value, ["fileNamePattern", "contentTypes", "minimumBytes", "maximumBytes", "historicalDownloads"])) {
    add(blockers, "pilot", "reportContract", "Report contract structure is invalid.");
    return;
  }
  const fileNamePattern = boundedFileNamePattern(value.fileNamePattern);
  if (!fileNamePattern || !Array.isArray(value.contentTypes) || value.contentTypes.length !== 1 || value.contentTypes[0] !== "text/csv") add(blockers, "pilot", "reportContract.format", "The approved report requires an anchored, bounded filename pattern and the text/csv content type.");
  if (!isPositiveInteger(value.minimumBytes) || !isPositiveInteger(value.maximumBytes) || Number(value.minimumBytes) >= Number(value.maximumBytes) || Number(value.maximumBytes) > 26_214_400) add(blockers, "pilot", "reportContract.size", "The sample-derived byte range must be positive, ordered, and no larger than 25 MiB.");
  if (!Array.isArray(value.historicalDownloads) || value.historicalDownloads.length !== 5) {
    add(blockers, "pilot", "reportContract.historicalDownloads", "Exactly five authorized historical download metadata samples are required.");
    return;
  }
  const checksums = new Set<string>();
  for (const sample of value.historicalDownloads) {
    if (!isRecord(sample) || !hasExactKeys(sample, ["fileName", "contentType", "byteSize", "checksumSha256", "generatedAt", "observedOrigin", "redirectOrigins", "evidenceReference"]) || typeof sample.fileName !== "string" || !fileNamePattern?.test(sample.fileName) || sample.contentType !== "text/csv" || !isPositiveInteger(sample.byteSize) || Number(sample.byteSize) < Number(value.minimumBytes) || Number(sample.byteSize) > Number(value.maximumBytes) || !isSha256(sample.checksumSha256) || checksums.has(String(sample.checksumSha256)) || !isIsoDate(sample.generatedAt) || sample.observedOrigin !== approvedOrigin || !Array.isArray(sample.redirectOrigins) || sample.redirectOrigins.some((origin) => origin !== approvedOrigin) || !isEvidenceReference(sample.evidenceReference)) add(blockers, "pilot", "reportContract.historicalDownloads", "Each distinct sample must match the approved origin, CSV contract, bounded size, checksum, date, and evidence reference without cross-origin redirects.");
    if (isSha256(sample.checksumSha256)) checksums.add(sample.checksumSha256);
  }
}

function validatePilots(value: unknown, blockers: MvpProductionDecisionEvaluation["blockers"]): void {
  if (!Array.isArray(value) || value.length !== 3) {
    add(blockers, "pilot", "pilots", "Exactly three pilot baseline records are required.");
    return;
  }
  for (const id of requiredPilotIds) {
    const matches = value.filter((entry) => isRecord(entry) && entry.pilotId === id);
    const entry = matches[0];
    if (matches.length !== 1 || !entry || !hasExactKeys(entry, ["pilotId", "organizationRole", "taskRecurrence", "baselineDurationSeconds", "historicalErrorRatePercent", "consentEvidenceReference", "observer", "observedAt"]) || !isStableText(entry.organizationRole) || !isStableText(entry.taskRecurrence) || !isPositiveInteger(entry.baselineDurationSeconds) || !isPercentage(entry.historicalErrorRatePercent) || !isEvidenceReference(entry.consentEvidenceReference) || !isHumanName(entry.observer) || !isIsoDate(entry.observedAt)) add(blockers, "pilot", `pilots.${id}`, "Each distinct consenting pilot needs a positive observed baseline, recurrence, role, error rate, observer, date, and evidence.");
  }
}

function invalidManifest(): MvpProductionDecisionEvaluation { return { provisioningReady: false, pilotReady: false, blockers: [{ stage: "provisioning", field: "manifest", reason: "Production decision manifest structure is invalid." }] }; }
function add(blockers: MvpProductionDecisionEvaluation["blockers"], stage: ReadinessStage, field: string, reason: string): void { blockers.push({ stage, field, reason }); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
function isEvidenceReference(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/.test(value); }
function isHumanName(value: unknown): value is string { return typeof value === "string" && value.length >= 2 && value.length <= 100 && /^[\p{L}][\p{L} .'-]*$/u.test(value) && !/^(founder|operator|counsel|pending|tbd|unassigned)$/i.test(value); }
function isStableText(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._:/()&'-]{1,159}$/.test(value); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function isSha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isPositiveInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0; }
function isPercentage(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100; }
function isHttpsUrl(value: unknown): value is string { if (typeof value !== "string") return false; try { return new URL(value).protocol === "https:"; } catch { return false; } }
function isExactHttpsOrigin(value: unknown): value is string { if (typeof value !== "string") return false; try { const url = new URL(value); return url.protocol === "https:" && url.origin === value && url.port === "" && url.pathname === "/" && url.search === "" && url.hash === "" && !/^(localhost|127\.|\[::1\]$)/i.test(url.hostname); } catch { return false; } }
function isExactPath(value: unknown): value is string { return typeof value === "string" && value.startsWith("/") && value.length <= 2048 && !value.includes("//") && !value.split("/").includes("..") && !/[?#\\\r\n]/.test(value); }
function isExactPilotIdSet(value: unknown): boolean { return Array.isArray(value) && value.length === requiredPilotIds.length && requiredPilotIds.every((id) => value.includes(id)); }
function boundedFileNamePattern(value: unknown): ReturnType<typeof compileBoundedPattern> | undefined { if (typeof value !== "string" || !value.startsWith("^") || !value.endsWith("$") || value.length > 256) return undefined; try { return compileBoundedPattern(value); } catch { return undefined; } }
import { compileBoundedPattern } from "../security/network-policy.js";
