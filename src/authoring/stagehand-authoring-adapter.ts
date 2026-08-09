import { textWorkflowPromptVersion } from "./prompts/text-workflow-v1.js";
import type { AuthoringProvider, AuthoringProviderInput, AuthoringProviderResult, WorkflowAuthoringEnvelope } from "./authoring-provider.js";

export interface StagehandObservationClient {
  plan(input: { task: string; startingUrl: string; availableInputs: AuthoringProviderInput["availableInputs"]; capabilities: AuthoringProviderInput["executorCapabilities"] }): Promise<{ envelope: WorkflowAuthoringEnvelope; model: string; usage?: Partial<AuthoringProviderResult["usage"]> }>;
}

export class StagehandAuthoringAdapter implements AuthoringProvider {
  public readonly identity = { provider: "stagehand", model: "stagehand-configured-model", promptVersion: textWorkflowPromptVersion };
  public constructor(private readonly client: StagehandObservationClient) {}
  public async generate(input: AuthoringProviderInput): Promise<AuthoringProviderResult> {
    if (!input.startingUrl) return { questions: ["Which page should the browser open first?"], assumptions: [], unsupportedRequirements: [], stepConfidence: [], metadata: this.identity, usage: { promptTokens: 0, completionTokens: 0, estimatedCostMicrousd: 0 } };
    const planned = await this.client.plan({ task: input.taskDescription, startingUrl: input.startingUrl, availableInputs: input.availableInputs, capabilities: input.executorCapabilities });
    return { candidate: planned.envelope.workflow, questions: planned.envelope.questions, assumptions: planned.envelope.assumptions, unsupportedRequirements: planned.envelope.unsupportedRequirements, stepConfidence: planned.envelope.stepConfidence, metadata: { ...this.identity, model: planned.model }, usage: { promptTokens: planned.usage?.promptTokens ?? 0, completionTokens: planned.usage?.completionTokens ?? 0, estimatedCostMicrousd: planned.usage?.estimatedCostMicrousd ?? 0 } };
  }
}
