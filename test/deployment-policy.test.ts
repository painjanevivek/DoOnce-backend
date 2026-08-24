import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionMvpEnvironment } from "../src/system/deployment-policy.js";

const valid = {
  NODE_ENV: "production",
  DOONCE_MVP_MODE: "true",
  DATABASE_URL: "postgres://doonce_app:random-runtime-credential@database.example.com/doonce?sslmode=verify-full",
  TEXT_AUTHORING_ENABLED: "false",
  REPAIR_ENABLED: "false",
  VIDEO_AUTHORING_ENABLED: "false",
  DOONCE_INVITATION_CREATION_ENABLED: "false",
  DOONCE_KILL_SWITCH: "false",
  SESSION_SECRET: "session_0123456789abcdef0123456789abcdef",
  ARTIFACT_SIGNING_SECRET: "artifact_0123456789abcdef0123456789abcdef",
  METRICS_BEARER_TOKEN: "metrics_0123456789abcdef0123456789abcdef",
  ARTIFACT_STORAGE_PATH: "/var/lib/doonce/artifacts",
} satisfies NodeJS.ProcessEnv;

test("accepts an isolated, TLS-only attended MVP runtime", () => {
  assert.doesNotThrow(() => assertProductionMvpEnvironment(valid));
});

test("rejects migration/worker credentials, enabled capabilities, weak secrets, and loopback databases", () => {
  assert.throws(() => assertProductionMvpEnvironment({ ...valid, MIGRATIONS_DATABASE_URL: valid.DATABASE_URL }), /must not be present/);
  assert.throws(() => assertProductionMvpEnvironment({ ...valid, JOB_DATABASE_URL: valid.DATABASE_URL }), /must be absent/);
  assert.throws(() => assertProductionMvpEnvironment({ ...valid, TEXT_AUTHORING_ENABLED: "true" }), /explicitly be false/);
  assert.throws(() => assertProductionMvpEnvironment({ ...valid, ARTIFACT_SIGNING_SECRET: valid.SESSION_SECRET }), /must be independent/);
  assert.throws(() => assertProductionMvpEnvironment({ ...valid, DATABASE_URL: "postgres://user:secret@127.0.0.1/doonce?sslmode=require" }), /non-loopback/);
});

test("does not constrain local and test environments", () => {
  assert.doesNotThrow(() => assertProductionMvpEnvironment({ NODE_ENV: "test", DOONCE_MVP_MODE: "true" }));
});
