import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { CaptureHandshake, CaptureSyncAck, CaptureSyncRequest } from "../contracts/protocol.js";
import { formatValidationIssues, validateProtocolContract } from "../contracts/validation.js";
import { createHash, randomBytes } from "node:crypto";

export interface CaptureStore {
  syncBatch(user: AuthenticatedUser, request: CaptureSyncRequest): Promise<CaptureSyncAck>;
  createPairingCode(user: AuthenticatedUser, codeHash: string, expiresAt: string): Promise<void>;
  exchangePairingCode(codeHash: string, tokenHash: string): Promise<AuthenticatedUser | undefined>;
  findExtensionIdentity(tokenHash: string): Promise<AuthenticatedUser | undefined>;
  revokeExtensionToken(tokenHash: string): Promise<boolean>;
}

export class CaptureInputError extends Error {}
export class CaptureConflictError extends Error {}

const serverCapabilities: CaptureHandshake["capabilities"] = ["semantic-elements", "frames", "shadow-dom", "navigation", "downloads", "tabs", "offline-buffer"];

export class CaptureService {
  public constructor(private readonly store: CaptureStore) {}

  public handshake(input: unknown): CaptureHandshake {
    const result = validateProtocolContract<CaptureHandshake>("CaptureHandshake", input);
    if (!result.ok) throw new CaptureInputError(formatValidationIssues(result.errors).join(" "));
    return {
      schemaVersion: 1,
      extensionVersion: result.value.extensionVersion,
      capabilities: result.value.capabilities.filter((capability) => serverCapabilities.includes(capability)),
      maxBatchSize: Math.min(result.value.maxBatchSize, 50),
    };
  }

  public async sync(user: AuthenticatedUser, sessionId: string, input: unknown): Promise<CaptureSyncAck> {
    const result = validateProtocolContract<CaptureSyncRequest>("CaptureSyncRequest", input);
    if (!result.ok) throw new CaptureInputError(formatValidationIssues(result.errors).join(" "));
    if (result.value.sessionId !== sessionId) throw new CaptureInputError("The capture session route and batch do not match.");
    validateSequence(result.value);
    const origins = new Set(result.value.actions.map((action) => action.origin));
    if (origins.size > 20) throw new CaptureInputError("A capture batch contains too many browser origins.");
    return this.store.syncBatch(user, result.value);
  }

  public async createPairingCode(user: AuthenticatedUser, now = new Date()): Promise<{ code: string; expiresAt: string }> {
    const code = randomBytes(10).toString("base64url").toUpperCase();
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    await this.store.createPairingCode(user, hash(code), expiresAt);
    return { code, expiresAt };
  }

  public async exchangePairingCode(input: unknown): Promise<{ token: string }> {
    if (!isRecord(input) || typeof input.code !== "string" || !/^[A-Z0-9_-]{12,32}$/.test(input.code) || Object.keys(input).some((key) => key !== "code")) throw new CaptureInputError("Pairing code is invalid.");
    const token = randomBytes(32).toString("base64url");
    const user = await this.store.exchangePairingCode(hash(input.code), hash(token));
    if (!user) throw new CaptureInputError("Pairing code is invalid or expired.");
    return { token };
  }

  public async authenticateExtension(authorization: string | undefined): Promise<AuthenticatedUser | undefined> {
    const match = /^Bearer ([A-Za-z0-9_-]{40,80})$/.exec(authorization ?? "");
    return match?.[1] ? this.store.findExtensionIdentity(hash(match[1])) : undefined;
  }

  public async revokeExtension(authorization: string | undefined): Promise<boolean> {
    const match = /^Bearer ([A-Za-z0-9_-]{40,80})$/.exec(authorization ?? "");
    return match?.[1] ? this.store.revokeExtensionToken(hash(match[1])) : false;
  }
}

function validateSequence(request: CaptureSyncRequest): void {
  for (const [index, action] of request.actions.entries()) {
    const expected = request.cursor + index + 1;
    if (action.sequence !== expected) throw new CaptureInputError(`Capture action ${index + 1} must use sequence ${expected}.`);
  }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
