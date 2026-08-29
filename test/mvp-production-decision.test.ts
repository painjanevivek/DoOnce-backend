import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateMvpProductionDecision } from "../src/release/mvp-production-decision.js";

test("keeps the checked-in founder decision template fail closed", async () => {
  const template = JSON.parse(await readFile(new URL("../ops/environments/mvp-production.template.json", import.meta.url), "utf8"));
  const result = evaluateMvpProductionDecision(template);
  assert.equal(result.provisioningReady, false);
  assert.equal(result.pilotReady, false);
  assert.ok(result.blockers.some(({ field }) => field === "provider.region"));
  assert.ok(result.blockers.some(({ field }) => field === "domains.control"));
  assert.ok(result.blockers.some(({ field }) => field === "reportContract.historicalDownloads"));
  assert.ok(result.blockers.some(({ field }) => field === "pilots.pilot-alpha"));
});

test("accepts only the approved topology, policy, authorization, samples, owners, and baselines", () => {
  const result = evaluateMvpProductionDecision(completeDecision());
  assert.deepEqual(result, { provisioningReady: true, pilotReady: true, blockers: [] });
});

test("blocks budget drift, unverified domains, unsafe redirects, CAPTCHA, and retention drift", () => {
  const decision = completeDecision();
  decision.provider.monthlyHardBudgetUsd = 151;
  decision.domains.registrarControlVerified = false;
  decision.retention.downloadedArtifactsDays = 30;
  decision.pilotAuthorization.authenticationMethods.push("captcha");
  decision.reportContract.historicalDownloads[0]!.redirectOrigins.push("https://files.example.net");
  const result = evaluateMvpProductionDecision(decision);
  assert.equal(result.provisioningReady, false);
  assert.equal(result.pilotReady, false);
  assert.ok(result.blockers.some(({ field }) => field === "provider.monthlyHardBudgetUsd"));
  assert.ok(result.blockers.some(({ field }) => field === "domains.control"));
  assert.ok(result.blockers.some(({ field }) => field === "retention.downloadedArtifactsDays"));
  assert.ok(result.blockers.some(({ field }) => field === "pilotAuthorization.boundaries"));
  assert.ok(result.blockers.some(({ field }) => field === "reportContract.historicalDownloads"));
});

test("rejects missing owners, duplicate pilots, weak baselines, and unknown manifest fields", () => {
  const decision = completeDecision();
  decision.accountabilities[0]!.primary = null;
  decision.pilots[1]!.pilotId = "pilot-alpha";
  decision.pilots[2]!.baselineDurationSeconds = 0;
  Object.assign(decision, { secrets: { renderApiKey: "must never be accepted" } });
  const result = evaluateMvpProductionDecision(decision);
  assert.equal(result.provisioningReady, false);
  assert.equal(result.pilotReady, false);
  assert.equal(result.blockers[0]?.field, "manifest");
});

function completeDecision() {
  const exactOrigin = "https://reports.example.com";
  return {
    schemaVersion: 1,
    format: "doonce.mvp-production-decision.v1",
    provider: { name: "render", project: "doonce-pilot-production", region: "singapore", regionReconfirmed: true, monthlyHardBudgetUsd: 150, paidPostgres: true, pitrEnabled: true, pitrDays: 7 },
    topology: { frontendServices: 1, apiServices: 1, workerServices: 0, additionalServicesApproved: false },
    domains: { proposedFrontendOrigin: "https://pilot.doonce.dev", proposedApiOrigin: "https://api-pilot.doonce.dev", registrarControlVerified: true, cloudflareZoneAccessVerified: true, evidenceReference: "evidence:domain-control" },
    accountAccess: [
      { id: "render", authenticatedLocally: true, accountOwner: "Asha Founder", evidenceReference: "evidence:render-access" },
      { id: "cloudflare", authenticatedLocally: true, accountOwner: "Asha Founder", evidenceReference: "evidence:cloudflare-access" },
      { id: "chrome-web-store", authenticatedLocally: true, accountOwner: "Asha Founder", evidenceReference: "evidence:chrome-access" },
    ],
    distribution: { primary: "unlisted-chrome-web-store", fallback: "checksum-verified-manual", fallbackAudience: "three-named-pilots-only", extensionId: "a".repeat(32), installUrl: "https://chromewebstore.google.com/detail/example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", publisherApprovalReference: "evidence:publisher-approval" },
    retention: { rawCapturesDays: 14, abandonedCapturesDays: 7, downloadedArtifactsDays: 7, receiptAuditEvidenceMonths: 12, operationalLogsDays: 30, securityIncidentLogsDays: 180, supportRecordsMonthsAfterClosure: 12, pitrDays: 7, logicalBackupFrequency: "weekly", logicalBackupRetentionDays: 30, legalHoldOnlyException: true, neverRetain: ["credentials", "otps", "captcha-data", "page-bodies"], enforcementEvidenceReference: "evidence:retention-enforcement" },
    accountabilities: [
      { id: "operations", primary: "Ravi Operator", backup: "Asha Founder", reviewers: [], acceptedAt: "2026-08-29T10:00:00.000Z", evidenceReference: "evidence:owner-operations" },
      { id: "privacy", primary: "Mira Privacy", backup: "Nila Backup", reviewers: [], acceptedAt: "2026-08-29T10:00:00.000Z", evidenceReference: "evidence:owner-privacy" },
      { id: "chrome-publishing", primary: "Asha Founder", backup: "Ravi Operator", reviewers: [], acceptedAt: "2026-08-29T10:00:00.000Z", evidenceReference: "evidence:owner-chrome" },
      { id: "legal", primary: "Leela Counsel", backup: null, reviewers: [], acceptedAt: "2026-08-29T10:00:00.000Z", evidenceReference: "evidence:owner-legal" },
      { id: "launch", primary: "Asha Founder", backup: null, reviewers: ["Ravi Operator", "Leela Counsel"], acceptedAt: "2026-08-29T10:00:00.000Z", evidenceReference: "evidence:owner-launch" },
    ],
    pilotAuthorization: { organization: "Example Operations Ltd", approverName: "Priya Approver", approverTitle: "Operations Director", exactOrigin, reportPath: "/reports/weekly", reportName: "Weekly Operations Report", authorizedPilotIds: ["pilot-alpha", "pilot-bravo", "pilot-charlie"], startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z", evidenceReference: "evidence:pilot-authorization", authenticationMethods: ["sso", "mfa"], fileRemainsOnApprovedOrigin: true },
    reportContract: {
      fileNamePattern: "^weekly-operations-report-\\d{4}-\\d{2}-\\d{2}\\.csv$",
      contentTypes: ["text/csv"],
      minimumBytes: 10_000,
      maximumBytes: 20_000,
      historicalDownloads: [0, 1, 2, 3, 4].map((index) => ({ fileName: `weekly-operations-report-2026-08-${String(index + 1).padStart(2, "0")}.csv`, contentType: "text/csv", byteSize: 12_000 + index * 1_000, checksumSha256: String(index + 1).repeat(64), generatedAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`, observedOrigin: exactOrigin, redirectOrigins: [exactOrigin], evidenceReference: `evidence:historical-download-${index + 1}` })),
    },
    pilots: ["pilot-alpha", "pilot-bravo", "pilot-charlie"].map((pilotId, index) => ({ pilotId, organizationRole: "Operations analyst", taskRecurrence: "weekly", baselineDurationSeconds: 700 + index * 30, historicalErrorRatePercent: index, consentEvidenceReference: `evidence:${pilotId}:consent`, observer: "Ravi Operator", observedAt: "2026-08-29T10:00:00.000Z" })),
    valueThresholdSeconds: 300,
  };
}
