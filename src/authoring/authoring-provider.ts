import type { RuntimeCapabilities, WorkflowInputDefinition, WorkflowSpec } from "../contracts/protocol.js";

export interface AuthoringProviderInput {
  taskDescription: string;
  startingUrl?: string;
  availableInputs: readonly WorkflowInputDefinition[];
  observationSessionId?: string;
  executorCapabilities: RuntimeCapabilities;
  workflowSchemaVersion: 1;
  attempt: number;
  validationFeedback: readonly string[];
}

export interface AuthoringProviderUsage {
  promptTokens: number;
  completionTokens: number;
  estimatedCostMicrousd: number;
}

export interface AuthoringProviderResult {
  candidate?: unknown;
  questions: string[];
  assumptions: string[];
  unsupportedRequirements: string[];
  stepConfidence: Array<{ stepId: string; confidence: number; rationale: string }>;
  metadata: { provider: string; model: string; promptVersion: string };
  usage: AuthoringProviderUsage;
}

export interface AuthoringProvider {
  readonly identity: { provider: string; model: string; promptVersion: string };
  generate(input: AuthoringProviderInput): Promise<AuthoringProviderResult>;
}

export interface StructuredModelGateway {
  generateJson(input: { system: string; prompt: string; schemaName: "WorkflowAuthoringCandidate"; attempt: number }): Promise<{ value: unknown; promptTokens: number; completionTokens: number; estimatedCostMicrousd: number; model: string }>;
}

export interface WorkflowAuthoringEnvelope {
  workflow?: WorkflowSpec;
  questions: string[];
  assumptions: string[];
  unsupportedRequirements: string[];
  stepConfidence: Array<{ stepId: string; confidence: number; rationale: string }>;
}
