export const recoveryFaults = ["provider", "database", "queue", "worker", "storage", "extension"] as const;
type RecoveryFault = (typeof recoveryFaults)[number];

export interface RecoveryDrillEvidence {
  drillId: string;
  fault: RecoveryFault;
  startedAt: string;
  finishedAt: string;
  expectedRestoreChecksum?: string;
  observedRestoreChecksum?: string;
  events: Array<{
    sequence: number;
    kind: "fault-injected" | "paused" | "checkpointed" | "resumed" | "side-effect" | "terminated" | "restore-verified";
    sideEffectKey?: string;
  }>;
}

export interface RecoveryDrillResult { passed: boolean; issues: string[] }

export function evaluateRecoveryDrill(input: RecoveryDrillEvidence): RecoveryDrillResult {
  const issues: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.drillId)) issues.push("drill.invalid-id");
  if (!recoveryFaults.includes(input.fault)) issues.push("drill.invalid-fault");
  if (!validWindow(input.startedAt, input.finishedAt)) issues.push("drill.invalid-time-window");
  if (input.events.length < 2 || input.events.length > 200) issues.push("drill.invalid-event-count");
  if (input.events.some((event, index) => event.sequence !== index + 1)) issues.push("drill.non-contiguous-sequence");
  if (input.events[0]?.kind !== "fault-injected") issues.push("drill.missing-fault-injection");
  if (!input.events.some((event) => event.kind === "paused" || event.kind === "terminated")) issues.push("drill.missing-safe-boundary");
  if (!input.events.some((event) => event.kind === "resumed" || event.kind === "terminated")) issues.push("drill.missing-terminal-recovery");

  const effects = input.events.filter((event) => event.kind === "side-effect");
  if (effects.some((event) => !event.sideEffectKey || event.sideEffectKey.length > 128)) issues.push("drill.invalid-side-effect-key");
  if (new Set(effects.map((event) => event.sideEffectKey)).size !== effects.length) issues.push("drill.duplicate-side-effect");

  if (input.fault === "database" || input.fault === "storage") {
    if (!/^[a-f0-9]{64}$/.test(input.expectedRestoreChecksum ?? "") || input.expectedRestoreChecksum !== input.observedRestoreChecksum || !input.events.some((event) => event.kind === "restore-verified")) {
      issues.push("drill.restore-integrity-unverified");
    }
  }
  return { passed: issues.length === 0, issues };
}

function validWindow(startedAt: string, finishedAt: string): boolean {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished) && finished >= started;
}
