# Backend third-party inventory

No selected browser-agent repository is a direct backend dependency in Phase 0.

Future integration candidates must remain behind adapters:

| Candidate | Proposed role | Rule before adoption |
|---|---|---|
| Stagehand | Text/browser-observation authoring provider | Must emit schema-valid WorkflowSpec drafts and remain feature-flagged |
| Browserclaw | Hosted semantic browser executor reference or adapter | Must pass DoOnce executor compatibility tests |
| Playwright | Hosted executor and end-to-end verification | Browser binaries and runtime lifecycle must be pinned and documented |
| pg-boss | Durable jobs and schedules | Must be wrapped by the queue interface and tested for idempotency/recovery |
| Ajv | WorkflowSpec and protocol validation | Canonical schemas remain owned by DoOnce |

Each direct addition requires a pinned version, license notice, dependency audit, maintenance assessment, and removal strategy.
