export type RunState = "created" | "validating" | "previewing" | "executing" | "verifying" | "paused" | "completed" | "failed" | "cancelled";
export type RunSignal = "begin" | "validated" | "approval-granted" | "step-executed" | "verified" | "uncertain" | "failed" | "cancel" | "resume";

const terminalStates = new Set<RunState>(["completed", "failed", "cancelled"]);

export function transitionRun(state: RunState, signal: RunSignal): RunState {
  if (terminalStates.has(state)) return state;
  if (signal === "cancel") return "cancelled";
  if (signal === "uncertain") return "paused";
  if (signal === "failed") return "failed";
  if (state === "created" && signal === "begin") return "validating";
  if (state === "validating" && signal === "validated") return "previewing";
  if (state === "previewing" && signal === "approval-granted") return "executing";
  if (state === "executing" && signal === "step-executed") return "verifying";
  if (state === "verifying" && signal === "verified") return "completed";
  if (state === "paused" && signal === "resume") return "validating";
  return "paused";
}
