import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import { ArtifactInputError, ArtifactService, type ArtifactMetadata, type ArtifactMetadataStore, type ArtifactObjectStore } from "../src/artifacts/artifact-service.js";

const user: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };
const runId = "33333333-3333-4333-8333-333333333333";
class MemoryObjects implements ArtifactObjectStore { public values = new Map<string, Uint8Array>(); async put(key: string, bytes: Uint8Array) { this.values.set(key, bytes.slice()); } async get(key: string) { return this.values.get(key)?.slice(); } async delete(key: string) { this.values.delete(key); } }
class MemoryMetadata implements ArtifactMetadataStore {
  public values = new Map<string, ArtifactMetadata>();
  async create(_user: AuthenticatedUser, artifact: ArtifactMetadata) { this.values.set(artifact.id, artifact); return artifact; }
  async listForRun(_user: AuthenticatedUser, id: string) { return [...this.values.values()].filter((value) => value.runId === id); }
  async find(_user: AuthenticatedUser, id: string) { return this.values.get(id); }
  async listExpired(_user: AuthenticatedUser, now: string, limit: number) { return [...this.values.values()].filter((value) => value.expiresAt && value.expiresAt <= now && !value.pinnedAt).slice(0, limit); }
  async delete(_user: AuthenticatedUser, id: string) { return this.values.delete(id); }
}

test("stores artifact bytes separately with checksum, content type, and retention", async () => {
  const metadata = new MemoryMetadata(); const objects = new MemoryObjects(); const service = new ArtifactService(metadata, objects, "artifact-signing-secret-that-is-long-enough");
  const artifact = await service.create(user, runId, { fileName: "report.csv", contentType: "text/csv", retentionClass: "workflow-output", base64: Buffer.from("a,b\n1,2\n").toString("base64") });
  assert.equal(artifact.byteSize, 8); assert.equal(artifact.checksumSha256.length, 64); assert.match(artifact.expiresAt!, /^\d{4}-/); assert.equal((await service.list(user, runId)).length, 1);
});
test("creates a signed expiring grant and verifies bytes before download", async () => {
  const metadata = new MemoryMetadata(); const objects = new MemoryObjects(); const service = new ArtifactService(metadata, objects, "artifact-signing-secret-that-is-long-enough");
  const artifact = await service.create(user, runId, { fileName: "evidence.json", contentType: "application/json", retentionClass: "publication-evidence", base64: Buffer.from("{}").toString("base64") });
  const grant = await service.createDownloadGrant(user, artifact.id, 60); assert.equal(Buffer.from((await service.download(grant.token)).bytes).toString(), "{}");
  await assert.rejects(() => service.download(`${grant.token}x`), ArtifactInputError); objects.values.set(artifact.storageKey, Buffer.from("tampered")); await assert.rejects(() => service.download(grant.token), /unavailable/);
});
test("removes expired evidence but retains pinned artifacts", async () => {
  const metadata = new MemoryMetadata(); const objects = new MemoryObjects(); const service = new ArtifactService(metadata, objects, "artifact-signing-secret-that-is-long-enough");
  const debug = await service.create(user, runId, { fileName: "debug.txt", contentType: "text/plain", retentionClass: "debug", base64: Buffer.from("debug").toString("base64") });
  const pinned = await service.create(user, runId, { fileName: "keep.txt", contentType: "text/plain", retentionClass: "pinned", base64: Buffer.from("keep").toString("base64") });
  assert.equal(await service.cleanup(user, new Date("2100-01-01T00:00:00.000Z")), 1); assert.equal(metadata.values.has(debug.id), false); assert.equal(metadata.values.has(pinned.id), true);
});
test("rejects malformed base64 and oversized artifacts", async () => {
  const service = new ArtifactService(new MemoryMetadata(), new MemoryObjects(), "artifact-signing-secret-that-is-long-enough", 4);
  await assert.rejects(() => service.create(user, runId, { fileName: "bad.txt", contentType: "text/plain", retentionClass: "debug", base64: "***" }), ArtifactInputError);
  await assert.rejects(() => service.create(user, runId, { fileName: "large.txt", contentType: "text/plain", retentionClass: "debug", base64: Buffer.from("12345").toString("base64") }), ArtifactInputError);
});
