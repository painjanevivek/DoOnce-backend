// Generated contract surface for contracts/protocol.v1.schema.json. Do not add runtime logic here.
export type SchemaVersion = 1;
export type ExecutorKind = "extension" | "hosted-browser";
export type WorkflowActionKind = "navigate" | "wait" | "read" | "select" | "type" | "download" | "compare" | "ask-approval" | "stop";
export type LocatorStrategy = "id" | "capture-id" | "role" | "label" | "text";

export interface LocatorCandidate { strategy: LocatorStrategy; value: string; confidence: number }
export interface LocatorSpec { schemaVersion: SchemaVersion; primary: LocatorCandidate; fallbacks: LocatorCandidate[] }
export interface PageState { capturedAt: string; origin: string; path: string; urlPattern: string; navigationId: string; titleHint?: string; domFingerprint?: string }
export interface ElementEvidence {
  role?: string; accessibleName?: string; testId?: string; tagName: string; inputType?: string; textHint?: string; cssCandidate?: string;
  framePath: string[]; domFingerprint: string; visibility: { inViewport: boolean; ratio: number; viewportWidth: number; viewportHeight: number }; locator: LocatorSpec;
}
export interface CapturedValue { classification: "literal-candidate" | "variable-candidate" | "secret-placeholder" | "intentionally-omitted"; placeholder: string; length: number }
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
  eventKind: "click" | "change" | "input" | "select" | "toggle" | "submit" | "navigate" | "reload" | "redirect" | "download" | "download-start" | "download-complete" | "tab-create" | "tab-switch" | "wait-transition";
  locator?: LocatorSpec;
  actionHint?: "download";
  target?: ElementEvidence;
  value?: CapturedValue;
  before?: PageState;
  after?: PageState;
  tabId?: number;
  frameId?: number;
}

export interface CaptureSession {
  schemaVersion: SchemaVersion;
  format: "doonce.capture-session.v1";
  id: string;
  startedAt: string;
  endedAt?: string;
  status: "recording" | "paused" | "stopped" | "synchronizing" | "finalized" | "discarded" | "completed";
  approvedOrigins: string[];
  actions: RecordedAction[];
  extensionVersion?: string;
  updatedAt?: string;
  syncCursor?: number;
  retryCount?: number;
}

export type CaptureCapability = "semantic-elements" | "frames" | "shadow-dom" | "navigation" | "downloads" | "tabs" | "offline-buffer";
export interface CaptureHandshake { schemaVersion: SchemaVersion; extensionVersion: string; capabilities: CaptureCapability[]; maxBatchSize: number }
export interface CaptureSyncRequest { schemaVersion: SchemaVersion; sessionId: string; batchId: string; cursor: number; actions: RecordedAction[]; final: boolean }
export interface CaptureSyncAck { schemaVersion: SchemaVersion; sessionId: string; batchId: string; acceptedThrough: number; status: "accepted" | "duplicate" | "finalized"; retryAfterMs?: number }

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
