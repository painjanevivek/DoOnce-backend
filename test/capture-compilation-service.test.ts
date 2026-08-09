import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { CaptureService, type CaptureStore } from "../src/capture/capture-service.js";
import { CaptureCompilationNotFoundError, CaptureCompilationService } from "../src/compiler/capture-compilation-service.js";
import { CaptureWorkflowCompiler } from "../src/compiler/capture-workflow-compiler.js";
import type { CaptureSession, CaptureSyncAck, WorkflowSpec } from "../src/contracts/protocol.js";
import { CanonicalWorkflowService, type CanonicalWorkflowDraft, type CanonicalWorkflowDraftMetadata, type CanonicalWorkflowStore } from "../src/workflow/canonical-workflow-service.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

const owner = { tenantId: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", userId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", role: "owner", email: "owner@example.test" } as AuthenticatedUser;

test("compiles a finalized tenant capture into a canonical draft with source metadata", async () => {
  const captureStore = captureStoreWith(validProtocolFixtures.CaptureSession as CaptureSession);
  const workflowStore = new MemoryWorkflowStore();
  const service = new CaptureCompilationService(new CaptureService(captureStore), new CaptureWorkflowCompiler(), new CanonicalWorkflowService(workflowStore));

  const result = await service.compile(owner, (validProtocolFixtures.CaptureSession as CaptureSession).id);

  assert.equal(result.workflow.metadata?.compilerVersion, "1.0.0");
  assert.equal(result.workflow.metadata?.sourceDigest, result.compilation.sourceDigest);
  assert.deepEqual(result.workflow.spec, result.compilation.workflow);
  assert.equal(workflowStore.draft?.metadata?.captureSessionId, result.compilation.captureSessionId);
});

test("does not create a draft when the tenant capture cannot be found", async () => {
  const service = new CaptureCompilationService(new CaptureService(captureStoreWith(undefined)), new CaptureWorkflowCompiler(), new CanonicalWorkflowService(new MemoryWorkflowStore()));
  await assert.rejects(() => service.compile(owner, (validProtocolFixtures.CaptureSession as CaptureSession).id), CaptureCompilationNotFoundError);
});

class MemoryWorkflowStore implements CanonicalWorkflowStore {
  public draft?: CanonicalWorkflowDraft;
  public async createDraft(_user: AuthenticatedUser, workflowId: string, spec: WorkflowSpec, metadata?: CanonicalWorkflowDraftMetadata): Promise<CanonicalWorkflowDraft> {
    this.draft = { id: workflowId, version: 1, status: "draft", spec, checksum: "a".repeat(64), ...(metadata ? { metadata } : {}) };
    return this.draft;
  }
  public async findDraft(): Promise<CanonicalWorkflowDraft | undefined> { return this.draft; }
  public async listWorkflows(): Promise<[]> { return []; }
  public async listVersions(): Promise<[]> { return []; }
  public async updateDraft(): Promise<{ status: "missing" }> { return { status: "missing" }; }
  public async createNextDraft(): Promise<{ status: "missing" }> { return { status: "missing" }; }
  public async hasPassingTestEvidence(): Promise<boolean> { return true; }
  public async publishDraft(): Promise<{ status: "missing" }> { return { status: "missing" }; }
}

function captureStoreWith(session: CaptureSession | undefined): CaptureStore {
  return {
    async syncBatch(_user, request): Promise<CaptureSyncAck> { return { schemaVersion: 1, sessionId: request.sessionId, batchId: request.batchId, acceptedThrough: request.cursor, status: "accepted" }; },
    async findSession() { return session; },
    async listSessions() { return []; },
    async createPairingCode() { return undefined; },
    async exchangePairingCode() { return undefined; },
    async findExtensionIdentity() { return undefined; },
    async revokeExtensionToken() { return false; },
  };
}
