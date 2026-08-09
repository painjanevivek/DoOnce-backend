import type { ElementTarget, LocatorSpec, PageTarget, WorkflowActionKind } from "../contracts/protocol.js";

export type VideoImportStatus = "uploading" | "uploaded" | "analyzing" | "needs-input" | "needs-calibration" | "ready" | "completed" | "failed" | "cancelled";

export interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
}

export interface VisualObservation {
  id: string;
  sequence: number;
  atMs: number;
  description: string;
  textHints: string[];
  confidence: number;
  frameReference?: string;
  normalizedBounds?: { x: number; y: number; width: number; height: number };
  action?: Extract<WorkflowActionKind, "navigate" | "wait" | "read" | "select" | "type" | "download">;
  navigationTarget?: PageTarget;
  target?: ElementTarget;
  inputName?: string;
  outputName?: string;
}

export interface DemonstrationTimeline {
  schemaVersion: 1;
  format: "doonce.demonstration-timeline.v1";
  source: "video-with-telemetry" | "pure-video";
  durationMs: number;
  observations: VisualObservation[];
  uncertainties: Array<{ code: string; message: string; observationIds: string[] }>;
  startingUrl?: string;
  calibratedAt?: string;
}

export interface VideoImport {
  id: string;
  mode: DemonstrationTimeline["source"];
  fileName: string;
  contentType: "video/mp4" | "video/webm" | "video/quicktime";
  byteSize: number;
  uploadedBytes: number;
  status: VideoImportStatus;
  checksumSha256?: string;
  metadata?: VideoMetadata;
  timeline?: DemonstrationTimeline;
  workflowId?: string;
  errorCode?: string;
  retentionUntil: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalibrationMapping {
  observationId: string;
  action: NonNullable<VisualObservation["action"]>;
  locator?: LocatorSpec;
  domain: string;
  path: string;
  inputName?: string;
  outputName?: string;
}
