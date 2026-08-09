# Visual workflow editor

Phase 5 makes canonical `WorkflowSpec` drafts editable without JSON. The API treats every save and publication as an optimistic mutation: the client sends the checksum it loaded, and the server changes the draft only when that checksum still matches.

## Authoring endpoints

- `GET /api/v1/workflow-specs` lists tenant-scoped canonical workflows with draft/active version state and bounded run-health summaries.
- `GET /api/v1/workflow-specs/:id` loads the latest editable draft.
- `POST /api/v1/workflow-specs/:id/save` validates and autosaves a draft using `expectedChecksum`.
- `GET /api/v1/workflow-specs/:id/versions` returns readable immutable version history.
- `POST /api/v1/workflow-specs/:id/next-draft` copies an active version into an explicit new draft.
- `POST /api/v1/workflow-specs/:id/test-preview` validates run inputs and returns a redacted deterministic readiness plan. It does not claim to execute the workflow before the runner phase is connected.
- `POST /api/v1/workflow-specs/:id/publish` validates and activates the exact reviewed checksum.

An edit changes the version source to `editor-v1` and marks attached compilation metadata as historical `editor` provenance. The original captured definition, action coverage, and compiler evidence remain available for comparison, while the edited definition is never presented as unchanged compiler output.

## Concurrency and version rules

Draft updates, new-version creation, and publication run inside tenant-scoped transactions. Publication locks the workflow, archives the previous active version, activates the reviewed draft, and updates the active-version pointer together. A stale save receives `409 workflow_spec.edit_conflict` with the newest draft so the client can offer an explicit resolution instead of silently overwriting it.

Branches point only to later step identifiers. This preserves a readable ordered editor and prevents cycles while conditions are still simple. Secret inputs cannot persist default values, and test previews return only `provided` and `secret` flags rather than input values.
