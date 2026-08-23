import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowSpec } from "../src/contracts/protocol.js";
import { HostedQualificationError, HostedQualificationRegistry, parseHostedQualifications } from "../src/hosted/hosted-qualification.js";

const checksum = "a".repeat(64);
const workflow: WorkflowSpec = {
  schemaVersion: 1,
  format: "doonce.workflow-spec.v1",
  title: "Weekly report",
  allowedDomains: ["reports.example.test"],
  inputs: [],
  steps: [
    { id: "11111111-1111-4111-8111-111111111111", action: "navigate", name: "Open", expectedOutcome: "Reports open", target: { domain: "reports.example.test", path: "/reports" } },
    { id: "22222222-2222-4222-8222-222222222222", action: "download", name: "Download", expectedOutcome: "Report downloads", target: { domain: "reports.example.test", locator: { candidates: [{ strategy: "role", value: "button", name: "Download report" }] } } },
  ],
  successCriteria: [{ id: "33333333-3333-4333-8333-333333333333", kind: "download", operator: "exists" }],
};

const record = {
  id: "reports-example-v1",
  pattern: "report-download",
  workflowChecksum: checksum,
  allowedDomain: "reports.example.test",
  browserImageDigest: `sha256:${"b".repeat(64)}`,
  evidenceReference: "drills/hosted/reports-example-v1.json",
  qualifiedAt: "2026-08-20T00:00:00.000Z",
  expiresAt: "2026-09-20T00:00:00.000Z",
  controls: { isolation: "verified", egress: "verified", managedSession: "verified" },
};

test("qualifies only the exact reviewed workflow, domain, and validity window", () => {
  const [parsed] = parseHostedQualifications(JSON.stringify([record]));
  const registry = new HostedQualificationRegistry([parsed!]);
  assert.equal(registry.requireQualified(workflow, checksum, new Date("2026-08-24T00:00:00.000Z")).id, record.id);
  assert.throws(() => registry.requireQualified(workflow, "c".repeat(64), new Date("2026-08-24T00:00:00.000Z")), HostedQualificationError);
  assert.throws(() => registry.requireQualified(workflow, checksum, new Date("2026-10-01T00:00:00.000Z")), /expired/);
});

test("rejects mutable images, wildcards, unknown fields, and incomplete controls", () => {
  assert.throws(() => parseHostedQualifications(JSON.stringify([{ ...record, browserImageDigest: "latest" }])), /pinned browser image/);
  assert.throws(() => parseHostedQualifications(JSON.stringify([{ ...record, allowedDomain: "*.example.test" }])), /exact DNS domain/);
  assert.throws(() => parseHostedQualifications(JSON.stringify([{ ...record, approvalTicket: "OPS-1" }])), /unknown field/);
  assert.throws(() => parseHostedQualifications(JSON.stringify([{ ...record, controls: { isolation: "verified" } }])), /verified isolation/);
});

test("defaults to denying every managed workflow", () => {
  assert.throws(() => new HostedQualificationRegistry([]).requireQualified(workflow, checksum), /not passed hosted qualification/);
});
