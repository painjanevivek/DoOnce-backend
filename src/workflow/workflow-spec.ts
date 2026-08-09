import { formatValidationIssues, validateProtocolContract, type ValidationIssue } from "../contracts/validation.js";
import type {
  ElementTarget,
  LocatorCandidate,
  LocatorSpec,
  WorkflowActionKind,
  WorkflowInputDefinition,
  WorkflowSpec,
  WorkflowStep,
} from "../contracts/protocol.js";

export const workflowSpecFormat = "doonce.workflow-spec.v1" as const;
export const workflowSpecSchemaVersion = 1 as const;
export const workflowSpecActionKinds = ["navigate", "wait", "read", "select", "type", "download", "compare", "branch", "ask-approval", "stop"] as const satisfies readonly WorkflowActionKind[];
export const workflowSpecInputKinds = ["text", "date", "select"] as const;

export type WorkflowSpecActionKind = WorkflowActionKind;
export type WorkflowSpecInputKind = (typeof workflowSpecInputKinds)[number];
export type WorkflowSpecInput = WorkflowInputDefinition;
export type WorkflowSpecTarget = ElementTarget;
export type WorkflowSpecStep = WorkflowStep;
export type { LocatorCandidate, LocatorSpec, WorkflowSpec };

export type WorkflowSpecValidationResult =
  | { ok: true; value: WorkflowSpec }
  | { ok: false; errors: string[]; issues: ValidationIssue[] };

export function validateWorkflowSpec(input: unknown): WorkflowSpecValidationResult {
  const result = validateProtocolContract<WorkflowSpec>("WorkflowSpec", input);
  if (result.ok) return result;
  return { ok: false, errors: formatValidationIssues(result.errors), issues: result.errors };
}
