import type { ExecutorKind, WorkflowActionKind, WorkflowSpec } from "../contracts/protocol.js";

export type TriggerKind = "manual" | "api" | "webhook" | "schedule";
export type SessionLocation = "user-browser" | "managed";

export interface ExecutionRoute {
  executor: ExecutorKind;
  triggerKind: TriggerKind;
  sessionLocation: SessionLocation;
  reason: string;
}

export class ExecutionRoutingError extends Error {}

const hostedActions = new Set<WorkflowActionKind>([
  "navigate",
  "wait",
  "read",
  "select",
  "type",
  "download",
  "compare",
  "branch",
  "stop",
]);

export function routeExecution(
  workflow: WorkflowSpec,
  request: { triggerKind: TriggerKind; sessionLocation: SessionLocation },
): ExecutionRoute {
  if (request.sessionLocation === "user-browser") {
    if (request.triggerKind === "schedule" || request.triggerKind === "webhook") {
      throw new ExecutionRoutingError("Background triggers require a managed browser session because the local extension may be offline.");
    }
    return {
      executor: "extension",
      ...request,
      reason: "This run needs the signed-in browser on this device.",
    };
  }

  const unsupported = [...new Set(workflow.steps.map((step) => step.action).filter((action) => !hostedActions.has(action)))];
  if (unsupported.length > 0) {
    throw new ExecutionRoutingError(`Managed execution does not support: ${unsupported.join(", ")}.`);
  }
  if (workflow.steps.length > 500) {
    throw new ExecutionRoutingError("Managed execution supports at most 500 steps per run.");
  }

  return {
    executor: "hosted-browser",
    ...request,
    reason: "This run is compatible with an isolated managed browser.",
  };
}
