import { stat } from "node:fs/promises";
import type { Browser, BrowserContext, BrowserContextOptions, Download, Locator, Page } from "playwright-core";
import { chromium } from "playwright-core";
import type { LocatorCandidate, RunRequest, RunResult, StepResult, WorkflowSpec, WorkflowStep } from "../contracts/protocol.js";
import type { SecretProvider } from "./secret-provider.js";

export interface HostedExecutionLimits {
  totalTimeoutMs: number;
  actionTimeoutMs: number;
  maxSteps: number;
  maxPages: number;
  maxDownloadBytes: number;
}

export interface HostedExecutionInput {
  request: RunRequest;
  workflow: WorkflowSpec;
  secretReference: string;
}

export interface HostedExecutor {
  execute(input: HostedExecutionInput, signal?: AbortSignal): Promise<RunResult>;
}

export type BrowserLauncher = (options: { headless: boolean; executablePath?: string }) => Promise<Browser>;

const defaults: HostedExecutionLimits = {
  totalTimeoutMs: 10 * 60_000,
  actionTimeoutMs: 30_000,
  maxSteps: 500,
  maxPages: 1,
  maxDownloadBytes: 100 * 1024 * 1024,
};

export class PlaywrightExecutor implements HostedExecutor {
  public constructor(
    private readonly secrets: SecretProvider,
    private readonly limits: HostedExecutionLimits = defaults,
    private readonly launch: BrowserLauncher = (options) => chromium.launch(options),
    private readonly executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  ) {}

  public async execute(input: HostedExecutionInput, signal?: AbortSignal): Promise<RunResult> {
    if (input.request.executor !== "hosted-browser") throw new Error("The hosted executor received a local extension run.");
    if (input.workflow.steps.length > this.limits.maxSteps) throw new Error("The workflow exceeds the hosted step limit.");
    const storageState = parseStorageState(await this.secrets.resolve(input.secretReference));
    const browser = await this.launch({ headless: true, ...(this.executablePath ? { executablePath: this.executablePath } : {}) });
    const context = await browser.newContext({ storageState, acceptDownloads: true });
    const deadline = AbortSignal.timeout(this.limits.totalTimeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      return await this.executeInContext(context, input, combinedSignal);
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private async executeInContext(context: BrowserContext, input: HostedExecutionInput, signal: AbortSignal): Promise<RunResult> {
    context.setDefaultTimeout(this.limits.actionTimeoutMs);
    context.on("page", (page) => {
      if (context.pages().length > this.limits.maxPages) void page.close();
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (isAllowedUrl(url, input.workflow.allowedDomains)) await route.continue();
      else await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    const variables = { ...input.request.inputs };
    const results: StepResult[] = [];
    const indexes = new Map(input.workflow.steps.map((step, index) => [step.id, index]));
    let index = 0;
    let failedReason: string | undefined;

    while (index < input.workflow.steps.length) {
      if (signal.aborted) throw signal.reason;
      const step = input.workflow.steps[index] as WorkflowStep;
      const startedAt = new Date().toISOString();
      try {
        const outcome = await executeStep(page, step, variables, this.limits.maxDownloadBytes);
        results.push({ schemaVersion: 1, stepId: step.id, status: "verified", startedAt, finishedAt: new Date().toISOString(), ...(outcome.locator ? { selectedLocator: outcome.locator, locatorConfidence: outcome.locator.confidence } : {}), ...(outcome.outputs ? { outputs: outcome.outputs } : {}) });
        if (step.action === "branch") {
          const nextId = compare(variables[step.inputName] ?? "", step.operator, substitute(step.expected, variables)) ? step.ifTrueStepId : step.ifFalseStepId;
          if (!nextId) break;
          const nextIndex = indexes.get(nextId);
          if (nextIndex === undefined) throw new Error("A branch points to a missing workflow step.");
          index = nextIndex;
          continue;
        }
        if (step.action === "stop") break;
      } catch (error) {
        failedReason = error instanceof Error ? error.message : "Hosted execution failed.";
        results.push({ schemaVersion: 1, stepId: step.id, status: "failed", reasonCode: normalizeReason(error), startedAt, finishedAt: new Date().toISOString() });
        break;
      }
      index += 1;
    }

    return {
      schemaVersion: 1,
      format: "doonce.run-result.v1",
      runId: input.request.runId,
      workflowId: input.request.workflowId,
      workflowVersion: input.request.workflowVersion,
      status: failedReason ? "failed" : "completed",
      ...(failedReason ? { reasonCode: "hosted.execution-failed" } : {}),
      stepResults: results,
      startedAt: results[0]?.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }
}

async function executeStep(page: Page, step: WorkflowStep, variables: Record<string, string>, maxDownloadBytes: number): Promise<{ locator?: LocatorCandidate; outputs?: Record<string, string> }> {
  switch (step.action) {
    case "navigate":
      await page.goto(targetUrl(step.target.domain, step.target.path), { waitUntil: "domcontentloaded" });
      return {};
    case "wait": {
      const selected = await exactLocator(page, step.target.locator);
      await selected.locator.waitFor({ state: "visible", timeout: step.timeoutMs });
      return { locator: selected.candidate };
    }
    case "read": {
      const selected = await exactLocator(page, step.target.locator);
      const value = (await selected.locator.innerText()).trim();
      variables[step.outputName] = value;
      return { locator: selected.candidate, outputs: { [step.outputName]: value } };
    }
    case "select": {
      const selected = await exactLocator(page, step.target.locator);
      await selected.locator.selectOption(requireInput(step.inputName, variables));
      return { locator: selected.candidate };
    }
    case "type": {
      const selected = await exactLocator(page, step.target.locator);
      await selected.locator.fill(requireInput(step.inputName, variables));
      return { locator: selected.candidate };
    }
    case "download": {
      const selected = await exactLocator(page, step.target.locator);
      const download = await Promise.all([page.waitForEvent("download"), selected.locator.click()]).then(([item]) => item);
      await enforceDownloadLimit(download, maxDownloadBytes);
      return { locator: selected.candidate };
    }
    case "compare": {
      const selected = await exactLocator(page, step.target.locator);
      const observed = (await selected.locator.innerText()).trim();
      if (!compare(observed, step.operator, substitute(step.expected, variables))) throw new Error("The comparison did not match the observed page.");
      return { locator: selected.candidate };
    }
    case "branch":
    case "stop":
      return {};
    case "ask-approval":
      throw new Error("Managed execution cannot pause for interactive approval.");
  }
}

async function exactLocator(page: Page, spec: { primary: LocatorCandidate; fallbacks: LocatorCandidate[] }): Promise<{ locator: Locator; candidate: LocatorCandidate }> {
  for (const candidate of [spec.primary, ...spec.fallbacks]) {
    const locator = locatorFor(page, candidate);
    if (await locator.count() === 1) return { locator, candidate };
  }
  throw new Error("No locator candidate matched exactly one element.");
}

function locatorFor(page: Page, candidate: LocatorCandidate): Locator {
  switch (candidate.strategy) {
    case "id": return page.locator(`#${cssEscape(candidate.value)}`);
    case "capture-id": return page.locator(`[data-doonce-id="${attributeEscape(candidate.value)}"]`);
    case "role": {
      const [role, ...nameParts] = candidate.value.split(":");
      return page.getByRole(role as Parameters<Page["getByRole"]>[0], nameParts.length ? { name: nameParts.join(":") } : undefined);
    }
    case "label": return page.getByLabel(candidate.value, { exact: true });
    case "text": return page.getByText(candidate.value, { exact: true });
  }
}

async function enforceDownloadLimit(download: Download, maxBytes: number): Promise<void> {
  const path = await download.path();
  if (!path) throw new Error("The browser did not produce a downloadable file.");
  const file = await stat(path);
  if (file.size > maxBytes) {
    await download.delete();
    throw new Error("The download exceeds the configured byte limit.");
  }
}

function parseStorageState(value: string): NonNullable<BrowserContextOptions["storageState"]> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as NonNullable<BrowserContextOptions["storageState"]>;
  } catch {
    throw new Error("The managed browser session secret is not valid Playwright storage state.");
  }
}

function isAllowedUrl(url: URL, domains: string[]): boolean {
  if (["data:", "about:", "blob:"].includes(url.protocol)) return true;
  return (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    && domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}

function targetUrl(domain: string, path: string): string {
  const protocol = ["localhost", "127.0.0.1"].includes(domain) ? "http" : "https";
  return new URL(path.startsWith("/") ? path : `/${path}`, `${protocol}://${domain}`).toString();
}

function requireInput(name: string, variables: Record<string, string>): string {
  const value = variables[name];
  if (value === undefined) throw new Error(`Workflow input ${name} is unavailable.`);
  return value;
}

function compare(observed: string, operator: "equals" | "contains" | "matches", expected: string): boolean {
  if (operator === "equals") return observed === expected;
  if (operator === "contains") return observed.includes(expected);
  try {
    return new RegExp(expected, "u").test(observed);
  } catch {
    throw new Error("The workflow contains an invalid comparison pattern.");
  }
}

function substitute(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_match, name: string) => variables[name] ?? "");
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character.codePointAt(0)?.toString(16)} `);
}

function attributeEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function normalizeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("exactly one")) return "locator.no-exact-match";
  if (message.includes("Timeout")) return "step.timeout";
  if (message.includes("download")) return "download.limit-or-missing";
  if (message.includes("approval")) return "approval.requires-user-browser";
  return "hosted.step-failed";
}
