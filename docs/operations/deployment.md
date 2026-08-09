# Deployment, migration, and rollback

## Deployment shape

Run the same immutable image as two separately configured workloads: an API deployment and a worker deployment. PostgreSQL tenant tables use the restricted application role; pg-boss uses a queue-scoped role. Mount artifact/video storage or replace the filesystem adapters before horizontal scaling. Put the API behind TLS termination, a request-size-aware proxy, and network controls that keep `/internal/metrics` private.

## Release procedure

1. Build from a reviewed commit and retain the image digest, Git commit, SBOM, dependency audit, and container scan result.
2. Restore the newest backup into an isolated environment and run the current migrations there.
3. Confirm the new application is backward-compatible with the currently deployed schema and queued payloads.
4. Set `DOONCE_WORKFLOW_CHANGES_ENABLED=false` if the migration changes workflow authoring state.
5. Run `npm run db:migrate` once with `MIGRATIONS_DATABASE_URL`. Migrations are checksum-locked and forward-only.
6. Deploy workers first when they can consume both old and new payloads; then deploy API instances gradually.
7. Check `/ready`, HTTP error/latency panels, queue age, worker failures, and a controlled manual and hosted run.
8. Re-enable workflow changes and record the release time and image digest.

## Rollback

Application rollback means redeploying the previous image digest, not reversing files in place. Before rollout, prove that the previous image can operate against the post-migration schema. If it cannot, stop and ship an additive compatibility migration first.

Database migrations do not have automatic down scripts because destructive rollback can lose tenant data. For a data-corrupting release: activate the kill switch, stop API/workers, preserve forensic copies, restore the last verified backup into a new database, validate counts/checksums, switch connection secrets, and only then resume traffic. Document the recovery point and any lost interval.

## Release evidence

- image digest and commit;
- migration IDs and checksums;
- SBOM and scan results;
- restore-drill run link;
- controlled-run receipts;
- dashboard snapshots for the first 30 minutes;
- rollback owner and previous image digest.
