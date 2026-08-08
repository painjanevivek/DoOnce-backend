import { readFileSync } from "node:fs";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { WorkflowSpec } from "./protocol.js";

export const protocolContractNames = [
  "WorkflowSpec", "LocatorSpec", "WorkflowInputDefinition", "RuntimeCapabilities", "CaptureSession", "RecordedAction",
  "RunRequest", "StepResult", "RunResult", "RepairProposal", "ExtensionMessage", "ApiError",
] as const;

export type ProtocolContractName = (typeof protocolContractNames)[number];
export interface ValidationIssue { code: string; path: string; message: string }
export type ContractValidationResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationIssue[] };

const protocolSchema = JSON.parse(readFileSync(new URL("../../contracts/protocol.v1.schema.json", import.meta.url), "utf8")) as object;
const schemaId = "https://doonce.dev/schemas/protocol.v1.schema.json";
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);
ajv.addSchema(protocolSchema, schemaId);

const validators = new Map<ProtocolContractName, ValidateFunction>();
for (const name of protocolContractNames) validators.set(name, ajv.compile({ $ref: `${schemaId}#/$defs/${name}` }));

export function validateProtocolContract<T>(name: ProtocolContractName, input: unknown): ContractValidationResult<T> {
  const validator = validators.get(name);
  if (!validator) return { ok: false, errors: [{ code: "contract.unknown", path: "$", message: `The ${name} contract is not registered.` }] };
  if (!validator(input)) return { ok: false, errors: mapValidationErrors(validator.errors ?? []) };
  if (name === "WorkflowSpec") {
    const semanticErrors = validateWorkflowSemantics(input as WorkflowSpec);
    if (semanticErrors.length > 0) return { ok: false, errors: semanticErrors };
  }
  return { ok: true, value: input as T };
}

export function formatValidationIssues(errors: readonly ValidationIssue[]): string[] {
  return errors.map((error) => error.message);
}

function validateWorkflowSemantics(workflow: WorkflowSpec): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const inputNames = new Set<string>();
  for (const [index, input] of workflow.inputs.entries()) {
    if (inputNames.has(input.name)) errors.push(issue("workflow.input_duplicate", `/inputs/${index}/name`, `Input ${index + 1} repeats the name "${input.name}".`));
    inputNames.add(input.name);
  }
  const stepIds = new Set<string>();
  for (const [index, step] of workflow.steps.entries()) {
    if (stepIds.has(step.id)) errors.push(issue("workflow.step_id_duplicate", `/steps/${index}/id`, `Step ${index + 1} needs a unique identifier.`));
    stepIds.add(step.id);
    if ("target" in step && !workflow.allowedDomains.includes(step.target.domain)) errors.push(issue("workflow.domain_not_allowed", `/steps/${index}/target/domain`, `Step ${index + 1} uses a domain that is not in this workflow's approved domain list.`));
    if ((step.action === "type" || step.action === "select") && !inputNames.has(step.inputName)) errors.push(issue("workflow.input_missing", `/steps/${index}/inputName`, `Step ${index + 1} needs a declared workflow input.`));
  }
  return errors;
}

function mapValidationErrors(errors: readonly ErrorObject[]): ValidationIssue[] {
  const mapped = errors.map((error) => {
    const path = error.instancePath || "$";
    const step = stepNumber(path);
    const subject = step ? `Step ${step}` : humanPath(path);
    if (error.keyword === "required") {
      const field = String((error.params as { missingProperty?: unknown }).missingProperty ?? "field");
      return issue("contract.required", path, step && field === "locator" ? `${subject} needs a button or field target.` : `${subject} needs ${humanField(field)}.`);
    }
    if (error.keyword === "additionalProperties" || error.keyword === "unevaluatedProperties") {
      const field = String((error.params as { additionalProperty?: unknown; unevaluatedProperty?: unknown }).additionalProperty ?? (error.params as { unevaluatedProperty?: unknown }).unevaluatedProperty ?? "field");
      return issue("contract.unknown_field", path, `${subject} contains the unsupported field "${field}".`);
    }
    if (error.keyword === "format") return issue("contract.format", path, `${subject} has an invalid ${humanField(lastSegment(path))}.`);
    if (error.keyword === "oneOf") return issue("contract.variant", path, `${subject} does not match the selected action type.`);
    if (error.keyword === "const" || error.keyword === "enum") return issue("contract.value", path, `${subject} has an unsupported ${humanField(lastSegment(path))}.`);
    return issue(`contract.${error.keyword}`, path, `${subject} is invalid: ${error.message ?? "check this value"}.`);
  });
  return deduplicate(mapped);
}

function issue(code: string, path: string, message: string): ValidationIssue { return { code, path, message }; }

function stepNumber(path: string): number | undefined {
  const match = /^\/steps\/(\d+)/.exec(path);
  return match?.[1] === undefined ? undefined : Number(match[1]) + 1;
}

function humanPath(path: string): string {
  if (path === "$" || path === "") return "This object";
  return lastSegment(path).replaceAll("~1", "/").replaceAll("~0", "~").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function lastSegment(path: string): string { return path.split("/").at(-1) || "value"; }
function humanField(field: string): string { return field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(); }

function deduplicate(errors: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.code}:${error.path}:${error.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
