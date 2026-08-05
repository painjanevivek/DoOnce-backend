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

### Authentication endpoints

- `POST /api/v1/auth/sign-up` creates an owner account and a tenant. It returns no password material and sets a `HttpOnly`, `SameSite=Lax` session cookie.
- `POST /api/v1/auth/sign-in` returns one generic `401` response for unknown accounts and invalid passwords.
- `POST /api/v1/auth/sign-out` revokes the current session.
- `GET /api/v1/auth/me` requires a valid, unexpired session.

Session values contain signed tenant/user routing metadata, while only a SHA-256 hash of the full session token is stored in PostgreSQL. Passwords are stored using Node's `scrypt` key derivation function.

### Workflow endpoints

- `GET /api/v1/workflows` lists workflows only within the authenticated tenant.
- `POST /api/v1/workflows` creates a draft. The server assigns its ID, tenant and owner; browser input cannot choose them.
- `POST /api/v1/workflows/:id/publish` permits only owner/builder roles and only when every step is currently policy-allowlisted. Reversible writes, approvals, submissions and unknown actions cannot be published.

All state-changing authentication and workflow routes require a configured browser `Origin`; credentialed CORS is enabled only for the explicit `DOONCE_ALLOWED_ORIGINS` allowlist.

## Checks

```text
npm run lint
npm run typecheck
npm test
npm run build
```
