# Phase 0 baseline

**Recorded:** 2026-08-09  
**Backend commit before Phase 0:** `d1568ec`

## Verified commands

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — 69 tests passed.
- `npm run build` — passed.

## Existing foundations retained

- Tenant-aware PostgreSQL transactions and row-level security checks.
- Authentication and session lifecycle.
- Workflow draft, preview, publish, disable, and repair-draft lifecycle.
- Immutable published versions and lifecycle events.
- Run state machine, bounded retry decisions, receipts, and run-health summaries.
- The local report-download fixture as the first vertical workflow.

## Known boundary

The current schema and runner cover the controlled report-download shape, not the complete WorkflowSpec, general browser execution, durable scheduling, or model-assisted authoring.
