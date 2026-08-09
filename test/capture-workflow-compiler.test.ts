import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AuthoringSuggestion, CaptureSession, ElementEvidence, PageState, RecordedAction } from "../src/contracts/protocol.js";
import { CaptureWorkflowCompiler, captureCompilerVersion, compileCaptureSession, isCaptureCompilerVersionCompatible } from "../src/compiler/capture-workflow-compiler.js";

const origin = "https://reports.example.test";
const sessionId = "d0c4d3b2-9f6e-4a1d-b2c3-8a7d6e5f4a3b";
const actionIds = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
] as const;

test("matches the report-download capture golden compilation", () => {
  const compilation = compileCaptureSession(reportDownloadSession());
  const actual = {
    compilerVersion: compilation.compilerVersion,
    digestLength: compilation.sourceDigest.length,
    title: compilation.workflow.title,
    domains: compilation.workflow.allowedDomains,
    inputs: compilation.workflow.inputs,
    steps: compilation.workflow.steps.map((step) => ({ action: step.action, name: step.name, expectedOutcome: step.expectedOutcome })),
    warningCodes: compilation.warnings.map(({ code }) => code),
    coverage: compilation.coverage.map(({ outcome }) => outcome),
    provenanceSources: [...new Set(compilation.provenance.map(({ source }) => source))].sort(),
  };
  const golden = JSON.parse(readFileSync(new URL("./golden/report-download-compilation.json", import.meta.url), "utf8"));
  assert.deepEqual(actual, golden);
});

test("is idempotent for the same capture and compiler version", () => {
  const first = compileCaptureSession(reportDownloadSession());
  const second = compileCaptureSession(structuredClone(reportDownloadSession()));
  assert.equal(captureCompilerVersion, "1.0.0");
  assert.deepEqual(second, first);
  assert.match(first.sourceDigest, /^[a-f0-9]{64}$/);
});

test("keeps stored compilations readable across compatible compiler upgrades", () => {
  assert.equal(isCaptureCompilerVersionCompatible("1.0.0"), true);
  assert.equal(isCaptureCompilerVersionCompatible("1.9.4"), true);
  assert.equal(isCaptureCompilerVersionCompatible("2.0.0"), false);
  assert.equal(isCaptureCompilerVersionCompatible("future"), false);
});

test("coalesces noisy typing while preserving action coverage and variable inference", () => {
  const session = reportDownloadSession();
  const duplicate = { ...session.actions[1]!, id: actionIds[2], sequence: 2, eventKind: "change" as const, occurredAt: "2026-08-09T00:00:01.500Z" };
  session.actions = [session.actions[0]!, session.actions[1]!, duplicate];
  const compilation = compileCaptureSession(session);
  assert.deepEqual(compilation.workflow.steps.map(({ action }) => action), ["navigate", "type"]);
  assert.equal(compilation.workflow.inputs[0]?.name, "report_date");
  assert.deepEqual(compilation.coverage.map(({ outcome }) => outcome), ["emitted", "emitted", "combined"]);
  assert.equal(compilation.warnings.some(({ code }) => code === "compiler.variable-input-suggested"), true);
});

test("infers a bounded wait from navigation evidence and links both emitted steps to the action", () => {
  const session = reportDownloadSession();
  session.actions = session.actions.slice(0, 2);
  session.actions[1] = { ...session.actions[1]!, before: pageState("00000000-0000-4000-8000-000000000011") };
  const compilation = compileCaptureSession(session);
  assert.deepEqual(compilation.workflow.steps.map(({ action }) => action), ["navigate", "wait", "type"]);
  assert.equal(compilation.workflow.steps[1]?.action === "wait" ? compilation.workflow.steps[1].timeoutMs : undefined, 10000);
  assert.equal(compilation.coverage[1]?.stepIds.length, 2);
});

test("represents unsupported actions as review steps with explicit warnings", () => {
  const session = reportDownloadSession();
  session.actions = [{ ...session.actions[1]!, id: actionIds[0], sequence: 0, eventKind: "toggle", value: undefined }];
  const compilation = compileCaptureSession(session);
  assert.equal(compilation.workflow.steps[0]?.action, "ask-approval");
  assert.equal(compilation.coverage[0]?.outcome, "unsupported");
  assert.equal(compilation.warnings.some(({ code }) => code === "compiler.unsupported-action"), true);
  assert.equal(compilation.warnings.some(({ code }) => code === "compiler.missing-final-assertion"), true);
});

test("keeps optional authoring-provider output separate from the deterministic draft", async () => {
  const suggestion: AuthoringSuggestion = { path: "/workflow/title", value: "Download weekly report", confidence: 0.8, reason: "The page title and final download suggest a report workflow.", actionIds: [actionIds[2]] };
  const compiler = new CaptureWorkflowCompiler({ suggest: async () => [suggestion] });
  const compiled = await compiler.compile(reportDownloadSession());
  const base = compileCaptureSession(reportDownloadSession());
  assert.deepEqual(compiled.workflow, base.workflow);
  assert.deepEqual(compiled.suggestions, [suggestion]);
  assert.equal(compiled.provenance.some(({ source }) => source === "ai-suggested"), false);
});

test("rejects unfinished sessions and sequence gaps before emitting a draft", () => {
  assert.throws(() => compileCaptureSession({ ...reportDownloadSession(), status: "recording" }), /finalized/);
  const session = reportDownloadSession();
  session.actions[1] = { ...session.actions[1]!, sequence: 9 };
  assert.throws(() => compileCaptureSession(session), /contiguous/);
});

function reportDownloadSession(): CaptureSession {
  const reportField = evidence("textbox", "Report date", "date", "report-date");
  const downloadButton = evidence("button", "Download report", undefined, "download-report");
  const page = pageState("00000000-0000-4000-8000-000000000010");
  return {
    schemaVersion: 1,
    format: "doonce.capture-session.v1",
    id: sessionId,
    startedAt: "2026-08-09T00:00:00.000Z",
    endedAt: "2026-08-09T00:00:05.000Z",
    status: "finalized",
    approvedOrigins: [origin],
    actions: [
      action(0, actionIds[0], "navigate", { after: page }),
      action(1, actionIds[1], "input", { target: reportField, locator: reportField.locator, before: page, after: page, value: { classification: "variable-candidate", placeholder: "report_date", length: 10 } }),
      action(2, actionIds[2], "click", { target: downloadButton, locator: downloadButton.locator, before: page, after: page, actionHint: "download" }),
      action(3, actionIds[3], "download-start", { before: page, after: page }),
      action(4, actionIds[4], "download-complete", { before: page, after: page }),
    ],
  };
}

function action(sequence: number, id: string, eventKind: RecordedAction["eventKind"], extra: Partial<RecordedAction>): RecordedAction {
  return { schemaVersion: 1, id, sequence, occurredAt: `2026-08-09T00:00:0${sequence}.000Z`, origin, path: "/reports", eventKind, ...extra };
}

function pageState(navigationId: string): PageState {
  return { capturedAt: "2026-08-09T00:00:00.000Z", origin, path: "/reports", urlPattern: `${origin}/reports`, navigationId, titleHint: "Reports", domFingerprint: "abcdef0123456789" };
}

function evidence(role: string, accessibleName: string, inputType: string | undefined, testId: string): ElementEvidence {
  const locator = { schemaVersion: 1 as const, primary: { strategy: "capture-id" as const, value: testId, confidence: 1 }, fallbacks: [{ strategy: "role" as const, value: `${role}:${accessibleName}`, confidence: 0.9 }] };
  return { role, accessibleName, testId, tagName: role === "button" ? "button" : "input", ...(inputType ? { inputType } : {}), framePath: [], domFingerprint: "abcdef0123456789", visibility: { inViewport: true, ratio: 1, viewportWidth: 1280, viewportHeight: 800 }, locator };
}
