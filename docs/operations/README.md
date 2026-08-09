# DoOnce operations handbook

This directory is the operator-facing source of truth for deploying and supporting DoOnce. Runbooks assume separate API, worker, PostgreSQL, telemetry collector, secret manager, and durable object/media volumes in production.

## Before a release

1. Complete the checks in [deployment.md](deployment.md), including migration compatibility and image rollback.
2. Review every variable in [environment.md](environment.md); secrets must come from the deployment secret manager.
3. Confirm [dashboards and alerts](dashboards-and-alerts.md) are receiving fresh data.
4. Run the [reliability drills](reliability-drills.md), including a restore into an isolated database.
5. Review the [queue and failed-run runbook](queue-and-failed-runs.md) and assign an incident commander.
6. Use [incident-template.md](incident-template.md) for customer and internal communication.

The extension has an independent release and browser-compatibility procedure in [extension-release.md](extension-release.md). Text authoring/provider incidents are covered in [provider-outage.md](provider-outage.md).
