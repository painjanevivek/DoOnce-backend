export interface OperationalControls {
  workflowChangesEnabled: boolean;
  killSwitchActive: boolean;
}

export function operationalControlsFromEnvironment(environment: NodeJS.ProcessEnv = process.env): OperationalControls {
  const killSwitchActive = environment.DOONCE_KILL_SWITCH === "true";
  const workflowChangesEnabled = environment.DOONCE_WORKFLOW_CHANGES_ENABLED !== "false" && !killSwitchActive;
  return { workflowChangesEnabled, killSwitchActive };
}
