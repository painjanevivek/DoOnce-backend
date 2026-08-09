import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/auth/auth-service.js";
import type { SecretProvider } from "../src/hosted/secret-provider.js";
import type { RunService } from "../src/runner/run-service.js";
import { WebhookAuthenticationError, WebhookService, webhookSignature, type WebhookEndpoint, type WebhookEndpointRecord, type WebhookStore } from "../src/triggers/webhook-service.js";

const endpoint: WebhookEndpointRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  createdBy: "33333333-3333-4333-8333-333333333333",
  createdByEmail: "builder@example.test",
  workflowId: "44444444-4444-4444-8444-444444444444",
  sessionProfileId: "55555555-5555-4555-8555-555555555555",
  signingSecretReference: "env://WEBHOOK_SECRET",
  enabled: true,
  createdAt: new Date().toISOString(),
};

class MemoryWebhookStore implements WebhookStore {
  public receipts: string[] = [];
  public create(_user: AuthenticatedUser, value: WebhookEndpointRecord): Promise<WebhookEndpoint> { return Promise.resolve(value); }
  public list(): Promise<WebhookEndpoint[]> { return Promise.resolve([endpoint]); }
  public findInternal(): Promise<WebhookEndpointRecord> { return Promise.resolve(endpoint); }
  public recordReceipt(_endpoint: WebhookEndpointRecord, key: string): Promise<void> { this.receipts.push(key); return Promise.resolve(); }
}

test("authenticates a canonical webhook and routes one managed run", async () => {
  const store = new MemoryWebhookStore();
  const requested: unknown[] = [];
  const runs = { create: (_user: AuthenticatedUser, input: unknown) => { requested.push(input); return Promise.resolve({ created: true, run: { id: "66666666-6666-4666-8666-666666666666" } }); } } as unknown as RunService;
  const secrets: SecretProvider = { resolve: () => Promise.resolve("top-secret") };
  const service = new WebhookService(store, secrets, runs);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = { inputs: { region: "north" } };
  const result = await service.trigger(endpoint.id, body, { timestamp, idempotencyKey: "delivery:1234", signature: webhookSignature("top-secret", timestamp, JSON.stringify(body)) });
  assert.equal(result.created, true);
  assert.equal(store.receipts[0], "delivery:1234");
  assert.deepEqual(requested[0], { workflowId: endpoint.workflowId, inputs: body.inputs, idempotencyKey: "webhook:delivery:1234", mode: "production", triggerKind: "webhook", sessionLocation: "managed", sessionProfileId: endpoint.sessionProfileId });
});

test("rejects a stale or incorrect webhook signature", async () => {
  const service = new WebhookService(new MemoryWebhookStore(), { resolve: () => Promise.resolve("top-secret") }, { create: () => Promise.reject(new Error("must not run")) } as unknown as RunService);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  await assert.rejects(() => service.trigger(endpoint.id, { inputs: {} }, { timestamp, idempotencyKey: "delivery:5678", signature: "v1=wrong" }), WebhookAuthenticationError);
  await assert.rejects(() => service.trigger(endpoint.id, { inputs: {} }, { timestamp: "1000000000", idempotencyKey: "delivery:5678", signature: "v1=wrong" }), WebhookAuthenticationError);
});
