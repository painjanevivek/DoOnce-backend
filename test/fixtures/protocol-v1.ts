import type { ProtocolContractName } from "../../src/contracts/validation.js";

const workflowId = "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
const runId = "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
const stepId = "c0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
const sessionId = "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
const timestamp = "2026-08-09T00:00:00.000Z";
const locator = { schemaVersion: 1, primary: { strategy: "capture-id", value: "download-report", confidence: 1 }, fallbacks: [] };
const action = { schemaVersion: 1, id: stepId, sequence: 0, occurredAt: timestamp, origin: "https://reports.example.test", path: "/reports", eventKind: "click", locator, actionHint: "download" };
const workflowSpec = { schemaVersion: 1, format: "doonce.workflow-spec.v1", title: "Download report", allowedDomains: ["reports.example.test"], inputs: [], steps: [{ id: stepId, action: "download", name: "Download report", expectedOutcome: "The report downloads.", target: { domain: "reports.example.test", path: "/reports", locator } }] };
const stepResult = { schemaVersion: 1, stepId, status: "verified", startedAt: timestamp, finishedAt: timestamp };
const runRequest = { schemaVersion: 1, runId, workflowId, workflowVersion: 1, executor: "extension", inputs: {}, requestedAt: timestamp };
const runResult = { schemaVersion: 1, format: "doonce.run-result.v1", runId, workflowId, workflowVersion: 1, status: "completed", stepResults: [stepResult], startedAt: timestamp, finishedAt: timestamp };

export const validProtocolFixtures: Record<ProtocolContractName, unknown> = {
  WorkflowSpec: workflowSpec,
  LocatorSpec: locator,
  WorkflowInputDefinition: { name: "report_date", label: "Report date", kind: "date", required: true },
  RuntimeCapabilities: { schemaVersion: 1, executor: "extension", actions: ["navigate", "download"], maxSteps: 100, supportsDownloads: true },
  CaptureSession: { schemaVersion: 1, format: "doonce.capture-session.v1", id: sessionId, startedAt: timestamp, endedAt: timestamp, status: "completed", approvedOrigins: ["https://reports.example.test"], actions: [action] },
  CaptureSessionSummary: { schemaVersion: 1, id: sessionId, status: "finalized", startedAt: timestamp, endedAt: timestamp, actionCount: 1, workflowId, compilerVersion: "1.0.0" },
  RecordedAction: action,
  CaptureHandshake: { schemaVersion: 1, extensionVersion: "0.3.0", capabilities: ["semantic-elements", "offline-buffer"], maxBatchSize: 50 },
  CaptureSyncRequest: { schemaVersion: 1, sessionId, batchId: workflowId, cursor: -1, actions: [action], final: false },
  CaptureSyncAck: { schemaVersion: 1, sessionId, batchId: workflowId, acceptedThrough: 0, status: "accepted" },
  WorkflowCompilation: {
    schemaVersion: 1, format: "doonce.workflow-compilation.v1", compilerVersion: "1.0.0", captureSessionId: sessionId, sourceDigest: "a".repeat(64), workflow: workflowSpec,
    warnings: [], provenance: [{ path: "/workflow/title", source: "deterministically-inferred", confidence: 0.8, actionIds: [stepId] }],
    coverage: [{ actionId: stepId, outcome: "emitted", stepIds: [stepId] }], suggestions: [],
  },
  RunRequest: runRequest,
  StepResult: stepResult,
  RunResult: runResult,
  RepairProposal: { schemaVersion: 1, format: "doonce.repair-proposal.v1", id: sessionId, workflowId, baseVersion: 1, createdAt: timestamp, operations: [{ op: "replace-locator", stepId, reason: "The capture id changed.", locator }] },
  ExtensionMessage: { schemaVersion: 1, type: "run.result", result: runResult },
  ApiError: { schemaVersion: 1, error: "Workflow validation failed.", code: "workflow.validation_failed", field: "steps.0.target" },
};
