import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactObjectStore } from "./artifact-service.js";

export class FileSystemObjectStore implements ArtifactObjectStore {
  private readonly root: string;
  public constructor(root: string) {
    this.root = path.resolve(root);
    if (path.parse(this.root).root === this.root) throw new Error("Artifact storage cannot use a filesystem root.");
  }
  public async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolve(key); const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    try { await rename(temporary, target); } catch (error) { await rm(temporary, { force: true }); throw error; }
  }
  public async get(key: string): Promise<Uint8Array | undefined> { try { return await readFile(this.resolve(key)); } catch (error) { if (isMissing(error)) return undefined; throw error; } }
  public async delete(key: string): Promise<void> { await rm(this.resolve(key), { force: true }); }
  private resolve(key: string): string {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(key)) throw new TypeError("Artifact storage key is invalid.");
    const target = path.resolve(this.root, ...key.split("/"));
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new TypeError("Artifact storage key escapes its root.");
    return target;
  }
}
function isMissing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
