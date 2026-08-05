# DoOnce backend

The DoOnce backend owns workflow validation, deterministic safety policy, tenant-scoped APIs, receipts and scheduling. It never receives browser passwords, OTPs, payment details or raw page content by default.

## Phase 1 foundation

This first iteration exposes a local-only API with a typed workflow validator and policy evaluator. It does not execute browser steps or persist customer data yet.

### Safety boundary

- Read-only actions can be allowed.
- Reversible writes require an explicit approval checkpoint.
- Communication, financial, credential, OTP, deletion and submission actions are blocked or paused.
- Unknown actions pause rather than continuing.

## Local development

```text
npm install
npm run dev
```

The API listens on `http://127.0.0.1:4000` by default. Set `DOONCE_ALLOWED_ORIGINS` to a comma-separated dashboard-origin allowlist for a different local setup.

## Checks

```text
npm run lint
npm run typecheck
npm test
npm run build
```
