import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { CaptureInputError, CaptureService, type CaptureStore } from "../src/capture/capture-service.js";
import type { CaptureSyncAck, CaptureSyncRequest } from "../src/contracts/protocol.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";
import { mvpPolicyFromEnvironment } from "../src/system/mvp-policy.js";

const user = { tenantId: "a0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", userId: "b0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b", role: "owner" } as AuthenticatedUser;

test("negotiates only compatible capture capabilities and batch bounds", () => {
  const service = new CaptureService(memoryStore());
  assert.deepEqual(service.handshake({ schemaVersion: 1, extensionVersion: "0.3.0", capabilities: ["semantic-elements", "offline-buffer"], maxBatchSize: 100 }), {
    schemaVersion: 1, extensionVersion: "0.3.0", capabilities: ["semantic-elements", "offline-buffer"], maxBatchSize: 50,
  });
});

test("accepts a contiguous capture batch and rejects route or sequence drift", async () => {
  const service = new CaptureService(memoryStore());
  const request = validProtocolFixtures.CaptureSyncRequest as CaptureSyncRequest;
  assert.equal((await service.sync(user, request.sessionId, request)).acceptedThrough, 0);
  await assert.rejects(() => service.sync(user, crypto.randomUUID(), request), CaptureInputError);
  await assert.rejects(() => service.sync(user, request.sessionId, { ...request, actions: [{ ...request.actions[0]!, sequence: 4 }] }), CaptureInputError);
});

test("creates one-time pairing credentials and authenticates the extension token", async () => {
  const identities = new Map<string, AuthenticatedUser>();
  let pairingHash = "";
  const store = memoryStore({ identities, onPairingHash: (value) => { pairingHash = value; } });
  const service = new CaptureService(store);
  const pairing = await service.createPairingCode(user, new Date("2026-08-09T00:00:00.000Z"));
  assert.equal(pairing.expiresAt, "2026-08-09T00:10:00.000Z");
  assert.equal(pairingHash.length, 64);
  const exchanged = await service.exchangePairingCode({ code: pairing.code });
  assert.equal((await service.authenticateExtension(`Bearer ${exchanged.token}`))?.tenantId, user.tenantId);
  assert.equal(await service.revokeExtension(`Bearer ${exchanged.token}`), true);
  assert.equal(await service.authenticateExtension(`Bearer ${exchanged.token}`), undefined);
  assert.equal(await service.authenticateExtension("Bearer malformed"), undefined);
});

test("fails closed on non-pilot, value-bearing, page-content, and raw-selector capture data", async () => {
  const policy = mvpPolicyFromEnvironment({ DOONCE_MVP_MODE: "true", DOONCE_PILOT_ALLOWED_ORIGIN: "https://reports.example.test" });
  const service = new CaptureService(memoryStore(), policy);
  const base = structuredClone(validProtocolFixtures.CaptureSyncRequest as CaptureSyncRequest);
  const action = base.actions[0]!;
  action.origin = policy.pilotOrigin!;
  action.path = "/reports";
  delete action.value;
  action.before = { capturedAt: action.occurredAt, origin: policy.pilotOrigin!, path: "/reports", urlPattern: `${policy.pilotOrigin}/reports`, navigationId: crypto.randomUUID(), domFingerprint: "a".repeat(16) };
  action.after = { ...action.before, capturedAt: action.occurredAt };
  action.target = { tagName: "button", framePath: [], domFingerprint: "b".repeat(16), visibility: { inViewport: true, ratio: 1, viewportWidth: 1280, viewportHeight: 720 }, locator: { schemaVersion: 1, primary: { strategy: "capture-id", value: "download-report", confidence: 1 }, fallbacks: [] } };
  assert.equal((await service.sync(user, base.sessionId, base)).acceptedThrough, 0);
  await assert.rejects(() => service.sync(user, base.sessionId, { ...base, actions: [{ ...action, origin: "https://other.example.test" }] }), /pilot origin/);
  await assert.rejects(() => service.sync(user, base.sessionId, { ...base, actions: [{ ...action, value: { classification: "intentionally-omitted", placeholder: "{{empty}}", length: 0 } }] }), /values are not accepted/);
  await assert.rejects(() => service.sync(user, base.sessionId, { ...base, actions: [{ ...action, target: { ...action.target!, textHint: "Download report" } }] }), /page content/);
  await assert.rejects(() => service.sync(user, base.sessionId, { ...base, actions: [{ ...action, target: { ...action.target!, locator: { schemaVersion: 1, primary: { strategy: "text", value: "Download report", confidence: 1 }, fallbacks: [] } } }] }), /stable value-free/);
});

function memoryStore(options?: { identities?: Map<string, AuthenticatedUser>; onPairingHash?: (value: string) => void }): CaptureStore {
  let codeHash = "";
  return {
    async syncBatch(_user, request): Promise<CaptureSyncAck> {
      return { schemaVersion: 1, sessionId: request.sessionId, batchId: request.batchId, acceptedThrough: request.actions.at(-1)?.sequence ?? request.cursor, status: request.final ? "finalized" : "accepted" };
    },
    async findSession() { return validProtocolFixtures.CaptureSession as import("../src/contracts/protocol.js").CaptureSession; },
    async listSessions() { return [validProtocolFixtures.CaptureSessionSummary as import("../src/contracts/protocol.js").CaptureSessionSummary]; },
    async createPairingCode(_user, value) { codeHash = value; options?.onPairingHash?.(value); },
    async exchangePairingCode(value, tokenHash) { if (value !== codeHash) return undefined; options?.identities?.set(tokenHash, user); return user; },
    async findExtensionIdentity(tokenHash) { return options?.identities?.get(tokenHash); },
    async revokeExtensionToken(tokenHash) { return options?.identities?.delete(tokenHash) ?? false; },
    async connectionStatus() { return { connected: false }; },
    async grantOriginConsent() {},
    async revokeOriginConsent() { return true; },
  };
}
