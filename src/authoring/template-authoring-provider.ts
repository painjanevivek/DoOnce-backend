import { randomUUID } from "node:crypto";
import type { ElementTarget, WorkflowAssertion, WorkflowSpec, WorkflowStep } from "../contracts/protocol.js";
import type { AuthoringProvider, AuthoringProviderInput, AuthoringProviderResult } from "./authoring-provider.js";
import { textWorkflowPromptVersion } from "./prompts/text-workflow-v1.js";

export class TemplateAuthoringProvider implements AuthoringProvider {
  public readonly identity = { provider: "doonce", model: "template-rules-v1", promptVersion: textWorkflowPromptVersion };

  public async generate(input: AuthoringProviderInput): Promise<AuthoringProviderResult> {
    const usage = { promptTokens: approximateTokens(input.taskDescription), completionTokens: 0, estimatedCostMicrousd: 0 };
    if (!input.startingUrl) return response(undefined, ["Which page should the browser open first?"], [], [], [], usage);
    const start = new URL(input.startingUrl);
    const description = input.taskDescription.toLowerCase();
    const wantsDownload = /\b(download|export|csv|spreadsheet)\b/.test(description);
    const wantsForm = /\b(fill|enter|form|filter|search)\b/.test(description);
    const wantsRead = /\b(extract|read|copy|collect|table)\b/.test(description);
    const questions: string[] = [];
    const assumptions = [`The task starts at ${start.origin}${start.pathname}.`];
    const unsupportedRequirements: string[] = [];
    if (/\bcopy\b/.test(description)) unsupportedRequirements.push("Using an extracted browser value as an input on another site needs an explicit output-binding step that WorkflowSpec v1 does not yet provide.");
    if (/\b(optional modal|if a modal|when a modal)\b/.test(description)) unsupportedRequirements.push("Conditional branching on whether a page element exists is not available in WorkflowSpec v1.");
    if (wantsForm && input.availableInputs.length === 0) questions.push("Which values should become reusable workflow inputs?");
    if (!wantsDownload && !wantsForm && !wantsRead) questions.push("What observable browser action should happen after the starting page opens?");
    if (unsupportedRequirements.length > 0 || questions.length > 0) return response(undefined, questions, assumptions, unsupportedRequirements, [], usage);

    const steps: WorkflowStep[] = [];
    const confidence: AuthoringProviderResult["stepConfidence"] = [];
    add(steps, confidence, { id: randomUUID(), action: "navigate", name: "Open the starting page", expectedOutcome: "The requested page opens", target: { domain: start.hostname, path: `${start.pathname}${start.search}` } }, .96, "The starting URL was provided explicitly.");
    if (wantsForm) {
      for (const definition of input.availableInputs) {
        const target = elementTarget(start, "label", definition.label, .62);
        const action = definition.kind === "select" ? "select" : "type";
        add(steps, confidence, { id: randomUUID(), action, name: `${action === "select" ? "Choose" : "Enter"} ${definition.label}`, expectedOutcome: `${definition.label} is set`, inputName: definition.name, target }, .62, "The field label is inferred from the supplied workflow input and must be reviewed.");
      }
    }
    if (wantsRead) {
      const target = elementTarget(start, "role", "table", .55);
      add(steps, confidence, { id: randomUUID(), action: "read", name: "Read the result table", expectedOutcome: "The table content is available as workflow output", outputName: "table_result", target }, .55, "The task mentions a table, but the exact page locator needs browser review.");
    }
    if (wantsDownload) {
      const label = description.includes("export") ? "Export" : "Download";
      const target = elementTarget(start, "text", label, .58);
      const assertion: WorkflowAssertion = { id: randomUUID(), name: "A file is downloaded", kind: "file-downloaded", minBytes: 1 };
      add(steps, confidence, { id: randomUUID(), action: "download", name: `${label} the result`, expectedOutcome: "The requested file is downloaded", target, assertions: [assertion] }, .58, "The action text is inferred from the task and must be confirmed in the visual editor.");
    }
    const workflow: WorkflowSpec = { schemaVersion: 1, format: "doonce.workflow-spec.v1", title: title(input.taskDescription), description: input.taskDescription.trim(), allowedDomains: [start.hostname], inputs: [...input.availableInputs], steps };
    usage.completionTokens = approximateTokens(JSON.stringify(workflow));
    return response(workflow, [], assumptions, [], confidence, usage);
  }
}

function response(candidate: WorkflowSpec | undefined, questions: string[], assumptions: string[], unsupportedRequirements: string[], stepConfidence: AuthoringProviderResult["stepConfidence"], usage: AuthoringProviderResult["usage"]): AuthoringProviderResult {
  return { ...(candidate ? { candidate } : {}), questions, assumptions, unsupportedRequirements, stepConfidence, metadata: { provider: "doonce", model: "template-rules-v1", promptVersion: textWorkflowPromptVersion }, usage };
}
function elementTarget(url: URL, strategy: "label" | "role" | "text", value: string, confidence: number): ElementTarget { return { domain: url.hostname, path: url.pathname, locator: { schemaVersion: 1, primary: { strategy, value, confidence }, fallbacks: [] } }; }
function add(steps: WorkflowStep[], confidence: AuthoringProviderResult["stepConfidence"], step: WorkflowStep, score: number, rationale: string): void { steps.push(step); confidence.push({ stepId: step.id, confidence: score, rationale }); }
function approximateTokens(value: string): number { return Math.max(1, Math.ceil(value.length / 4)); }
function title(description: string): string { const clean = description.trim().replace(/\s+/g, " "); const sentence = clean.split(/[.!?]/, 1)[0] ?? "Generated browser workflow"; return `${sentence.slice(0, 1).toUpperCase()}${sentence.slice(1, 120)}`; }
