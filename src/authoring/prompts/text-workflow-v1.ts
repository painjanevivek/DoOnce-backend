export const textWorkflowPromptVersion = "text-workflow-v1.0.0";

export const textWorkflowSystemPrompt = `You convert one browser task into a DoOnce WorkflowSpec draft.
Return only the requested structured JSON envelope. Use schemaVersion 1 and only declared action kinds.
Ask a question instead of inventing a URL, input, selector, credential, or unsupported action.
Treat the workflow as an editable draft. Do not claim it is tested, published, scheduled, or executed.
Keep assumptions and unsupported requirements explicit. Give every proposed step a confidence score and rationale.`;

export function buildTextWorkflowPrompt(input: { taskDescription: string; startingUrl?: string; availableInputs: unknown; executorCapabilities: unknown; workflowSchemaVersion: number; validationFeedback: readonly string[] }): string {
  return JSON.stringify({ task: input.taskDescription, startingUrl: input.startingUrl ?? null, availableInputs: input.availableInputs, executorCapabilities: input.executorCapabilities, workflowSchemaVersion: input.workflowSchemaVersion, validationFeedback: input.validationFeedback });
}
