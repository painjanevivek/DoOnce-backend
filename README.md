# DoOnce backend

The DoOnce backend owns workflow validation, deterministic safety policy, tenant-scoped APIs, receipts and scheduling. It never receives browser passwords, OTPs, payment details or raw page content by default.

## Phase 1 foundation

This first iteration exposes a local-only API with a typed workflow validator, policy evaluator, immutable read-only workflow publication, and database-backed account sessions. It does not execute browser steps.

### Safety boundary

- Read-only actions can be allowed.
- Reversible writes require an explicit approval checkpoint.
- Communication, financial, credential, OTP, deletion and submission actions are blocked or paused.
- Unknown actions pause rather than continuing.
- Published workflow versions cannot be edited; every change begins as a new draft version.

## Local development

```text
npm install
npm run dev
```

The API listens on `http://127.0.0.1:4000` by default. Set `DOONCE_ALLOWED_ORIGINS` to a comma-separated dashboard-origin allowlist for a different local setup.

For the local development database, start the included PostgreSQL service. Its port is loopback-only and its credentials are development-only:

```text
docker compose up -d
```

Set `DATABASE_URL` (the example matches this service) and a random `SESSION_SECRET` of at least 32 bytes, then run migrations:

```text
npm run db:migrate
```

Every tenant-owned table is protected by PostgreSQL row-level security. The server derives tenant/user context from a signed session token and sets `app.tenant_id` plus `app.user_id` inside the same transaction. It does not trust tenant IDs supplied by browser requests.

Workflow domains must be fully qualified public domains, except for the explicit local demo hosts `localhost` and `127.0.0.1`. Other bare internal hostnames remain rejected.

### Authentication endpoints

- `POST /api/v1/auth/sign-up` creates an owner account and a tenant. It returns no password material and sets a `HttpOnly`, `SameSite=Lax` session cookie.
- `POST /api/v1/auth/sign-in` returns one generic `401` response for unknown accounts and invalid passwords.
- `POST /api/v1/auth/sign-out` revokes the current session.
- `GET /api/v1/auth/me` requires a valid, unexpired session.

Session values contain signed tenant/user routing metadata, while only a SHA-256 hash of the full session token is stored in PostgreSQL. Passwords are stored using Node's `scrypt` key derivation function.
Sign-up and sign-in are limited to five requests per minute for each client address.

### Workflow endpoints

- `GET /api/v1/workflows` lists workflows only within the authenticated tenant.
- `POST /api/v1/workflows` creates a draft. The server assigns its ID, tenant and owner; browser input cannot choose them.
- `POST /api/v1/workflows/:id/publish` permits only owner/builder roles and only when every step is currently policy-allowlisted. Reversible writes, approvals, submissions and unknown actions cannot be published.
- `POST /api/v1/workflows/:id/disable` permits only an owner to immediately archive the active version. It remains available during the global workflow-change freeze and writes an immutable lifecycle event.
- `GET /api/v1/workflows/:id/audit-events` returns the tenant-scoped, append-only workflow lifecycle events.
- `POST /api/v1/workflows/:id/run-receipts/import` accepts a user-confirmed local receipt only from an authenticated dashboard request with an approved Origin. The server derives the tenant, actor, active version, step IDs, and receipt timestamps; it accepts only the explicit local report-demo workflow shape.
- `GET /api/v1/workflows/:id/run-receipts` returns the newest 50 redacted receipts for that workflow within the authenticated tenant. It never returns browser page content, action values, tenant IDs, or actor IDs.

Receipt imports are immutable. Re-saving the same local receipt returns a safe conflict response rather than creating a duplicate or exposing a database error.
Owners, builders, and runners may save verified receipts; reviewers remain read-only.
Imported local pause receipts accept only `changed-page`, `slow-network`, or `unknown` as their redacted reason code.

Draft creation, policy-preview completion, publication, and disabling each write an immutable audit event containing IDs, version, actor and timestamp. Metadata is limited to aggregate counts; it never includes browser content, action values, credentials or OTPs.

All state-changing authentication and workflow routes require a configured browser `Origin`; credentialed CORS is enabled only for the explicit `DOONCE_ALLOWED_ORIGINS` allowlist.

Unexpected API failures return a generic client-safe error. Structured server logs retain the error type, code, status and stack locations without recording error messages that could contain sensitive values.

## Controlled-run foundation

`src/runner/run-state-machine.ts` defines the only allowed lifecycle for a future runner: validate, preview, execute, verify, then complete. Any uncertain or illegal transition pauses; cancellation and terminal states cannot resume. It intentionally contains no browser authority or network calls.

`PostgresRunReceiptStore` persists only terminal, redacted receipts through the same tenant-scoped transaction boundary. It is not exposed as a “run now” API until a local browser bridge can execute and verify an allowed step.

## Pre-launch policy drafts

Internal drafts for privacy, terms, incident response, and data retention live in [`docs/policy-drafts`](docs/policy-drafts/README.md). They are intentionally marked for legal review and must not be published until the company, jurisdiction, and data-processing placeholders are approved.

### Operational controls

- Set `DOONCE_WORKFLOW_CHANGES_ENABLED=false` to block draft creation and publication while keeping the dashboard readable.
- Set `DOONCE_KILL_SWITCH=true` to override the workflow-change flag immediately. The public safety-status endpoint reports both controls without exposing tenant data.

## Checks

```text
npm run lint
npm run typecheck
npm test
npm run build
```
