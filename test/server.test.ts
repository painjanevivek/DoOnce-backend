import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/server.js";

test("health endpoint sends explicit browser security headers", async (t) => {
  const app = buildServer();
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.headers["content-security-policy"], "default-src 'none';base-uri 'none';frame-ancestors 'none';form-action 'none'");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("policy API blocks a prohibited action", async (t) => {
  const app = buildServer();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/policy/evaluate",
    payload: { action: "payment" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    verdict: "blocked",
    risk: "irreversible",
    ruleId: "policy.prohibited-action",
    reason: "Submission, deletion, financial and credential actions are prohibited in version 1.",
  });
});

test("policy API rejects unknown request fields", async (t) => {
  const app = buildServer();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/policy/evaluate",
    payload: { action: "read", unexpected: "value" },
  });

  assert.equal(response.statusCode, 400);
});
