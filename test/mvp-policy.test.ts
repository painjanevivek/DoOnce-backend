import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { assertMvpWorkflowAllowed, MvpPolicyError, mvpPolicyFromEnvironment } from "../src/system/mvp-policy.js";
import { validProtocolFixtures } from "./fixtures/protocol-v1.js";

const reportWorkflow: WorkflowSpec = {
  ...(validProtocolFixtures.WorkflowSpec as WorkflowSpec),
  successCriteria: [{
    id: "e0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b",
    name: "Report file exists",
    kind: "file-downloaded",
    fileNamePattern: "report-*.csv",
    minBytes: 1,
    maxBytes: 10_000_000,
  }],
};

test("requires one canonical public HTTPS origin when MVP mode is enabled", () => {
  const policy = mvpPolicyFromEnvironment({ DOONCE_MVP_MODE: "true", DOONCE_PILOT_ALLOWED_ORIGIN: "https://reports.example.test" });
  assert.deepEqual(policy, { enabled: true, pilotOrigin: "https://reports.example.test", pilotDomain: "reports.example.test" });

  for (const origin of [
    undefined,
    "http://reports.example.test",
    "https://reports.example.test/",
    "https://reports.example.test/path",
    "https://reports.example.test:8443",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://192.168.1.2",
    "https://[::1]",
  ]) {
    assert.throws(
      () => mvpPolicyFromEnvironment({ DOONCE_MVP_MODE: "true", DOONCE_PILOT_ALLOWED_ORIGIN: origin }),
      /HTTPS origin|public HTTPS origin/,
    );
  }
});

test("allows only the exact verified report-download wedge", () => {
  const policy = mvpPolicyFromEnvironment({ DOONCE_MVP_MODE: "true", DOONCE_PILOT_ALLOWED_ORIGIN: "https://reports.example.test" });
  assert.doesNotThrow(() => assertMvpWorkflowAllowed(reportWorkflow, policy));

  assert.throws(
    () => assertMvpWorkflowAllowed({ ...reportWorkflow, allowedDomains: ["other.example.test"] }, policy),
    MvpPolicyError,
  );
  assert.throws(
    () => assertMvpWorkflowAllowed({ ...reportWorkflow, allowedDomains: ["reports.example.test", "other.example.test"] }, policy),
    MvpPolicyError,
  );
  assert.throws(
    () => assertMvpWorkflowAllowed({ ...reportWorkflow, steps: reportWorkflow.steps.filter((step) => step.action !== "download") }, policy),
    /single-download-required/,
  );
  assert.throws(
    () => assertMvpWorkflowAllowed({ ...reportWorkflow, inputs: [{ name: "secret", label: "Secret", kind: "text", required: true }] }, policy),
    /typed inputs/,
  );
  assert.throws(
    () => assertMvpWorkflowAllowed({ ...reportWorkflow, successCriteria: [] }, policy),
    /verification-required/,
  );
});
