import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { CaptureCompilationService } from "../src/compiler/capture-compilation-service.js";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { validateProtocolContract } from "../src/contracts/validation.js";
import type { CanonicalWorkflowService } from "../src/workflow/canonical-workflow-service.js";
import type { MediaInspector, VideoObservationProvider } from "../src/video/media-analysis.js";
import type { VideoBinaryStore } from "../src/video/resumable-video-store.js";
import { VideoInputError, VideoService, type NewVideoImport, type VideoImportStore } from "../src/video/video-service.js";
import type { DemonstrationTimeline, VideoImport, VideoImportStatus, VideoMetadata } from "../src/video/video-types.js";

const owner: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };
const metadata: VideoMetadata = { durationMs: 12_000, width: 1920, height: 1080, frameRate: 30 };

class MemoryVideoStore implements VideoImportStore {
  public items = new Map<string, VideoImport>();
  public captureIds = new Map<string, string>();

  public async create(_user: AuthenticatedUser, input: NewVideoImport): Promise<VideoImport> {
    const now = new Date().toISOString();
    const video: VideoImport = { id: input.id, mode: input.mode, fileName: input.fileName, contentType: input.contentType, byteSize: input.byteSize, uploadedBytes: 0, status: "uploading", retentionUntil: new Date(Date.now() + 86_400_000).toISOString(), createdAt: now, updatedAt: now };
    this.items.set(video.id, video);
    if (input.captureSessionId) this.captureIds.set(video.id, input.captureSessionId);
    return video;
  }

  public async find(_user: AuthenticatedUser, id: string) { return this.items.get(id); }
  public async captureSessionId(_user: AuthenticatedUser, id: string) { return this.captureIds.get(id); }
  public async updateUploaded(_user: AuthenticatedUser, id: string, uploadedBytes: number) { return this.change(id, { uploadedBytes }); }
  public async finishUpload(_user: AuthenticatedUser, id: string, checksumSha256: string, value: VideoMetadata) { return this.change(id, { checksumSha256, metadata: value, status: "uploaded" }); }
  public async setStatus(_user: AuthenticatedUser, id: string, status: VideoImportStatus, errorCode?: string) { return this.change(id, { status, ...(errorCode ? { errorCode } : {}) }); }
  public async saveTimeline(_user: AuthenticatedUser, id: string, timeline: DemonstrationTimeline, status: VideoImportStatus) { return this.change(id, { timeline, status }); }
  public async complete(_user: AuthenticatedUser, id: string, workflowId: string, timeline: DemonstrationTimeline) { return this.change(id, { workflowId, timeline, status: "completed" }); }
  public async expired() { return [...this.items.values()].filter(({ retentionUntil }) => new Date(retentionUntil).getTime() <= Date.now()).map(({ id }) => id); }
  public async delete(_user: AuthenticatedUser, id: string) { return this.items.delete(id); }

  private change(id: string, patch: Partial<VideoImport>): VideoImport | undefined {
    const current = this.items.get(id);
    if (!current) return undefined;
    const changed = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.items.set(id, changed);
    return changed;
  }
}

class MemoryBinaries implements VideoBinaryStore {
  public items = new Map<string, Buffer>();
  public deleted: string[] = [];
  public async append(id: string, offset: number, bytes: Buffer) { const current = this.items.get(id) ?? Buffer.alloc(0); assert.equal(offset, current.length); const next = Buffer.concat([current, bytes]); this.items.set(id, next); return next.length; }
  public async verify(id: string, expectedBytes: number) { const value = this.items.get(id) ?? Buffer.alloc(0); assert.equal(value.length, expectedBytes); return { path: `/video/${id}`, checksumSha256: createHash("sha256").update(value).digest("hex") }; }
  public async delete(id: string) { this.items.delete(id); this.deleted.push(id); }
}

class DraftSink {
  public drafts: WorkflowSpec[] = [];
  public async createDraft(_user: AuthenticatedUser, spec: WorkflowSpec) { this.drafts.push(spec); return { id: "33333333-3333-4333-8333-333333333333", version: 1, status: "draft" as const, spec, checksum: "a".repeat(64) }; }
}

const inspector: MediaInspector = { async inspect() { return metadata; } };
const observationId = "44444444-4444-4444-8444-444444444444";
const provider: VideoObservationProvider = { async analyze(): Promise<DemonstrationTimeline> { return { schemaVersion: 1, format: "doonce.demonstration-timeline.v1", source: "pure-video", durationMs: metadata.durationMs, observations: [{ id: observationId, sequence: 0, atMs: 2_000, description: "Enter the account name", textHints: ["Account"], confidence: 0.35, normalizedBounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } }], uncertainties: [{ code: "video.semantic-calibration-required", message: "Calibrate the visible target.", observationIds: [observationId] }] }; } };

function fixture() {
  const store = new MemoryVideoStore(); const binaries = new MemoryBinaries(); const drafts = new DraftSink();
  return { store, binaries, drafts, service: new VideoService(store, binaries, inspector, provider, drafts as unknown as CanonicalWorkflowService) };
}

async function upload(service: VideoService, bytes = Buffer.from("valid-video")): Promise<VideoImport> {
  const created = await service.create(owner, { mode: "pure-video", fileName: "demo.mp4", contentType: "video/mp4", byteSize: bytes.length });
  await service.append(owner, created.id, 0, bytes.subarray(0, 4));
  await service.append(owner, created.id, 4, bytes.subarray(4));
  return service.completeUpload(owner, created.id);
}

test("accepts a resumable video and verifies its media metadata before analysis", async () => {
  const { service } = fixture();
  const completed = await upload(service);
  assert.equal(completed.status, "uploaded");
  assert.deepEqual(completed.metadata, metadata);
  assert.match(completed.checksumSha256 ?? "", /^[a-f0-9]{64}$/);
});

test("turns pure video into a low-confidence timeline that explicitly requires calibration", async () => {
  const { service } = fixture(); const uploaded = await upload(service);
  const analyzed = await service.analyze(owner, uploaded.id);
  assert.equal(analyzed.status, "needs-calibration");
  assert.equal(analyzed.timeline?.observations[0]?.confidence, 0.35);
  assert.equal(analyzed.timeline?.observations[0]?.target, undefined);
});

test("never accepts screen coordinates as a durable locator", async () => {
  const { service } = fixture(); const uploaded = await upload(service); await service.analyze(owner, uploaded.id);
  await assert.rejects(() => service.calibrate(owner, uploaded.id, { startingUrl: "https://example.test/start", mappings: [{ observationId, action: "type", domain: "example.test", path: "/start", normalizedBounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } }] }), VideoInputError);
});

test("compiles calibrated semantic targets into the normal editable WorkflowSpec", async () => {
  const { service, drafts } = fixture(); const uploaded = await upload(service); await service.analyze(owner, uploaded.id);
  await service.calibrate(owner, uploaded.id, { startingUrl: "https://example.test/start", mappings: [{ observationId, action: "type", domain: "example.test", path: "/start", inputName: "account_name", locator: { schemaVersion: 1, primary: { strategy: "role", value: "textbox:Account", confidence: 0.95 }, fallbacks: [{ strategy: "label", value: "Account", confidence: 0.9 }] } }] });
  const completed = await service.compile(owner, uploaded.id);
  assert.equal(completed.status, "completed");
  assert.equal(drafts.drafts.length, 1);
  assert.equal(validateProtocolContract("WorkflowSpec", drafts.drafts[0]).ok, true);
  assert.equal(drafts.drafts[0]?.steps[0]?.action, "type");
});

test("uses synchronized telemetry as the authoritative workflow source", async () => {
  const { store, binaries, drafts } = fixture();
  const captureSessionId = "55555555-5555-4555-8555-555555555555";
  const workflow: WorkflowSpec = { schemaVersion: 1, format: "doonce.workflow-spec.v1", title: "Captured task", allowedDomains: ["example.test"], inputs: [], steps: [{ id: "66666666-6666-4666-8666-666666666666", action: "navigate", name: "Open reports", expectedOutcome: "Reports open", target: { domain: "example.test", path: "/reports" } }] };
  const captures = { async compile() { return { workflow: { id: "77777777-7777-4777-8777-777777777777", version: 1, status: "draft", spec: workflow, checksum: "b".repeat(64) }, compilation: { workflow, warnings: [], captureSessionId } }; } };
  const service = new VideoService(store, binaries, inspector, provider, drafts as unknown as CanonicalWorkflowService, captures as unknown as CaptureCompilationService);
  const bytes = Buffer.from("telemetry-video");
  const created = await service.create(owner, { mode: "video-with-telemetry", captureSessionId, fileName: "telemetry.webm", contentType: "video/webm", byteSize: bytes.length });
  await service.append(owner, created.id, 0, bytes); await service.completeUpload(owner, created.id);
  const completed = await service.analyze(owner, created.id);
  assert.equal(completed.workflowId, "77777777-7777-4777-8777-777777777777");
  assert.equal(completed.timeline?.source, "video-with-telemetry");
  assert.equal(drafts.drafts.length, 0);
});

test("removes expired video binaries and their metadata together", async () => {
  const { service, store, binaries } = fixture(); const uploaded = await upload(service);
  store.items.set(uploaded.id, { ...uploaded, retentionUntil: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await service.cleanup(owner), 1);
  assert.deepEqual(binaries.deleted, [uploaded.id]);
  assert.equal(store.items.has(uploaded.id), false);
});
