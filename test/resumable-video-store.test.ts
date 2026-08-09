import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileSystemVideoStore, UploadOffsetConflict } from "../src/video/resumable-video-store.js";

test("persists strict-offset chunks, hashes by stream, and deletes retained media", async () => {
  const root = await mkdtemp(join(tmpdir(), "doonce-video-store-"));
  const id = "11111111-1111-4111-8111-111111111111";
  try {
    const store = new FileSystemVideoStore(root);
    assert.equal(await store.append(id, 0, Buffer.from("hello ")), 6);
    await assert.rejects(() => store.append(id, 0, Buffer.from("duplicate")), (error: unknown) => error instanceof UploadOffsetConflict && error.expectedOffset === 6);
    assert.equal(await store.append(id, 6, Buffer.from("world")), 11);
    assert.equal((await store.verify(id, 11)).checksumSha256, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    await store.delete(id);
    await assert.rejects(() => store.verify(id, 11));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
