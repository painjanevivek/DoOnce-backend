import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export interface VideoBinaryStore {
  append(id: string, expectedOffset: number, bytes: Buffer): Promise<number>;
  verify(id: string, expectedBytes: number): Promise<{ path: string; checksumSha256: string }>;
  delete(id: string): Promise<void>;
}

export class FileSystemVideoStore implements VideoBinaryStore {
  private readonly root: string;

  public constructor(root: string) { this.root = resolve(root); }

  public async append(id: string, expectedOffset: number, bytes: Buffer): Promise<number> {
    if (!uuid(id) || !Number.isSafeInteger(expectedOffset) || expectedOffset < 0 || bytes.length === 0 || bytes.length > 8 * 1024 * 1024) throw new Error("The upload chunk is invalid.");
    await mkdir(this.root, { recursive: true });
    const path = this.path(id);
    const handle = await open(path, "a+");
    try {
      const current = (await handle.stat()).size;
      if (current !== expectedOffset) throw new UploadOffsetConflict(current);
      await handle.write(bytes, 0, bytes.length, current);
      await handle.sync();
      return current + bytes.length;
    } finally {
      await handle.close();
    }
  }

  public async verify(id: string, expectedBytes: number): Promise<{ path: string; checksumSha256: string }> {
    if (!uuid(id)) throw new Error("The upload identifier is invalid.");
    const path = this.path(id);
    if ((await stat(path)).size !== expectedBytes) throw new Error("The uploaded video is incomplete.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return { path, checksumSha256: hash.digest("hex") };
  }

  public async delete(id: string): Promise<void> {
    if (!uuid(id)) throw new Error("The upload identifier is invalid.");
    await rm(this.path(id), { force: true });
  }

  private path(id: string): string {
    const path = join(this.root, `${id}.video`);
    const relativePath = relative(this.root, resolve(path));
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("Invalid video storage path.");
    return path;
  }
}

export class UploadOffsetConflict extends Error {
  public constructor(public readonly expectedOffset: number) { super("The upload offset does not match the stored video."); }
}

function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
