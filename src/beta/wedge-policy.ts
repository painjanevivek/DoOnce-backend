import type { WorkflowActionKind, WorkflowSpec } from "../contracts/protocol.js";
import { attendedWedgeCategories } from "./beta-types.js";

const commonReadActions = new Set<WorkflowActionKind>(["navigate", "wait", "read", "compare", "branch", "stop"]);

export interface WedgeQualification {
  category: (typeof attendedWedgeCategories)[number];
  qualified: boolean;
  issues: string[];
}

export function qualifyAttendedWedge(
  category: (typeof attendedWedgeCategories)[number],
  spec: WorkflowSpec,
): WedgeQualification {
  const issues: string[] = [];
  const actions = spec.steps.map((step) => step.action);
  const allowedActions = category === "report-download"
    ? new Set<WorkflowActionKind>([...commonReadActions, "download"])
    : commonReadActions;

  if (spec.allowedDomains.length !== 1) issues.push("wedge.exactly-one-domain-required");
  if (actions.some((action) => !allowedActions.has(action))) issues.push("wedge.action-not-supported");
  if (category === "report-download" && actions.filter((action) => action === "download").length !== 1) {
    issues.push("wedge.single-download-required");
  }
  if (category === "table-extraction" && !actions.includes("read")) issues.push("wedge.read-step-required");
  if (!hasDeclaredVerification(spec)) issues.push("wedge.verification-required");

  return { category, qualified: issues.length === 0, issues };
}

function hasDeclaredVerification(spec: WorkflowSpec): boolean {
  return Boolean(spec.successCriteria?.length)
    || spec.steps.some((step) => Boolean(step.assertions?.length) || step.action === "compare");
}
