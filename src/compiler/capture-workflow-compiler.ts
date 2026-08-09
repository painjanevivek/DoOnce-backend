import { createHash } from "node:crypto";
import type {
  ActionCoverage,
  AuthoringSuggestion,
  CaptureSession,
  CompilerWarning,
  ElementTarget,
  FieldProvenance,
  RecordedAction,
  WorkflowCompilation,
  WorkflowInputDefinition,
  WorkflowSpec,
  WorkflowStep,
} from "../contracts/protocol.js";
import { formatValidationIssues, validateProtocolContract } from "../contracts/validation.js";

export const captureCompilerVersion = "1.0.0";

export function isCaptureCompilerVersionCompatible(version: string): boolean {
  const currentMajor = Number.parseInt(captureCompilerVersion.split(".")[0]!, 10);
  const match = /^([0-9]+)\.[0-9]+\.[0-9]+$/.exec(version);
  return match?.[1] !== undefined && Number.parseInt(match[1], 10) === currentMajor;
}

export class CaptureCompilationError extends Error {}

export interface AuthoringSuggestionProvider {
  suggest(context: Readonly<{ workflow: WorkflowSpec; warnings: CompilerWarning[]; captureSessionId: string }>): Promise<AuthoringSuggestion[]>;
}

export class CaptureWorkflowCompiler {
  public constructor(private readonly provider?: AuthoringSuggestionProvider) {}

  public async compile(input: unknown): Promise<WorkflowCompilation> {
    const base = compileCaptureSession(input);
    if (!this.provider) return base;
    const suggestions = await this.provider.suggest({ workflow: base.workflow, warnings: base.warnings, captureSessionId: base.captureSessionId });
    const candidate = { ...base, suggestions };
    const validation = validateProtocolContract<WorkflowCompilation>("WorkflowCompilation", candidate);
    if (!validation.ok) throw new CaptureCompilationError(`Authoring provider returned invalid suggestions. ${formatValidationIssues(validation.errors).join(" ")}`);
    return validation.value;
  }
}

interface ActionGroup { canonical: RecordedAction; actions: RecordedAction[] }
interface MutableCoverage { actionId: string; outcome: ActionCoverage["outcome"]; stepIds: string[]; reason?: string }

export function compileCaptureSession(input: unknown): WorkflowCompilation {
  const validated = validateProtocolContract<CaptureSession>("CaptureSession", input);
  if (!validated.ok) throw new CaptureCompilationError(formatValidationIssues(validated.errors).join(" "));
  const session = validated.value;
  if (session.status !== "finalized" && session.status !== "completed") throw new CaptureCompilationError("Capture must be finalized before compilation.");
  if (session.actions.length === 0) throw new CaptureCompilationError("Capture must contain at least one recorded action.");

  const ordered = orderAndValidate(session.actions);
  const groups = coalesceActions(ordered);
  const sourceDigest = digest(stableStringify(session));
  const domains = observedDomains(session, ordered);
  const warnings: CompilerWarning[] = [];
  const inputs: WorkflowInputDefinition[] = [];
  const steps: WorkflowStep[] = [];
  const stepActionIds = new Map<string, string[]>();
  const inputActionIds = new Map<string, string[]>();
  const coverage = new Map<string, MutableCoverage>();
  let lastDownloadStep: Extract<WorkflowStep, { action: "download" }> | undefined;
  let overflowStep: Extract<WorkflowStep, { action: "ask-approval" }> | undefined;

  for (const action of ordered) coverage.set(action.id, { actionId: action.id, outcome: "combined", stepIds: [] });

  const addWarning = (warning: CompilerWarning) => {
    if (warnings.length < 199) warnings.push(warning);
    else if (!warnings.some(({ code }) => code === "compiler.warning-limit")) warnings.push({ code: "compiler.warning-limit", severity: "warning", message: "Additional compiler warnings were combined to keep the draft review bounded.", actionIds: [] });
  };

  const addStep = (step: WorkflowStep, actionIds: string[], outcome: ActionCoverage["outcome"] = "emitted", reason?: string): WorkflowStep => {
    if (steps.length >= 99) {
      overflowStep ??= {
        id: deterministicUuid(`${sourceDigest}:overflow`),
        action: "ask-approval",
        name: "Review remaining recorded actions",
        expectedOutcome: "An operator confirms how the remaining recording should be represented.",
        prompt: "The recording exceeded the workflow step limit. Review the remaining actions together.",
      };
      if (!steps.includes(overflowStep)) steps.push(overflowStep);
      const combined = [...(stepActionIds.get(overflowStep.id) ?? []), ...actionIds].slice(0, 100);
      stepActionIds.set(overflowStep.id, combined);
      for (const actionId of actionIds) coverage.set(actionId, { actionId, outcome: "unsupported", stepIds: [overflowStep.id], reason: "Workflow step limit exceeded." });
      return overflowStep;
    }
    steps.push(step);
    stepActionIds.set(step.id, actionIds.slice(0, 100));
    actionIds.forEach((actionId, index) => coverage.set(actionId, { actionId, outcome: index === 0 ? outcome : "combined", stepIds: [step.id], ...(reason ? { reason } : {}) }));
    return step;
  };

  for (const group of groups) {
    const action = group.canonical;
    const actionIds = group.actions.map(({ id }) => id);
    const target = elementTarget(action);
    const domain = hostname(action.origin);
    const name = elementName(action);
    const stepId = deterministicUuid(`${sourceDigest}:step:${steps.length}:${actionIds.join(":")}`);

    if (!session.approvedOrigins.includes(action.origin)) addWarning({ code: "compiler.origin-outside-pattern", severity: "warning", message: `${action.origin} was observed outside the session's approved origin list.`, actionIds: actionIds.slice(0, 100) });
    if (action.target && action.target.locator.primary.confidence < 0.7) addWarning({ code: "compiler.ambiguous-target", severity: "warning", message: `${name} has a low-confidence primary locator and needs review.`, actionIds: actionIds.slice(0, 100) });

    if (action.eventKind === "navigate" || action.eventKind === "reload" || action.eventKind === "redirect") {
      addStep({ id: stepId, action: "navigate", name: `Open ${action.path}`, expectedOutcome: `The browser reaches ${action.path}.`, target: { domain, path: action.path } }, actionIds);
      continue;
    }

    if (action.eventKind === "input" || action.eventKind === "change" || action.eventKind === "select") {
      if (!target) {
        addUnsupported(action, actionIds, stepId, "The recorded field has no durable locator.", addStep, addWarning);
        continue;
      }
      const inputName = uniqueInputName(name, inputs);
      const input: WorkflowInputDefinition = { name: inputName, label: titleCase(name), kind: action.target?.inputType === "date" ? "date" : "text", required: true };
      inputs.push(input);
      inputActionIds.set(inputName, actionIds.slice(0, 100));
      const inferredWait = inferWait(action, ordered[action.sequence - 1], sourceDigest, steps.length);
      let inferredWaitId: string | undefined;
      if (inferredWait) {
        const wait = addStep(inferredWait, actionIds);
        inferredWaitId = wait.id;
      }
      const step: WorkflowStep = action.eventKind === "select"
        ? { id: stepId, action: "select", name: `Select ${titleCase(name)}`, expectedOutcome: `${titleCase(name)} accepts the selected input.`, target, inputName }
        : { id: stepId, action: "type", name: `Enter ${titleCase(name)}`, expectedOutcome: `${titleCase(name)} accepts the provided input.`, target, inputName };
      addStep(step, actionIds);
      for (const actionId of actionIds) {
        const existing = coverage.get(actionId);
        if (existing && inferredWaitId && !existing.stepIds.includes(inferredWaitId)) existing.stepIds.unshift(inferredWaitId);
      }
      if (action.value?.classification === "variable-candidate" || action.value?.classification === "literal-candidate") {
        addWarning({ code: "compiler.variable-input-suggested", severity: "warning", message: `${titleCase(name)} was converted into a required workflow input.`, actionIds: actionIds.slice(0, 100) });
      }
      continue;
    }

    if ((action.eventKind === "click" && action.actionHint === "download") || action.eventKind === "download") {
      if (!target) {
        if (lastDownloadStep) combineWithStep(actionIds, lastDownloadStep.id, coverage, "Browser download event combined with the preceding download step.");
        else addUnsupported(action, actionIds, stepId, "The download has no durable target locator.", addStep, addWarning);
        continue;
      }
      const emitted = addStep({ id: stepId, action: "download", name: `Download from ${titleCase(name)}`, expectedOutcome: "The browser confirms that the expected download starts.", target }, actionIds);
      lastDownloadStep = emitted.action === "download" ? emitted : undefined;
      continue;
    }

    if (action.eventKind === "download-start" || action.eventKind === "download-complete") {
      if (lastDownloadStep) {
        if (action.eventKind === "download-complete") lastDownloadStep.expectedOutcome = "The browser confirms that the expected download completes.";
        combineWithStep(actionIds, lastDownloadStep.id, coverage, `Recorded ${action.eventKind} combined with the preceding download step.`);
      } else addUnsupported(action, actionIds, stepId, "A browser download event was observed without a target action.", addStep, addWarning);
      continue;
    }

    if (action.eventKind === "wait-transition" && target) {
      addStep({ id: stepId, action: "wait", name: `Wait for ${titleCase(name)}`, expectedOutcome: `${titleCase(name)} becomes available.`, target, timeoutMs: 10000 }, actionIds);
      continue;
    }

    if (action.eventKind === "tab-create" || action.eventKind === "tab-switch") {
      addWarning({ code: "compiler.multiple-tabs", severity: "warning", message: "The recording uses multiple tabs and needs confirmation before execution.", actionIds: actionIds.slice(0, 100) });
    }
    addUnsupported(action, actionIds, stepId, `Recorded ${action.eventKind} requires author review.`, addStep, addWarning);
  }

  if (!hasFinalAssertion(ordered)) addWarning({ code: "compiler.missing-final-assertion", severity: "warning", message: "The recording has no strong final success signal. Add or confirm an expected outcome.", actionIds: [ordered.at(-1)!.id] });

  const workflow: WorkflowSpec = {
    schemaVersion: 1,
    format: "doonce.workflow-spec.v1",
    title: inferredTitle(ordered, domains[0]!),
    description: `Compiled deterministically from capture ${session.id}.`,
    allowedDomains: domains,
    inputs,
    steps,
  };
  const workflowValidation = validateProtocolContract<WorkflowSpec>("WorkflowSpec", workflow);
  if (!workflowValidation.ok) throw new CaptureCompilationError(`Compiler emitted an invalid WorkflowSpec. ${formatValidationIssues(workflowValidation.errors).join(" ")}`);

  const compilation: WorkflowCompilation = {
    schemaVersion: 1,
    format: "doonce.workflow-compilation.v1",
    compilerVersion: captureCompilerVersion,
    captureSessionId: session.id,
    sourceDigest,
    workflow: workflowValidation.value,
    warnings,
    provenance: buildProvenance(workflowValidation.value, stepActionIds, inputActionIds, ordered),
    coverage: ordered.map(({ id }) => coverage.get(id) ?? { actionId: id, outcome: "unsupported", stepIds: [], reason: "Action was not compiled." }),
    suggestions: [],
  };
  const compilationValidation = validateProtocolContract<WorkflowCompilation>("WorkflowCompilation", compilation);
  if (!compilationValidation.ok) throw new CaptureCompilationError(`Compiler emitted invalid metadata. ${formatValidationIssues(compilationValidation.errors).join(" ")}`);
  return compilationValidation.value;
}

function orderAndValidate(actions: readonly RecordedAction[]): RecordedAction[] {
  const ordered = [...actions].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const ids = new Set<string>();
  for (const [index, action] of ordered.entries()) {
    if (action.sequence !== index) throw new CaptureCompilationError(`Capture action sequence must be contiguous from zero; expected ${index}.`);
    if (ids.has(action.id)) throw new CaptureCompilationError(`Capture action ${action.id} is duplicated.`);
    ids.add(action.id);
  }
  return ordered;
}

function coalesceActions(actions: readonly RecordedAction[]): ActionGroup[] {
  const groups: ActionGroup[] = [];
  for (const action of actions) {
    const previous = groups.at(-1);
    if (previous && isNoisyDuplicate(previous.canonical, action)) {
      previous.actions.push(action);
      previous.canonical = action;
    } else groups.push({ canonical: action, actions: [action] });
  }
  return groups;
}

function isNoisyDuplicate(left: RecordedAction, right: RecordedAction): boolean {
  const typing = (value: string) => value === "input" || value === "change";
  const sameKind = left.eventKind === right.eventKind || (typing(left.eventKind) && typing(right.eventKind));
  const elapsed = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
  return sameKind && elapsed >= 0 && elapsed <= (typing(right.eventKind) ? 2000 : 500)
    && left.origin === right.origin && left.path === right.path
    && stableStringify(left.target?.locator ?? left.locator) === stableStringify(right.target?.locator ?? right.locator);
}

function observedDomains(session: CaptureSession, actions: readonly RecordedAction[]): string[] {
  const values = [...session.approvedOrigins, ...actions.map(({ origin }) => origin)].map(hostname);
  return [...new Set(values)].sort();
}

function hostname(origin: string): string {
  try { return new URL(origin).hostname; } catch { throw new CaptureCompilationError(`Capture origin ${origin} is invalid.`); }
}

function elementTarget(action: RecordedAction): ElementTarget | undefined {
  const locator = action.target?.locator ?? action.locator;
  return locator ? { domain: hostname(action.origin), path: action.path, locator } : undefined;
}

function elementName(action: RecordedAction): string {
  return action.target?.accessibleName ?? action.target?.testId ?? action.target?.textHint ?? action.target?.tagName ?? action.eventKind;
}

function uniqueInputName(label: string, inputs: readonly WorkflowInputDefinition[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 56) || "input";
  let candidate = base;
  let suffix = 2;
  while (inputs.some(({ name }) => name === candidate)) candidate = `${base}_${suffix++}`.slice(0, 64);
  return candidate;
}

function titleCase(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length === 0 ? "Recorded element" : `${normalized[0]!.toUpperCase()}${normalized.slice(1)}`.slice(0, 120);
}

function inferredTitle(actions: readonly RecordedAction[], domain: string): string {
  const observed = actions.find(({ before, after }) => before?.titleHint || after?.titleHint);
  const title = observed?.after?.titleHint ?? observed?.before?.titleHint;
  return title ? `Automate ${title}`.slice(0, 120) : `Recorded workflow for ${domain}`.slice(0, 120);
}

function inferWait(action: RecordedAction, previous: RecordedAction | undefined, sourceDigest: string, stepIndex: number): Extract<WorkflowStep, { action: "wait" }> | undefined {
  const target = elementTarget(action);
  if (!target || !previous?.after || !action.before || previous.after.navigationId === action.before.navigationId) return undefined;
  const name = elementName(action);
  return { id: deterministicUuid(`${sourceDigest}:wait:${stepIndex}:${action.id}`), action: "wait", name: `Wait for ${titleCase(name)}`, expectedOutcome: `${titleCase(name)} becomes available after navigation.`, target, timeoutMs: 10000 };
}

function addUnsupported(
  action: RecordedAction,
  actionIds: string[],
  stepId: string,
  reason: string,
  addStep: (step: WorkflowStep, actionIds: string[], outcome?: ActionCoverage["outcome"], reason?: string) => WorkflowStep,
  addWarning: (warning: CompilerWarning) => void,
): void {
  addStep({ id: stepId, action: "ask-approval", name: `Review recorded ${action.eventKind}`, expectedOutcome: "An author confirms the intended deterministic action.", prompt: reason }, actionIds, "unsupported", reason);
  addWarning({ code: "compiler.unsupported-action", severity: "warning", message: reason, actionIds: actionIds.slice(0, 100) });
}

function combineWithStep(actionIds: readonly string[], stepId: string, coverage: Map<string, MutableCoverage>, reason: string): void {
  for (const actionId of actionIds) coverage.set(actionId, { actionId, outcome: "combined", stepIds: [stepId], reason });
}

function hasFinalAssertion(actions: readonly RecordedAction[]): boolean {
  const final = actions.at(-1);
  return actions.some(({ eventKind }) => eventKind === "download-complete") || Boolean(final?.after && final.before?.domFingerprint !== final.after.domFingerprint);
}

function buildProvenance(workflow: WorkflowSpec, stepActionIds: Map<string, string[]>, inputActionIds: Map<string, string[]>, actions: readonly RecordedAction[]): FieldProvenance[] {
  const result: FieldProvenance[] = [];
  const allIds = actions.slice(0, 100).map(({ id }) => id);
  const visit = (value: unknown, path: string, actionIds: string[]) => {
    if (Array.isArray(value)) {
      if (value.length === 0) result.push(provenance(path, "deterministically-inferred", 1, actionIds));
      value.forEach((child, index) => visit(child, `${path}/${index}`, actionIds));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) visit(child, `${path}/${escapePointer(key)}`, actionIds);
      return;
    }
    const observed = path.includes("/target/") || path.startsWith("/workflow/allowedDomains/");
    result.push(provenance(path, observed ? "observed" : "deterministically-inferred", observed ? 0.95 : 0.85, actionIds));
  };

  visit({ ...workflow, inputs: undefined, steps: undefined }, "/workflow", allIds);
  workflow.inputs.forEach((input, index) => visit(input, `/workflow/inputs/${index}`, inputActionIds.get(input.name) ?? allIds));
  workflow.steps.forEach((step, index) => visit(step, `/workflow/steps/${index}`, stepActionIds.get(step.id) ?? allIds));
  return result.filter(({ path }) => !path.endsWith("/inputs") && !path.endsWith("/steps"));
}

function provenance(path: string, source: FieldProvenance["source"], confidence: number, actionIds: string[]): FieldProvenance {
  return { path, source, confidence, actionIds: [...new Set(actionIds)].slice(0, 100) };
}

function escapePointer(value: string): string { return value.replace(/~/g, "~0").replace(/\//g, "~1"); }

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(digest(seed).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
