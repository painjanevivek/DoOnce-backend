/** @deprecated Import from execution/action-capabilities instead. */
export {
  executableActionKinds,
  prohibitedActionKinds,
  isActionKind,
  isSensitiveFieldKind,
  type ActionKind,
  type ExecutableActionKind,
  type ProhibitedActionKind,
  type RiskClass,
  type SensitiveFieldKind,
} from "../execution/action-capabilities.js";

import {
  evaluateActionCapabilities,
  type ActionCapabilitiesInput,
  type CapabilityDecision,
  type CapabilityVerdict,
} from "../execution/action-capabilities.js";

/** @deprecated Use ActionCapabilitiesInput. */
export type ActionPolicyInput = ActionCapabilitiesInput;
/** @deprecated Use CapabilityVerdict. */
export type PolicyVerdict = CapabilityVerdict;
/** @deprecated Use CapabilityDecision. */
export type PolicyDecision = CapabilityDecision;

/** @deprecated Use evaluateActionCapabilities. */
export function evaluateActionPolicy(input: ActionPolicyInput): PolicyDecision {
  const decision = evaluateActionCapabilities(input);
  return { ...decision, ruleId: decision.ruleId.replace(/^capability\./, "policy.") };
}
