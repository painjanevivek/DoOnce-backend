# Attended MVP production deployment

This runbook deploys the exact invite-only attended release. Provider/project, DNS, budget, alert destinations, and accountable owners remain Gate B decisions and are represented by `ops/environments/mvp-production.template.json`; no provider is inferred by code.

## Topology contract

Deploy one HTTPS frontend, one HTTPS API, managed PostgreSQL, durable encrypted artifact storage, a secret manager, and private metrics/traces with alert delivery. Do not deploy a worker. Do not provide queue credentials. The report site origin, dashboard origin, and `chrome-extension://` origin are three distinct exact values.

## Immutable inputs

1. Run `npm run release:inputs` and retain the protocol and ordered migration-set checksums.
2. Build the backend `runner` image and frontend image from the recorded commits. Resolve and retain registry digests; tags are not evidence.
3. Build the frontend extension release from the recorded frontend commit and retain its version, ID, ZIP checksum, manifest diff, SBOM, scan, and controlled-run report.
4. Populate every `DOONCE_*` release-identity value. `npm run deploy:verify` must pass before a release job is allowed to start.

## Roles and migration job

- The managed-database administrator creates a schema-owner/migration credential and a distinct `doonce_app` credential with neither superuser nor `BYPASSRLS`.
- Run the backend image’s `migrator` target once with only `MIGRATIONS_DATABASE_URL`. The migration job contains the checksum-locked SQL and runs `node dist/database/migrate.js`.
- The API receives only `DATABASE_URL`; startup and readiness reject a privileged role or a migration set that differs from `DOONCE_MIGRATION_SET_SHA256`.
- Destroy or disable the one-shot migration credential after the release according to the provider access policy. Never inject it into the API.

## Runtime configuration

Set `NODE_ENV=production`, `DOONCE_MVP_MODE=true`, one exact public HTTPS `DOONCE_ALLOWED_ORIGINS` dashboard origin, one exact public HTTPS `DOONCE_PILOT_ALLOWED_ORIGIN`, and one final `DOONCE_EXTENSION_ORIGINS=chrome-extension://<id>`. Use a TLS-only managed `DATABASE_URL`, independent session/artifact/metrics secrets, and an absolute persistent artifact mount. Explicitly set text, video, and repair flags to `false`; keep invitation creation off. `deploy:verify` rejects missing or mixed release identifiers, non-TLS/loopback PostgreSQL, runtime migration/queue credentials, shared secrets, relative artifact paths, and capability drift.

## Start and smoke

1. Start one API instance and check `/health`; confirm the returned release identity matches the image, frontend, extension, protocol, migrations, deployment ID, and environment.
2. Check `/ready`; it must validate database connectivity and the complete applied migration checksum set.
3. Confirm the runtime role is not privileged, security headers are present, API responses are `no-store`, request limits apply, and disallowed CORS/extension origins fail.
4. Call excluded APIs directly and confirm hosted, scheduled, webhook, text, video, and repair work cannot start.
5. Enable traffic gradually, observe readiness/5xx/latency/run/artifact/extension panels, and execute the controlled attended smoke case.

## Alerts, restore, and rollback evidence

- Import `ops/prometheus/alerts.yml` and `ops/grafana/doonce-overview.json` or map every rule to provider-native monitors. Trigger readiness, 5xx, latency, run-failure, artifact-failure, and extension-sync test alerts and record delivery to primary and backup owners.
- Create an encrypted backup, restore into a new isolated database, compare migration IDs/checksums and aggregate integrity, start the exact API image against it, and record backup ID, RPO, RTO, counts, checksums, owner, and evidence links.
- Rehearse the previous immutable application image against the current additive schema. For database recovery, stop execution, restore into a new database, validate it, and switch the runtime secret; never reverse migrations or restore over production.
- Exercise workflow disable and `DOONCE_KILL_SWITCH=true`; verify new approvals/runs/claims stop and an active run can only checkpoint and pause.

The environment exit gate stays pending until these commands run against the named provider with real TLS, backups, monitors, alert recipients, and owner-signed evidence.
