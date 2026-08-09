import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser, AuthService } from "../src/auth/auth-service.js";
import { buildServer } from "../src/server.js";
import type { VideoService } from "../src/video/video-service.js";
import type { VideoImport } from "../src/video/video-types.js";

const owner: AuthenticatedUser = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", email: "owner@example.test", role: "owner" };
const id = "33333333-3333-4333-8333-333333333333";
const now = "2026-08-09T00:00:00.000Z";

test("exposes strict binary upload offsets through the authenticated video API", async () => {
  let received = Buffer.alloc(0);
  const base: VideoImport = { id, mode: "pure-video", fileName: "demo.mp4", contentType: "video/mp4", byteSize: 5, uploadedBytes: 0, status: "uploading", retentionUntil: now, createdAt: now, updatedAt: now };
  const videos = {
    async create() { return base; },
    async append(_user: AuthenticatedUser, _id: string, offset: number, bytes: Buffer) { assert.equal(offset, 0); received = bytes; return { ...base, uploadedBytes: bytes.length }; },
  };
  const auth = { async currentUser() { return owner; } };
  const app = await buildServer({ authService: auth as unknown as AuthService, videoService: videos as unknown as VideoService });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/video-imports", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, payload: { mode: "pure-video", fileName: "demo.mp4", contentType: "video/mp4", byteSize: 5 } });
    assert.equal(created.statusCode, 201); assert.equal(created.headers["upload-offset"], "0");
    const chunk = await app.inject({ method: "PUT", url: `/api/v1/video-imports/${id}/chunks`, headers: { origin: "http://localhost:3000", "content-type": "application/octet-stream", "upload-offset": "0" }, payload: Buffer.from("video") });
    assert.equal(chunk.statusCode, 200); assert.equal(chunk.headers["upload-offset"], "5"); assert.equal(received.toString(), "video");
  } finally { await app.close(); }
});
