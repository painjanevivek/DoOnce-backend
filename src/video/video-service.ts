import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { CaptureCompilationService } from "../compiler/capture-compilation-service.js";
import type { LocatorSpec, WorkflowInputDefinition, WorkflowSpec, WorkflowStep } from "../contracts/protocol.js";
import { validateProtocolContract } from "../contracts/validation.js";
import type { CanonicalWorkflowService } from "../workflow/canonical-workflow-service.js";
import type { MediaInspector, VideoObservationProvider } from "./media-analysis.js";
import type { VideoBinaryStore } from "./resumable-video-store.js";
import { UploadOffsetConflict } from "./resumable-video-store.js";
import type { CalibrationMapping, DemonstrationTimeline, VideoImport, VideoImportStatus, VideoMetadata } from "./video-types.js";

export interface NewVideoImport {
  id: string;
  mode: VideoImport["mode"];
  captureSessionId?: string;
  fileName: string;
  contentType: VideoImport["contentType"];
  byteSize: number;
}

export interface VideoImportStore {
  create(user: AuthenticatedUser, input: NewVideoImport): Promise<VideoImport>;
  find(user: AuthenticatedUser, id: string): Promise<VideoImport | undefined>;
  captureSessionId(user: AuthenticatedUser, id: string): Promise<string | undefined>;
  updateUploaded(user: AuthenticatedUser, id: string, uploadedBytes: number): Promise<VideoImport | undefined>;
  finishUpload(user: AuthenticatedUser, id: string, checksum: string, metadata: VideoMetadata): Promise<VideoImport | undefined>;
  setStatus(user: AuthenticatedUser, id: string, status: VideoImportStatus, errorCode?: string): Promise<VideoImport | undefined>;
  saveTimeline(user: AuthenticatedUser, id: string, timeline: DemonstrationTimeline, status: VideoImportStatus): Promise<VideoImport | undefined>;
  complete(user: AuthenticatedUser, id: string, workflowId: string, timeline: DemonstrationTimeline): Promise<VideoImport | undefined>;
  expired(user: AuthenticatedUser, limit: number): Promise<string[]>;
  delete(user: AuthenticatedUser, id: string): Promise<boolean>;
}

export class VideoInputError extends Error {}
export class VideoAccessError extends Error {}
export class VideoConflictError extends Error { public constructor(message: string, public readonly expectedOffset?: number) { super(message); } }

export class VideoService {
  public constructor(
    private readonly store: VideoImportStore,
    private readonly binaries: VideoBinaryStore,
    private readonly inspector: MediaInspector,
    private readonly observations: VideoObservationProvider,
    private readonly workflows: CanonicalWorkflowService,
    private readonly captures?: CaptureCompilationService,
  ) {}

  public create(user: AuthenticatedUser, input: unknown): Promise<VideoImport> {
    requireAuthor(user);
    if (!record(input) || Object.keys(input).some((key) => !["mode", "captureSessionId", "fileName", "contentType", "byteSize"].includes(key))) throw new VideoInputError("The video import request is invalid.");
    if (input.mode !== "pure-video" && input.mode !== "video-with-telemetry") throw new VideoInputError("Choose pure video or video with browser telemetry.");
    const captureSessionId = input.captureSessionId === undefined ? undefined : uuid(input.captureSessionId);
    if (input.mode === "video-with-telemetry" && !captureSessionId) throw new VideoInputError("Video with telemetry requires a capture session.");
    if (input.mode === "pure-video" && captureSessionId) throw new VideoInputError("Pure video cannot attach a telemetry session.");
    const contentType = input.contentType;
    if (contentType !== "video/mp4" && contentType !== "video/webm" && contentType !== "video/quicktime") throw new VideoInputError("Upload an MP4, WebM, or QuickTime video.");
    if (typeof input.fileName !== "string" || input.fileName.trim().length === 0 || input.fileName.length > 255) throw new VideoInputError("Provide a valid video file name.");
    if (!Number.isSafeInteger(input.byteSize) || Number(input.byteSize) < 1 || Number(input.byteSize) > 500 * 1024 * 1024) throw new VideoInputError("Video size must be between 1 byte and 500 MiB.");
    return this.store.create(user, { id: randomUUID(), mode: input.mode, ...(captureSessionId ? { captureSessionId } : {}), fileName: input.fileName.trim(), contentType, byteSize: Number(input.byteSize) });
  }

  public find(user: AuthenticatedUser, id: string): Promise<VideoImport | undefined> { return this.store.find(user, uuid(id)); }

  public async append(user: AuthenticatedUser, id: string, offset: number, bytes: Buffer): Promise<VideoImport> {
    requireAuthor(user);
    const current = await this.requireImport(user, id);
    if (current.status !== "uploading") throw new VideoConflictError("This upload is no longer accepting chunks.");
    if (offset !== current.uploadedBytes) throw new VideoConflictError("Resume from the server's current upload offset.", current.uploadedBytes);
    if (current.uploadedBytes + bytes.length > current.byteSize) throw new VideoInputError("The upload chunk exceeds the declared video size.");
    try {
      const uploadedBytes = await this.binaries.append(current.id, offset, bytes);
      const updated = await this.store.updateUploaded(user, current.id, uploadedBytes);
      if (!updated) throw new VideoConflictError("The upload state changed before the chunk was stored.");
      return updated;
    } catch (error) {
      if (error instanceof UploadOffsetConflict) throw new VideoConflictError(error.message, error.expectedOffset);
      throw error;
    }
  }

  public async completeUpload(user: AuthenticatedUser, id: string): Promise<VideoImport> {
    requireAuthor(user);
    const current = await this.requireImport(user, id);
    if (current.status !== "uploading" || current.uploadedBytes !== current.byteSize) throw new VideoConflictError("The video upload is incomplete.", current.uploadedBytes);
    const verified = await this.binaries.verify(current.id, current.byteSize);
    let metadata: VideoMetadata;
    try { metadata = await this.inspector.inspect(verified.path); } catch { throw new VideoInputError("The uploaded video could not be decoded."); }
    validateMetadata(metadata);
    const completed = await this.store.finishUpload(user, current.id, verified.checksumSha256, metadata);
    if (!completed) throw new VideoConflictError("The upload state changed before verification completed.");
    return completed;
  }

  public async analyze(user: AuthenticatedUser, id: string): Promise<VideoImport> {
    requireAuthor(user);
    const current = await this.requireImport(user, id);
    if (current.status !== "uploaded" || !current.metadata) throw new VideoConflictError("Complete the video upload before analysis.");
    await this.store.setStatus(user, current.id, "analyzing");
    try {
      if (current.mode === "video-with-telemetry") {
        if (!this.captures) throw new Error("Telemetry compilation is unavailable.");
        const captureSessionId = await this.store.captureSessionId(user, current.id);
        if (!captureSessionId) throw new Error("The telemetry capture is unavailable.");
        const result = await this.captures.compile(user, captureSessionId);
        const timeline: DemonstrationTimeline = {
          schemaVersion: 1,
          format: "doonce.demonstration-timeline.v1",
          source: "video-with-telemetry",
          durationMs: current.metadata.durationMs,
          observations: result.compilation.workflow.steps.map((step, sequence) => ({
            id: step.id,
            sequence,
            atMs: Math.round((sequence / Math.max(result.compilation.workflow.steps.length, 1)) * current.metadata!.durationMs),
            description: step.name,
            textHints: [],
            confidence: 1,
            ...(isVideoAction(step.action) ? { action: step.action } : {}),
          })),
          uncertainties: result.compilation.warnings.map((warning) => ({ code: warning.code, message: warning.message, observationIds: warning.actionIds })),
          calibratedAt: new Date().toISOString(),
        };
        const completed = await this.store.complete(user, current.id, result.workflow.id, timeline);
        if (!completed) throw new Error("The telemetry result could not be stored.");
        return completed;
      }
      const verified = await this.binaries.verify(current.id, current.byteSize);
      const timeline = await this.observations.analyze(verified.path, current.metadata);
      const status: VideoImportStatus = timeline.observations.length === 0 ? "needs-input" : "needs-calibration";
      const saved = await this.store.saveTimeline(user, current.id, timeline, status);
      if (!saved) throw new Error("The video timeline could not be stored.");
      return saved;
    } catch (error) {
      await this.store.setStatus(user, current.id, "failed", "video.analysis_failed");
      throw error;
    }
  }

  public async calibrate(user: AuthenticatedUser, id: string, input: unknown): Promise<VideoImport> {
    requireAuthor(user);
    const current = await this.requireImport(user, id);
    if (!current.timeline || (current.status !== "needs-calibration" && current.status !== "needs-input")) throw new VideoConflictError("This video is not waiting for calibration.");
    if (!record(input) || typeof input.startingUrl !== "string" || !Array.isArray(input.mappings)) throw new VideoInputError("Starting URL and calibration mappings are required.");
    const startingUrl = publicUrl(input.startingUrl);
    const mappings = input.mappings.map(parseMapping);
    const byObservation = new Map(mappings.map((mapping) => [mapping.observationId, mapping]));
    if (mappings.length === 0 || mappings.length !== byObservation.size) throw new VideoInputError("Provide one unique calibration mapping for each included step.");
    const observations = current.timeline.observations.flatMap((observation) => {
      const mapping = byObservation.get(observation.id);
      if (!mapping) return [];
      return [{
        ...observation,
        action: mapping.action,
        ...(mapping.action === "navigate"
          ? { navigationTarget: { domain: mapping.domain, path: mapping.path } }
          : { target: { domain: mapping.domain, path: mapping.path, locator: mapping.locator! } }),
        ...(mapping.inputName ? { inputName: mapping.inputName } : {}),
        ...(mapping.outputName ? { outputName: mapping.outputName } : {}),
        confidence: Math.min(observation.confidence, 0.75),
      }];
    });
    if (observations.length !== mappings.length) throw new VideoInputError("A calibration mapping references an unknown visual observation.");
    const timeline: DemonstrationTimeline = { ...current.timeline, startingUrl: startingUrl.toString(), observations, uncertainties: [], calibratedAt: new Date().toISOString() };
    const saved = await this.store.saveTimeline(user, current.id, timeline, "ready");
    if (!saved) throw new VideoConflictError("The calibration state changed before it was saved.");
    return saved;
  }

  public async compile(user: AuthenticatedUser, id: string): Promise<VideoImport> {
    requireAuthor(user);
    const current = await this.requireImport(user, id);
    if (current.status !== "ready" || !current.timeline?.calibratedAt) throw new VideoConflictError("Calibrate the video timeline before creating a draft.");
    const spec = timelineToWorkflow(current.timeline, current.fileName);
    const draft = await this.workflows.createDraft(user, spec);
    const completed = await this.store.complete(user, current.id, draft.id, current.timeline);
    if (!completed) throw new VideoConflictError("The video import state changed before the draft was stored.");
    return completed;
  }

  public async cleanup(user: AuthenticatedUser): Promise<number> {
    requireAuthor(user);
    const expired = await this.store.expired(user, 100);
    let deleted = 0;
    for (const id of expired) {
      await this.binaries.delete(id);
      if (await this.store.delete(user, id)) deleted += 1;
    }
    return deleted;
  }

  private async requireImport(user: AuthenticatedUser, id: string): Promise<VideoImport> {
    const video = await this.store.find(user, uuid(id));
    if (!video) throw new VideoInputError("Video import not found.");
    return video;
  }
}

function timelineToWorkflow(timeline: DemonstrationTimeline, fileName: string): WorkflowSpec {
  if (!timeline.startingUrl) throw new VideoInputError("The calibrated timeline has no starting URL.");
  const start = publicUrl(timeline.startingUrl);
  const inputs = new Map<string, WorkflowInputDefinition>();
  if (timeline.observations.length === 0) throw new VideoInputError("The calibrated timeline contains no executable observations.");
  const steps: WorkflowStep[] = timeline.observations.map((observation) => {
    if (!observation.action) throw new VideoInputError("Every included observation needs a supported action.");
    const base = { id: observation.id, name: observation.description.slice(0, 120) || "Video step", expectedOutcome: "The calibrated browser state is reached." };
    if (observation.action === "navigate") return { ...base, action: "navigate", target: observation.navigationTarget ?? { domain: start.hostname, path: start.pathname || "/" } };
    if (!observation.target) throw new VideoInputError("Every browser interaction needs a calibrated semantic locator.");
    if (observation.action === "wait") return { ...base, action: "wait", target: observation.target, timeoutMs: 15_000 };
    if (observation.action === "download") return { ...base, action: "download", target: observation.target };
    if (observation.action === "read") return { ...base, action: "read", target: observation.target, outputName: variableName(observation.outputName ?? `output_${observation.sequence + 1}`) };
    const inputName = variableName(observation.inputName ?? `input_${observation.sequence + 1}`);
    inputs.set(inputName, { name: inputName, label: title(inputName), kind: "text", required: true });
    return observation.action === "select" ? { ...base, action: "select", target: observation.target, inputName } : { ...base, action: "type", target: observation.target, inputName };
  });
  return { schemaVersion: 1, format: "doonce.workflow-spec.v1", title: `Video draft - ${fileName.replace(/\.[^.]+$/, "").slice(0, 80)}`, description: "Draft created from a calibrated video demonstration.", allowedDomains: [...new Set([start.hostname, ...timeline.observations.flatMap((item) => item.target ? [item.target.domain] : [])])], inputs: [...inputs.values()], steps };
}

function parseMapping(value: unknown): CalibrationMapping {
  if (!record(value) || !isVideoAction(value.action)) throw new VideoInputError("A calibration mapping contains an unsupported action.");
  const action = value.action;
  const observationId = uuid(value.observationId);
  const domain = domainName(value.domain);
  const path = pathName(value.path);
  if (action === "navigate") return { observationId, action, domain, path };
  const locator = validateProtocolContract<LocatorSpec>("LocatorSpec", value.locator);
  if (!locator.ok) throw new VideoInputError("A valid semantic locator is required; video coordinates are not accepted.");
  return { observationId, action, domain, path, locator: locator.value, ...(typeof value.inputName === "string" ? { inputName: variableName(value.inputName) } : {}), ...(typeof value.outputName === "string" ? { outputName: variableName(value.outputName) } : {}) };
}

function validateMetadata(value: VideoMetadata): void { if (!Number.isInteger(value.durationMs) || value.durationMs < 1 || value.durationMs > 3_600_000 || !Number.isInteger(value.width) || value.width < 1 || value.width > 16_384 || !Number.isInteger(value.height) || value.height < 1 || value.height > 16_384 || !Number.isFinite(value.frameRate) || value.frameRate <= 0 || value.frameRate > 240) throw new VideoInputError("The video duration, resolution, or frame rate is unsupported."); }
function publicUrl(value: string): URL { try { const url = new URL(value); if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error(); return url; } catch { throw new VideoInputError("Provide a public HTTPS starting URL or an explicit local demo URL."); } }
function isVideoAction(value: unknown): value is NonNullable<CalibrationMapping["action"]> { return ["navigate", "wait", "read", "select", "type", "download"].includes(String(value)); }
function domainName(value: unknown): string { if (typeof value !== "string" || !/^[a-z0-9.-]+$/i.test(value) || value.length > 253) throw new VideoInputError("Calibration domain is invalid."); return value.toLowerCase(); }
function pathName(value: unknown): string { if (typeof value !== "string" || !value.startsWith("/") || value.length > 2048 || value.includes("..")) throw new VideoInputError("Calibration path is invalid."); return value; }
function variableName(value: string): string { const normalized = value.trim().replace(/[^a-zA-Z0-9_]/g, "_"); if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(normalized)) throw new VideoInputError("Calibration variable names must begin with a letter and contain only letters, numbers, or underscores."); return normalized; }
function title(value: string): string { return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function uuid(value: unknown): string { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new VideoInputError("A valid identifier is required."); return value; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireAuthor(user: AuthenticatedUser): void { if (user.role !== "owner" && user.role !== "builder") throw new VideoAccessError("Only workflow owners and builders can import videos."); }
