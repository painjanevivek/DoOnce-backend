# Deployment and rollback rehearsal

This runbook is a pre-launch rehearsal, not a production deployment. It must be executed against an approved staging environment before launch. Keep secrets in the deployment platform’s secret store; never add them to Git, container images, or logs.

## Build immutable candidates

From each repository root, build and tag images with the commit SHA:

```sh
docker build -t registry.example/doonce-frontend:<commit> .
docker build -t registry.example/doonce-backend:<commit> .
```

The frontend image listens on port `3000`. The backend image listens on port `4000` and requires `DATABASE_URL`, a randomly generated `SESSION_SECRET` of at least 32 bytes, and an explicit `DOONCE_ALLOWED_ORIGINS` list.

## Staging release sequence

1. Record the currently deployed image digests and database migration version.
2. Run the backend migration as a one-off job before the application rollout: `node dist/database/migrate.js`.
3. Deploy the backend image with `HOST=0.0.0.0`; restrict ingress to the frontend/proxy and configured browser origins.
4. Deploy the frontend image with its production API configuration.
5. Verify `/health`, public safety status, sign-up/sign-in, tenant isolation, workflow draft/publish, audit history, and the kill switch.
6. Record the release ID, operator, timestamps, validation evidence, and any exception.

## Rollback sequence

1. Activate the workflow kill switch if workflow safety is uncertain.
2. Roll frontend and backend back to the recorded prior image digests.
3. Do **not** roll database schema backward automatically. Migrations are forward-only; assess a data-safe corrective migration with an owner and peer review.
4. Re-run smoke checks, confirm tenant access boundaries, and leave workflow changes disabled until the incident lead approves recovery.
5. Open an incident record and complete the post-incident review described in [the incident-response draft](policy-drafts/incident-response.md).

## Rehearsal exit evidence

- image digests and deployment manifests;
- migration output and schema-migration version;
- smoke-test record, including kill-switch activation and recovery;
- rollback timing and validation record; and
- signed review by engineering, security, and the release owner.
