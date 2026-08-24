import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { CaptureHandshake, CaptureSession, CaptureSessionSummary, CaptureSyncAck, CaptureSyncRequest } from "../contracts/protocol.js";
import { formatValidationIssues, validateProtocolContract } from "../contracts/validation.js";
import { createHash, randomBytes } from "node:crypto";
import { disabledMvpPolicy, type MvpPolicy } from "../system/mvp-policy.js";

export interface CaptureConnectionStatus {
  connected: boolean;
  extensionVersion?: string;
  pairedAt?: string;
  lastSeenAt?: string;
}

export interface CaptureStore {
  syncBatch(user: AuthenticatedUser, request: CaptureSyncRequest): Promise<CaptureSyncAck>;
  findSession(user: AuthenticatedUser, sessionId: string): Promise<CaptureSession | undefined>;
  listSessions(user: AuthenticatedUser, limit: number): Promise<CaptureSessionSummary[]>;
  createPairingCode(user: AuthenticatedUser, codeHash: string, expiresAt: string): Promise<void>;
  exchangePairingCode(codeHash: string, tokenHash: string, extensionVersion?: string): Promise<AuthenticatedUser | undefined>;
  findExtensionIdentity(tokenHash: string, extensionVersion?: string): Promise<AuthenticatedUser | undefined>;
  revokeExtensionToken(tokenHash: string): Promise<boolean>;
  connectionStatus(user: AuthenticatedUser): Promise<CaptureConnectionStatus>;
  grantOriginConsent(user: AuthenticatedUser, origin: string): Promise<void>;
  revokeOriginConsent(user: AuthenticatedUser, origin: string): Promise<boolean>;
}

export class CaptureInputError extends Error {}
export class CaptureConflictError extends Error {}

const serverCapabilities: CaptureHandshake["capabilities"] = ["semantic-elements", "frames", "shadow-dom", "navigation", "downloads", "tabs", "offline-buffer"];

export class CaptureService {
  public constructor(
    private readonly store: CaptureStore,
    private readonly mvpPolicy: Readonly<MvpPolicy> = disabledMvpPolicy,
  ) {}

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
    for (const action of result.value.actions) this.assertCaptureBoundary(action);
    const origins = new Set(result.value.actions.map((action) => action.origin));
    if (origins.size > 20) throw new CaptureInputError("A capture batch contains too many browser origins.");
    return this.store.syncBatch(user, result.value);
  }

  public async findSession(user: AuthenticatedUser, sessionId: string): Promise<CaptureSession | undefined> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new CaptureInputError("Capture session ID is invalid.");
    return this.store.findSession(user, sessionId);
  }

  public async listSessions(user: AuthenticatedUser, limit = 20): Promise<CaptureSessionSummary[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CaptureInputError("Capture session list limit must be between 1 and 100.");
    return this.store.listSessions(user, limit);
  }

  public async createPairingCode(user: AuthenticatedUser, now = new Date()): Promise<{ code: string; expiresAt: string }> {
    const code = randomBytes(10).toString("base64url").toUpperCase();
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    await this.store.createPairingCode(user, hash(code), expiresAt);
    return { code, expiresAt };
  }

  public async exchangePairingCode(input: unknown): Promise<{ token: string }> {
    if (!isRecord(input) || typeof input.code !== "string" || !/^[A-Z0-9_-]{12,32}$/.test(input.code) || Object.keys(input).some((key) => key !== "code" && key !== "extensionVersion")) throw new CaptureInputError("Pairing code is invalid.");
    const extensionVersion = input.extensionVersion === undefined ? undefined : requireExtensionVersion(input.extensionVersion);
    if (this.mvpPolicy.enabled && !extensionVersion) throw new CaptureInputError("The extension version is required for pilot pairing.");
    const token = randomBytes(32).toString("base64url");
    const user = await this.store.exchangePairingCode(hash(input.code), hash(token), extensionVersion);
    if (!user) throw new CaptureInputError("Pairing code is invalid or expired.");
    return { token };
  }

  public async authenticateExtension(authorization: string | undefined, extensionVersion?: unknown): Promise<AuthenticatedUser | undefined> {
    const match = /^Bearer ([A-Za-z0-9_-]{40,80})$/.exec(authorization ?? "");
    const version = extensionVersion === undefined ? undefined : typeof extensionVersion === "string" && /^\d+\.\d+\.\d+$/.test(extensionVersion) ? extensionVersion : undefined;
    if (extensionVersion !== undefined && !version) return undefined;
    return match?.[1] ? this.store.findExtensionIdentity(hash(match[1]), version) : undefined;
  }

  public async revokeExtension(authorization: string | undefined): Promise<boolean> {
    const match = /^Bearer ([A-Za-z0-9_-]{40,80})$/.exec(authorization ?? "");
    return match?.[1] ? this.store.revokeExtensionToken(hash(match[1])) : false;
  }

  public connectionStatus(user: AuthenticatedUser): Promise<CaptureConnectionStatus> {
    return this.store.connectionStatus(user);
  }

  public async grantOriginConsent(user: AuthenticatedUser, origin: unknown): Promise<{ origin: string; granted: true }> {
    const exactOrigin = this.requireConsentOrigin(origin);
    await this.store.grantOriginConsent(user, exactOrigin);
    return { origin: exactOrigin, granted: true };
  }

  public async revokeOriginConsent(user: AuthenticatedUser, origin: unknown): Promise<{ origin: string; revoked: boolean }> {
    const exactOrigin = this.requireConsentOrigin(origin);
    return { origin: exactOrigin, revoked: await this.store.revokeOriginConsent(user, exactOrigin) };
  }

  private requireConsentOrigin(value: unknown): string {
    if (typeof value !== "string") throw new CaptureInputError("An exact HTTPS origin is required.");
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new CaptureInputError("An exact HTTPS origin is required."); }
    if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) throw new CaptureInputError("An exact HTTPS origin is required.");
    if (this.mvpPolicy.enabled && value !== this.mvpPolicy.pilotOrigin) throw new CaptureInputError("Only the configured pilot origin can be approved.");
    return value;
  }

  private assertCaptureBoundary(action: CaptureSyncRequest["actions"][number]): void {
    if (this.mvpPolicy.enabled && action.origin !== this.mvpPolicy.pilotOrigin) throw new CaptureInputError("Capture is limited to the configured pilot origin.");
    if (action.value !== undefined) throw new CaptureInputError("Captured field values are not accepted.");
    if (action.path.includes("?") || action.before?.urlPattern.includes("?") || action.after?.urlPattern.includes("?")) throw new CaptureInputError("Capture URLs must not include query strings.");
    for (const page of [action.before, action.after]) {
      if (page?.titleHint !== undefined) throw new CaptureInputError("Captured page content is not accepted.");
    }
    const target = action.target;
    if (action.locator) this.assertValueFreeLocator(action.locator);
    if (!target) return;
    if (target.accessibleName !== undefined || target.textHint !== undefined || target.cssCandidate !== undefined || target.framePath.length > 0) throw new CaptureInputError("Captured page content and raw selectors are not accepted.");
    this.assertValueFreeLocator(target.locator);
  }

  private assertValueFreeLocator(locator: NonNullable<CaptureSyncRequest["actions"][number]["locator"]>): void {
    const locators = [locator.primary, ...locator.fallbacks];
    if (locators.some((locator) => locator.strategy !== "id" && locator.strategy !== "capture-id")) throw new CaptureInputError("Pilot captures require a stable value-free element identifier.");
  }
}

function validateSequence(request: CaptureSyncRequest): void {
  for (const [index, action] of request.actions.entries()) {
    const expected = request.cursor + index + 1;
    if (action.sequence !== expected) throw new CaptureInputError(`Capture action ${index + 1} must use sequence ${expected}.`);
  }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function requireExtensionVersion(value: unknown): string { if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) throw new CaptureInputError("Extension version is invalid."); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
