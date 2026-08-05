export const executableActionKinds = [
  "navigate",
  "wait",
  "read",
  "select",
  "type",
  "upload",
  "download",
  "compare",
  "ask-approval",
  "stop",
] as const;

export const prohibitedActionKinds = [
  "submit",
  "delete",
  "payment",
  "credential",
  "otp",
] as const;

export type ExecutableActionKind = (typeof executableActionKinds)[number];
export type ProhibitedActionKind = (typeof prohibitedActionKinds)[number];
export type ActionKind = ExecutableActionKind | ProhibitedActionKind | "unknown";
export type SensitiveFieldKind = "password" | "otp" | "payment" | "security-code";
export type PolicyVerdict = "allow" | "needs-approval" | "blocked" | "paused";
export type RiskClass = "read-only" | "reversible-write" | "external" | "irreversible" | "unknown";

export interface ActionPolicyInput {
  action: ActionKind;
  fieldKind?: SensitiveFieldKind;
}

export interface PolicyDecision {
  verdict: PolicyVerdict;
  risk: RiskClass;
  ruleId: string;
  reason: string;
}

const sensitiveFieldKinds = new Set<SensitiveFieldKind>([
  "password",
  "otp",
  "payment",
  "security-code",
]);

export function isActionKind(value: unknown): value is ActionKind {
  return typeof value === "string" && [...executableActionKinds, ...prohibitedActionKinds, "unknown"].includes(value as ActionKind);
}

export function isSensitiveFieldKind(value: unknown): value is SensitiveFieldKind {
  return typeof value === "string" && sensitiveFieldKinds.has(value as SensitiveFieldKind);
}

export function evaluateActionPolicy(input: ActionPolicyInput): PolicyDecision {
  if (input.fieldKind && sensitiveFieldKinds.has(input.fieldKind)) {
    return {
      verdict: "blocked",
      risk: "irreversible",
      ruleId: "policy.sensitive-input",
      reason: "Passwords, OTPs, payment details and security codes cannot be recorded or executed.",
    };
  }

  switch (input.action) {
    case "navigate":
    case "wait":
    case "read":
    case "download":
    case "compare":
      return {
        verdict: "allow",
        risk: "read-only",
        ruleId: "policy.read-only",
        reason: "This read-only action may run on an approved workflow domain.",
      };
    case "select":
    case "type":
    case "upload":
      return {
        verdict: "needs-approval",
        risk: "reversible-write",
        ruleId: "policy.reversible-write",
        reason: "This reversible write requires a preview and explicit approval before execution.",
      };
    case "ask-approval":
      return {
        verdict: "paused",
        risk: "external",
        ruleId: "policy.approval-checkpoint",
        reason: "The workflow must wait for an explicit user approval event.",
      };
    case "stop":
      return {
        verdict: "paused",
        risk: "unknown",
        ruleId: "policy.explicit-stop",
        reason: "The workflow includes an explicit stop checkpoint.",
      };
    case "submit":
    case "delete":
    case "payment":
    case "credential":
    case "otp":
      return {
        verdict: "blocked",
        risk: "irreversible",
        ruleId: "policy.prohibited-action",
        reason: "Submission, deletion, financial and credential actions are prohibited in version 1.",
      };
    case "unknown":
      return {
        verdict: "paused",
        risk: "unknown",
        ruleId: "policy.unknown-action",
        reason: "DoOnce pauses when an action cannot be classified safely.",
      };
  }
}
