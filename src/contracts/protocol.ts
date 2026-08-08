// Generated contract surface for contracts/protocol.v1.schema.json. Do not add runtime logic here.
export type SchemaVersion = 1;
export type ExecutorKind = "extension" | "hosted-browser";
export type WorkflowActionKind = "navigate" | "wait" | "read" | "select" | "type" | "download" | "compare" | "ask-approval" | "stop";
export type LocatorStrategy = "id" | "capture-id" | "role" | "label" | "text";

export interface LocatorCandidate { strategy: LocatorStrategy; value: string; confidence: number }
export interface LocatorSpec { schemaVersion: SchemaVersion; primary: LocatorCandidate; fallbacks: LocatorCandidate[] }
export interface PageTarget { domain: string; path: string }
export interface ElementTarget extends PageTarget { locator: LocatorSpec }
export interface WorkflowInputDefinition { name: string; label: string; kind: "text" | "date" | "select"; required: boolean; options?: string[] }

interface WorkflowStepBase { id: string; action: WorkflowActionKind; name: string; expectedOutcome: string }
export interface NavigateStep extends WorkflowStepBase { action: "navigate"; target: PageTarget }
export interface WaitStep extends WorkflowStepBase { action: "wait"; target: ElementTarget; timeoutMs: number }
export interface ReadStep extends WorkflowStepBase { action: "read"; target: ElementTarget; outputName: string }
export interface SelectStep extends WorkflowStepBase { action: "select"; target: ElementTarget; inputName: string }
export interface TypeStep extends WorkflowStepBase { action: "type"; target: ElementTarget; inputName: string }
export interface DownloadStep extends WorkflowStepBase { action: "download"; target: ElementTarget }
export interface CompareStep extends WorkflowStepBase { action: "compare"; target: ElementTarget; operator: "equals" | "contains" | "matches"; expected: string }
export interface ApprovalStep extends WorkflowStepBase { action: "ask-approval"; prompt: string }
export interface StopStep extends WorkflowStepBase { action: "stop"; reason: string }
export type WorkflowStep = NavigateStep | WaitStep | ReadStep | SelectStep | TypeStep | DownloadStep | CompareStep | ApprovalStep | StopStep;

export interface WorkflowSpec {
  schemaVersion: SchemaVersion;
  format: "doonce.workflow-spec.v1";
  title: string;
  description?: string;
  allowedDomains: string[];
  inputs: WorkflowInputDefinition[];
  steps: WorkflowStep[];
}

export interface RuntimeCapabilities {
  schemaVersion: SchemaVersion;
  executor: ExecutorKind;
  actions: WorkflowActionKind[];
  maxSteps: number;
  supportsDownloads: boolean;
}

export interface RecordedAction {
  schemaVersion: SchemaVersion;
  id: string;
  sequence: number;
  occurredAt: string;
  origin: string;
  path: string;
  eventKind: "click" | "change" | "input" | "navigate" | "download";
  locator: LocatorSpec;
  actionHint?: "download";
}

export interface CaptureSession {
  schemaVersion: SchemaVersion;
  format: "doonce.capture-session.v1";
  id: string;
  startedAt: string;
  endedAt?: string;
  status: "recording" | "paused" | "completed";
  approvedOrigins: string[];
  actions: RecordedAction[];
}

export interface RunRequest {
  schemaVersion: SchemaVersion;
  runId: string;
  workflowId: string;
  workflowVersion: number;
  executor: ExecutorKind;
  inputs: Record<string, string>;
  requestedAt: string;
}

export interface StepResult {
  schemaVersion: SchemaVersion;
  stepId: string;
  status: "verified" | "paused" | "failed" | "skipped";
  reasonCode?: string;
  startedAt: string;
  finishedAt: string;
}

export interface RunResult {
  schemaVersion: SchemaVersion;
  format: "doonce.run-result.v1";
  runId: string;
  workflowId: string;
  workflowVersion: number;
  status: "completed" | "paused" | "failed" | "cancelled";
  reasonCode?: string;
  stepResults: StepResult[];
  startedAt: string;
  finishedAt: string;
}

export type RepairOperation =
  | { op: "replace-locator"; stepId: string; reason: string; locator: LocatorSpec }
  | { op: "update-expected-outcome"; stepId: string; reason: string; expectedOutcome: string };
export interface RepairProposal { schemaVersion: SchemaVersion; format: "doonce.repair-proposal.v1"; id: string; workflowId: string; baseVersion: number; createdAt: string; operations: RepairOperation[] }

export type ExtensionMessage =
  | { schemaVersion: SchemaVersion; type: "capture.start"; sessionId: string }
  | { schemaVersion: SchemaVersion; type: "capture.stop"; sessionId: string }
  | { schemaVersion: SchemaVersion; type: "capture.action"; action: RecordedAction }
  | { schemaVersion: SchemaVersion; type: "run.start"; request: RunRequest }
  | { schemaVersion: SchemaVersion; type: "run.result"; result: RunResult };

export interface ApiError { schemaVersion: SchemaVersion; error: string; code?: string; field?: string }
