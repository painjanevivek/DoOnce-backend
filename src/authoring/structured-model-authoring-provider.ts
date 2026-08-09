import { buildTextWorkflowPrompt, textWorkflowPromptVersion, textWorkflowSystemPrompt } from "./prompts/text-workflow-v1.js";
import type { AuthoringProvider, AuthoringProviderInput, AuthoringProviderResult, StructuredModelGateway, WorkflowAuthoringEnvelope } from "./authoring-provider.js";

export class StructuredModelAuthoringProvider implements AuthoringProvider {
  public readonly identity: { provider: string; model: string; promptVersion: string };
  public constructor(private readonly gateway: StructuredModelGateway, providerName: string, modelName: string) {
    this.identity = { provider: providerName, model: modelName, promptVersion: textWorkflowPromptVersion };
  }

  public async generate(input: AuthoringProviderInput): Promise<AuthoringProviderResult> {
    const response = await this.gateway.generateJson({ system: textWorkflowSystemPrompt, prompt: buildTextWorkflowPrompt(input), schemaName: "WorkflowAuthoringCandidate", attempt: input.attempt });
    const envelope = parseEnvelope(response.value);
    return { ...envelope, candidate: envelope.workflow, metadata: { ...this.identity, model: response.model }, usage: { promptTokens: response.promptTokens, completionTokens: response.completionTokens, estimatedCostMicrousd: response.estimatedCostMicrousd } };
  }
}

function parseEnvelope(value: unknown): WorkflowAuthoringEnvelope {
  if (!isRecord(value)) throw new Error("The authoring provider returned an invalid envelope.");
  const workflow = value.workflow;
  return {
    ...(workflow === undefined ? {} : { workflow: workflow as NonNullable<WorkflowAuthoringEnvelope["workflow"]> }),
    questions: strings(value.questions, "questions"),
    assumptions: strings(value.assumptions, "assumptions"),
    unsupportedRequirements: strings(value.unsupportedRequirements, "unsupported requirements"),
    stepConfidence: confidence(value.stepConfidence),
  };
}
function strings(value: unknown, label: string): string[] { if (!Array.isArray(value) || value.length > 50 || value.some((item) => typeof item !== "string" || item.length < 1 || item.length > 1000)) throw new Error(`The provider ${label} are invalid.`); return value; }
function confidence(value: unknown): WorkflowAuthoringEnvelope["stepConfidence"] { if (!Array.isArray(value) || value.length > 500) throw new Error("The provider confidence data is invalid."); return value.map((item) => { if (!isRecord(item) || typeof item.stepId !== "string" || typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1 || typeof item.rationale !== "string" || item.rationale.length > 1000) throw new Error("The provider confidence data is invalid."); return { stepId: item.stepId, confidence: item.confidence, rationale: item.rationale }; }); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
