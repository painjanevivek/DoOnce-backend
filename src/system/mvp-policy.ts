import { isIP } from "node:net";
import type { WorkflowSpec } from "../contracts/protocol.js";
import type { WorkflowDraft } from "../workflow/schema.js";
import { qualifyAttendedWedge } from "../beta/wedge-policy.js";

export interface MvpPolicy {
  enabled: boolean;
  pilotOrigin?: string;
  pilotDomain?: string;
}

export class MvpPolicyError extends Error {}

export const disabledMvpPolicy: Readonly<MvpPolicy> = Object.freeze({ enabled: false });

export function mvpPolicyFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<MvpPolicy> {
  const rawMode = environment.DOONCE_MVP_MODE?.trim().toLowerCase();
  if (rawMode !== undefined && rawMode !== "true" && rawMode !== "false") {
    throw new Error("DOONCE_MVP_MODE must be true or false when configured.");
  }
  if (rawMode !== "true") return disabledMvpPolicy;

  const pilotOrigin = requirePublicHttpsOrigin(environment.DOONCE_PILOT_ALLOWED_ORIGIN);
  return Object.freeze({ enabled: true, pilotOrigin, pilotDomain: new URL(pilotOrigin).hostname });
}

export function assertMvpWorkflowAllowed(spec: WorkflowSpec, policy: Readonly<MvpPolicy>): void {
  if (!policy.enabled) return;
  const pilotDomain = requireConfiguredDomain(policy);
  if (spec.allowedDomains.length !== 1 || spec.allowedDomains[0] !== pilotDomain) {
    throw new MvpPolicyError("MVP workflows must use only the configured pilot origin.");
  }
  if (spec.inputs.length !== 0) {
    throw new MvpPolicyError("MVP report-download workflows cannot persist or replay typed inputs.");
  }

  const qualification = qualifyAttendedWedge("report-download", spec);
  if (!qualification.qualified) {
    throw new MvpPolicyError(`MVP publication requires the attended report-download pattern: ${qualification.issues.join(", ")}.`);
  }
  const downloadAssertions = [
    ...(spec.successCriteria ?? []),
    ...spec.steps.flatMap((step) => step.assertions ?? []),
  ].filter((assertion) => assertion.kind === "file-downloaded");
  const hasBoundedFileVerification = downloadAssertions.some((assertion) =>
    (assertion.minBytes ?? 0) > 0
    && (assertion.maxBytes ?? 0) >= (assertion.minBytes ?? 0)
    && (assertion.maxBytes ?? Number.MAX_SAFE_INTEGER) <= 100 * 1024 * 1024
    && (Boolean(assertion.fileNamePattern) || Boolean(assertion.contentTypes?.length)),
  );
  if (!hasBoundedFileVerification) throw new MvpPolicyError("MVP publication requires a filename or content-type rule and a bounded report size range.");
}

export function assertLegacyMvpWorkflowAllowed(draft: WorkflowDraft, policy: Readonly<MvpPolicy>): void {
  if (!policy.enabled) return;
  const pilotDomain = requireConfiguredDomain(policy);
  if (draft.allowedDomains.length !== 1 || draft.allowedDomains[0] !== pilotDomain || draft.steps.some((step) => step.domain !== pilotDomain)) {
    throw new MvpPolicyError("MVP workflows must use only the configured pilot origin.");
  }

  const permitted = new Set(["navigate", "wait", "read", "download", "compare", "branch", "stop"]);
  const downloadCount = draft.steps.filter((step) => step.kind === "download").length;
  const hasVerificationStep = draft.steps.some((step) => step.kind === "compare");
  if (draft.steps.some((step) => !permitted.has(step.kind)) || downloadCount !== 1 || !hasVerificationStep) {
    throw new MvpPolicyError("MVP publication requires one report download and an explicit comparison step.");
  }
}

function requireConfiguredDomain(policy: Readonly<MvpPolicy>): string {
  if (!policy.pilotDomain || !policy.pilotOrigin) throw new Error("Enabled MVP policy is missing its pilot origin.");
  return policy.pilotDomain;
}

function requirePublicHttpsOrigin(value: string | undefined): string {
  if (!value || value !== value.trim()) {
    throw new Error("DOONCE_PILOT_ALLOWED_ORIGIN is required in MVP mode and must be an exact HTTPS origin.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DOONCE_PILOT_ALLOWED_ORIGIN must be a valid HTTPS origin.");
  }

  if (
    url.protocol !== "https:"
    || url.origin !== value
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || url.port
    || !isPublicHostname(url.hostname)
  ) {
    throw new Error("DOONCE_PILOT_ALLOWED_ORIGIN must be one exact public HTTPS origin without a path, credentials, query, fragment, or custom port.");
  }
  return url.origin;
}

export function isExactPublicHttpsOrigin(value: string): boolean {
  try {
    requirePublicHttpsOrigin(value);
    return true;
  } catch {
    return false;
  }
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return false;
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return !isPrivateIpv4(normalized);
  if (ipVersion === 6) return !isPrivateIpv6(normalized);
  return normalized.includes(".");
}

function isPrivateIpv4(hostname: string): boolean {
  const [first = 0, second = 0] = hostname.split(".").map(Number);
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
}
