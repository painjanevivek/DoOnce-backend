import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { RunService } from "../runner/run-service.js";
import type { SecretProvider } from "../hosted/secret-provider.js";

export interface WebhookEndpoint {
  id: string;
  workflowId: string;
  sessionProfileId: string;
  enabled: boolean;
  createdAt: string;
}

export interface WebhookEndpointRecord extends WebhookEndpoint {
  tenantId: string;
  createdBy: string;
  createdByEmail: string;
  signingSecretReference: string;
}

export interface WebhookStore {
  create(user: AuthenticatedUser, endpoint: WebhookEndpointRecord): Promise<WebhookEndpoint>;
  list(user: AuthenticatedUser, workflowId?: string): Promise<WebhookEndpoint[]>;
  findInternal(id: string): Promise<WebhookEndpointRecord | undefined>;
  recordReceipt(endpoint: WebhookEndpointRecord, idempotencyKey: string): Promise<void>;
}

export class WebhookInputError extends Error {}
export class WebhookAccessError extends Error {}
export class WebhookAuthenticationError extends Error {}

export class WebhookService {
  public constructor(private readonly store: WebhookStore, private readonly secrets: SecretProvider, private readonly runs: RunService) {}

  public create(user: AuthenticatedUser, input: unknown): Promise<WebhookEndpoint> {
    requireAuthor(user);
    if (!record(input)) throw new WebhookInputError("The webhook request is invalid.");
    const signingSecretReference = secretReference(input.signingSecretReference);
    const timestamp = new Date().toISOString();
    return this.store.create(user, {
      id: randomUUID(),
      tenantId: user.tenantId,
      createdBy: user.userId,
      createdByEmail: user.email,
      workflowId: uuid(input.workflowId),
      sessionProfileId: uuid(input.sessionProfileId),
      signingSecretReference,
      enabled: true,
      createdAt: timestamp,
    });
  }

  public list(user: AuthenticatedUser, workflowId?: string): Promise<WebhookEndpoint[]> {
    return this.store.list(user, workflowId ? uuid(workflowId) : undefined);
  }

  public async trigger(id: string, input: unknown, headers: { timestamp?: string; signature?: string; idempotencyKey?: string }): Promise<{ created: boolean; runId: string }> {
    const endpoint = await this.store.findInternal(uuid(id));
    if (!endpoint?.enabled) throw new WebhookInputError("Webhook endpoint not found.");
    const timestamp = verifyTimestamp(headers.timestamp);
    const idempotencyKey = verifyIdempotencyKey(headers.idempotencyKey);
    const parsed = parseTriggerInput(input);
    const canonicalBody = JSON.stringify(parsed);
    const secret = await this.secrets.resolve(endpoint.signingSecretReference);
    verifySignature(secret, timestamp, canonicalBody, headers.signature);
    await this.store.recordReceipt(endpoint, idempotencyKey);
    const user: AuthenticatedUser = { tenantId: endpoint.tenantId, userId: endpoint.createdBy, email: endpoint.createdByEmail, role: "builder" };
    const result = await this.runs.create(user, {
      workflowId: endpoint.workflowId,
      inputs: parsed.inputs,
      idempotencyKey: `webhook:${idempotencyKey}`,
      mode: "production",
      triggerKind: "webhook",
      sessionLocation: "managed",
      sessionProfileId: endpoint.sessionProfileId,
    });
    return { created: result.created, runId: result.run.id };
  }
}

export function webhookSignature(secret: string, timestamp: string, canonicalBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${canonicalBody}`).digest("hex")}`;
}

function verifySignature(secret: string, timestamp: string, canonicalBody: string, supplied: string | undefined): void {
  const expected = Buffer.from(webhookSignature(secret, timestamp, canonicalBody));
  const actual = Buffer.from(supplied ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new WebhookAuthenticationError("Webhook signature is invalid.");
}

function verifyTimestamp(value: string | undefined): string {
  if (!value || !/^\d{10}$/.test(value)) throw new WebhookAuthenticationError("Webhook timestamp is invalid.");
  if (Math.abs(Date.now() - Number(value) * 1000) > 5 * 60_000) throw new WebhookAuthenticationError("Webhook timestamp is outside the five-minute window.");
  return value;
}

function verifyIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[a-zA-Z0-9._:-]{8,128}$/.test(value)) throw new WebhookInputError("A valid Idempotency-Key header is required.");
  return value;
}

function parseTriggerInput(input: unknown): { inputs: Record<string, string> } {
  if (!record(input) || Object.keys(input).some((key) => key !== "inputs") || !record(input.inputs) || Object.keys(input.inputs).length > 50 || !Object.values(input.inputs).every((value) => typeof value === "string" && value.length <= 10_000)) {
    throw new WebhookInputError("Webhook inputs must contain at most 50 text values.");
  }
  return { inputs: input.inputs as Record<string, string> };
}

function secretReference(value: unknown): string {
  if (typeof value !== "string" || !/^(env|vault|aws-sm|gcp-sm):\/\/[a-zA-Z0-9_./:-]+$/.test(value)) throw new WebhookInputError("Provide a supported signing secret reference.");
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new WebhookInputError("A valid identifier is required.");
  return value;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireAuthor(user: AuthenticatedUser): void { if (user.role !== "owner" && user.role !== "builder") throw new WebhookAccessError("Only workflow owners and builders can create webhooks."); }
