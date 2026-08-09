export const betaTaskCategories = [
  "report-download",
  "filter-export",
  "structured-form-entry",
  "table-extraction",
  "copy-fields",
  "bounded-condition",
] as const;

export const betaFailureCategories = [
  "compiler-problem",
  "locator-problem",
  "editor-confusion",
  "executor-limitation",
  "website-incompatibility",
  "verification-gap",
  "infrastructure-problem",
] as const;

export const betaObservationStages = ["first-test", "first-production", "repeat-production"] as const;
export const betaEnrollmentStatuses = ["onboarding", "active", "paused", "graduated"] as const;

export type BetaTaskCategory = (typeof betaTaskCategories)[number];
export type BetaFailureCategory = (typeof betaFailureCategories)[number];
export type BetaObservationStage = (typeof betaObservationStages)[number];
export type BetaEnrollmentStatus = (typeof betaEnrollmentStatuses)[number];

export interface BetaWorkflowEnrollment {
  id: string;
  workflowId: string;
  taskCategory: BetaTaskCategory;
  baselineDurationSeconds: number;
  baselineErrorRatePercent: number;
  status: BetaEnrollmentStatus;
  firstTestObserved: boolean;
  firstProductionObserved: boolean;
  repeatUnassistedRuns: number;
  productionRuns: number;
  successfulProductionRuns: number;
  productionSuccessRate: number;
  classifiedFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface BetaSummary {
  enrolledWorkflows: number;
  workflowsWithFirstTest: number;
  workflowsWithFirstProduction: number;
  workflowsReadyForIndependentUse: number;
  totalRepeatUnassistedRuns: number;
  topFailureCategories: Array<{ category: BetaFailureCategory; count: number }>;
}

export const betaCompatibilityMatrix = {
  reviewedAt: "2026-08-09",
  runtimes: [
    { runtime: "Chrome extension", channel: "Chrome Stable", execution: "manual", status: "supported" },
    { runtime: "Hosted Chromium", channel: "Playwright-pinned Chromium", execution: "manual and scheduled", status: "supported" },
    { runtime: "Firefox and Safari", channel: "not qualified", execution: "none", status: "not-supported" },
  ],
  workflowCategories: betaTaskCategories.map((category) => ({ category, status: "beta" as const })),
  constraints: [
    "HTTPS target sites, plus explicit local demonstration origins, are supported.",
    "Workflows must use semantic locators and explicit outcome verification.",
    "Scheduled runs require a compatible managed browser session.",
    "CAPTCHA, broad autonomous browsing, desktop applications, and destructive or financial actions are not supported.",
  ],
} as const;
