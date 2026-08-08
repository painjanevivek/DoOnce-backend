import { evaluateActionCapabilities } from "../execution/action-capabilities.js";
import {
  validateWorkflowDraft,
  type WorkflowDraft,
  type WorkflowStep,
} from "./schema.js";

export type PublishedWorkflowVersion = Readonly<Omit<WorkflowDraft, "allowedDomains" | "steps">> & {
  readonly allowedDomains: readonly string[];
  readonly steps: readonly Readonly<WorkflowStep>[];
  readonly status: "active";
  readonly publishedAt: string;
};

export type PublishWorkflowResult =
  | { ok: true; value: PublishedWorkflowVersion }
  | { ok: false; errors: string[] };

export function publishWorkflowDraft(input: unknown, publishedAt: string): PublishWorkflowResult {
  const validation = validateWorkflowDraft(input);
  if (!validation.ok) return validation;

  const capabilityErrors = validation.value.steps.flatMap((step, index) => {
    const decision = evaluateActionCapabilities({ action: step.kind });
    return decision.verdict === "allow"
      ? []
      : [`Step ${index + 1} cannot be published yet: ${decision.reason}`];
  });
  if (capabilityErrors.length > 0) return { ok: false, errors: capabilityErrors };

  return {
    ok: true,
    value: freezePublishedWorkflow(validation.value, publishedAt),
  };
}

export function createNextDraft(version: PublishedWorkflowVersion): WorkflowDraft {
  return {
    id: version.id,
    version: version.version + 1,
    tenantId: version.tenantId,
    ownerId: version.ownerId,
    title: version.title,
    allowedDomains: [...version.allowedDomains],
    steps: version.steps.map((step) => ({ ...step })),
  };
}

function freezePublishedWorkflow(workflow: WorkflowDraft, publishedAt: string): PublishedWorkflowVersion {
  const steps = workflow.steps.map((step) => Object.freeze({ ...step }));
  return Object.freeze({
    ...workflow,
    allowedDomains: Object.freeze([...workflow.allowedDomains]),
    steps: Object.freeze(steps),
    status: "active" as const,
    publishedAt,
  });
}
