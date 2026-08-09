import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser } from "../auth/auth-service.js";

export type ArtifactRetentionClass = "debug" | "workflow-output" | "publication-evidence" | "pinned";
export interface ArtifactMetadata { id: string; runId: string; stepId?: string; retentionClass: ArtifactRetentionClass; fileName: string; contentType: string; byteSize: number; checksumSha256: string; storageKey: string; createdAt: string; expiresAt: string | null; pinnedAt: string | null }
export interface ArtifactObjectStore { put(key: string, bytes: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array | undefined>; delete(key: string): Promise<void> }
export interface ArtifactMetadataStore {
  create(user: AuthenticatedUser, metadata: ArtifactMetadata): Promise<ArtifactMetadata>;
  listForRun(user: AuthenticatedUser, runId: string): Promise<ArtifactMetadata[]>;
  find(user: AuthenticatedUser, artifactId: string): Promise<ArtifactMetadata | undefined>;
  listExpired(user: AuthenticatedUser, now: string, limit: number): Promise<ArtifactMetadata[]>;
  delete(user: AuthenticatedUser, artifactId: string): Promise<boolean>;
}

export class ArtifactInputError extends Error {}
export class ArtifactNotFoundError extends Error {}

export class ArtifactService {
  public constructor(private readonly metadata: ArtifactMetadataStore, private readonly objects: ArtifactObjectStore, private readonly signingSecret: string, private readonly maxBytes = 5 * 1024 * 1024) {
    if (Buffer.byteLength(signingSecret) < 32) throw new Error("Artifact signing secret must be at least 32 bytes.");
  }

  public async create(user: AuthenticatedUser, runId: string, input: unknown): Promise<ArtifactMetadata> {
    const parsed = parseArtifactInput(input, this.maxBytes);
    const id = randomUUID();
    const storageKey = `${user.tenantId}/${runId}/${id}`;
    const createdAt = new Date().toISOString();
    const expiresAt = retentionExpiry(parsed.retentionClass, new Date(createdAt));
    const record: ArtifactMetadata = { id, runId: uuid(runId), ...(parsed.stepId ? { stepId: parsed.stepId } : {}), retentionClass: parsed.retentionClass, fileName: parsed.fileName, contentType: parsed.contentType, byteSize: parsed.bytes.byteLength, checksumSha256: createHash("sha256").update(parsed.bytes).digest("hex"), storageKey, createdAt, expiresAt, pinnedAt: parsed.retentionClass === "pinned" ? createdAt : null };
    await this.objects.put(storageKey, parsed.bytes);
    try { return await this.metadata.create(user, record); } catch (error) { await this.objects.delete(storageKey); throw error; }
  }

  public list(user: AuthenticatedUser, runId: string): Promise<ArtifactMetadata[]> { return this.metadata.listForRun(user, uuid(runId)); }

  public async createDownloadGrant(user: AuthenticatedUser, artifactId: string, lifetimeSeconds = 300): Promise<{ token: string; expiresAt: string }> {
    const artifact = await this.metadata.find(user, uuid(artifactId));
    if (!artifact) throw new ArtifactNotFoundError("Artifact not found.");
    const seconds = Math.min(Math.max(Math.trunc(lifetimeSeconds), 30), 3600);
    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
    const payload = Buffer.from(JSON.stringify({ artifactId: artifact.id, tenantId: user.tenantId, userId: user.userId, expiresAt })).toString("base64url");
    return { token: `${payload}.${this.sign(payload)}`, expiresAt };
  }

  public async download(token: string): Promise<{ artifact: ArtifactMetadata; bytes: Uint8Array }> {
    const grant = this.verifyGrant(token);
    const user = { tenantId: grant.tenantId, userId: grant.userId, email: "signed-artifact@internal.invalid", role: "reviewer" as const };
    const artifact = await this.metadata.find(user, grant.artifactId);
    if (!artifact) throw new ArtifactNotFoundError("Artifact not found.");
    const bytes = await this.objects.get(artifact.storageKey);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== artifact.checksumSha256) throw new ArtifactNotFoundError("Artifact data is unavailable.");
    return { artifact, bytes };
  }

  public async cleanup(user: AuthenticatedUser, now = new Date(), limit = 100): Promise<number> {
    const expired = await this.metadata.listExpired(user, now.toISOString(), Math.min(Math.max(limit, 1), 1000));
    let removed = 0;
    for (const artifact of expired) {
      await this.objects.delete(artifact.storageKey);
      if (await this.metadata.delete(user, artifact.id)) removed += 1;
    }
    return removed;
  }

  private sign(payload: string): string { return createHmac("sha256", this.signingSecret).update(payload).digest("base64url"); }
  private verifyGrant(token: string): { artifactId: string; tenantId: string; userId: string; expiresAt: string } {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra || signature.length !== 43) throw new ArtifactInputError("Artifact download grant is invalid.");
    const expected = this.sign(payload);
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ArtifactInputError("Artifact download grant is invalid.");
    let value: unknown;
    try { value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new ArtifactInputError("Artifact download grant is invalid."); }
    if (!isRecord(value) || typeof value.expiresAt !== "string" || Date.parse(value.expiresAt) <= Date.now()) throw new ArtifactInputError("Artifact download grant expired.");
    return { artifactId: uuid(value.artifactId), tenantId: uuid(value.tenantId), userId: uuid(value.userId), expiresAt: value.expiresAt };
  }
}

function parseArtifactInput(value: unknown, maxBytes: number): { fileName: string; contentType: string; retentionClass: ArtifactRetentionClass; stepId?: string; bytes: Buffer } {
  if (!isRecord(value) || Object.keys(value).some((key) => !["fileName", "contentType", "retentionClass", "stepId", "base64"].includes(key))) throw new ArtifactInputError("Artifact metadata is invalid.");
  if (typeof value.fileName !== "string" || !/^[^\\/:*?"<>|\r\n]{1,240}$/.test(value.fileName)) throw new ArtifactInputError("Artifact file name is invalid.");
  if (typeof value.contentType !== "string" || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(value.contentType) || value.contentType.length > 120) throw new ArtifactInputError("Artifact content type is invalid.");
  if (!isRetention(value.retentionClass) || typeof value.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)) throw new ArtifactInputError("Artifact content is invalid.");
  const bytes = Buffer.from(value.base64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes || bytes.toString("base64").replace(/=+$/, "") !== value.base64.replace(/=+$/, "")) throw new ArtifactInputError(`Artifact content must be between 1 and ${maxBytes} bytes.`);
  return { fileName: value.fileName, contentType: value.contentType.toLowerCase(), retentionClass: value.retentionClass, ...(value.stepId === undefined ? {} : { stepId: uuid(value.stepId) }), bytes };
}
function retentionExpiry(retention: ArtifactRetentionClass, now: Date): string | null { const days = retention === "debug" ? 7 : retention === "workflow-output" ? 30 : retention === "publication-evidence" ? 365 : 0; return days ? new Date(now.getTime() + days * 86_400_000).toISOString() : null; }
function isRetention(value: unknown): value is ArtifactRetentionClass { return value === "debug" || value === "workflow-output" || value === "publication-evidence" || value === "pinned"; }
function uuid(value: unknown): string { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ArtifactInputError("A valid identifier is required."); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
