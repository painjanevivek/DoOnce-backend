import assert from "node:assert/strict";
import test from "node:test";
import { releaseIdentityFromEnvironment } from "../src/release/release-identity.js";

const valid = {
  NODE_ENV: "production",
  DOONCE_MVP_MODE: "true",
  DOONCE_DEPLOYMENT_ID: "mvp-2026-08-24.1",
  DOONCE_ENVIRONMENT: "pilot-production",
  DOONCE_BACKEND_COMMIT: "a".repeat(40),
  DOONCE_FRONTEND_COMMIT: "b".repeat(40),
  DOONCE_BACKEND_IMAGE_DIGEST: `sha256:${"c".repeat(64)}`,
  DOONCE_FRONTEND_IMAGE_DIGEST: `sha256:${"d".repeat(64)}`,
  DOONCE_EXTENSION_ID: "a".repeat(32),
  DOONCE_EXTENSION_VERSION: "0.4.0",
  DOONCE_EXTENSION_PACKAGE_SHA256: "e".repeat(64),
  DOONCE_PROTOCOL_SCHEMA_SHA256: "f".repeat(64),
  DOONCE_MIGRATION_SET_SHA256: "1".repeat(64),
} satisfies NodeJS.ProcessEnv;

test("requires one complete immutable identity for a production MVP deployment", () => {
  const identity = releaseIdentityFromEnvironment(valid);
  assert.equal(identity?.deploymentId, "mvp-2026-08-24.1");
  assert.equal(identity?.extensionVersion, "0.4.0");
  assert.throws(() => releaseIdentityFromEnvironment({ ...valid, DOONCE_FRONTEND_COMMIT: "" }), /incomplete/);
  assert.throws(() => releaseIdentityFromEnvironment({ ...valid, DOONCE_EXTENSION_ID: "z".repeat(32) }), /DOONCE_EXTENSION_ID/);
});

test("allows an unconfigured identity only outside the production MVP", () => {
  assert.equal(releaseIdentityFromEnvironment({ NODE_ENV: "test" }), undefined);
  assert.throws(() => releaseIdentityFromEnvironment({ NODE_ENV: "production", DOONCE_MVP_MODE: "true" }), /incomplete/);
});
