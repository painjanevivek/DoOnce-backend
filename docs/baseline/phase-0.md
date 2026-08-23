# Phase 0 baseline

**Recorded:** 2026-08-24
**Baseline branch:** `feat/product-implementation`

## Verified commands

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — 173 tests passed across pretests and the main suite.
- `npm run build` — passed.

## Existing foundations retained

- Tenant-aware PostgreSQL transactions and row-level security checks.
- Authentication and session lifecycle.
- Workflow draft, preview, publish, disable, and repair-draft lifecycle.
- Immutable published versions and lifecycle events.
- Run state machine, bounded retry decisions, receipts, and run-health summaries.
- The local report-download fixture as the first vertical workflow.

## Capability truth

The repository now contains authoring, capture compilation, versioning, attended and hosted execution foundations, scheduling, repair, evidence, observability, and controlled-beta models. These foundations are not equivalent to production deployment or customer proof. The versioned [capability matrix](../product/capability-matrix.md) and [release-blocker register](../security/release-blockers.md) are authoritative.
