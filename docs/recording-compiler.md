# Recording-to-workflow compiler

The compiler converts a finalized, tenant-scoped capture timeline into a validated `WorkflowSpec` draft. Compiler `1.0.0` is deterministic: the same validated capture produces the same source digest, step IDs, base workflow, warnings, provenance, and coverage report.

## Pipeline

The implementation keeps each decision in an explicit stage:

1. Validate the `CaptureSession` contract and require a finalized state.
2. Sort actions by sequence and reject gaps or duplicate IDs.
3. Coalesce adjacent typing and duplicate browser noise without losing action coverage.
4. Normalize observed origins and paths into the workflow allowlist and targets.
5. Reuse semantic locator evidence captured by the extension.
6. Infer bounded waits only when page navigation evidence shows a transition.
7. Convert typed and selected values into required workflow inputs; raw values are not needed.
8. Infer step outcomes and use download completion as a strong workflow success signal.
9. Emit review steps and warnings for unsupported clicks, toggles, submits, tabs, or missing targets.
10. Validate both the emitted `WorkflowSpec` and its `WorkflowCompilation` report before persistence.

Every source action receives one coverage outcome: `emitted`, `combined`, or `unsupported`. Unsupported events are never dropped. If a recording would exceed the 100-step WorkflowSpec bound, remaining actions are grouped into one review step and retain individual coverage records.

## Provenance and optional authoring providers

The compilation report records a JSON Pointer, source, confidence, and source action IDs for generated fields. The deterministic draft uses `observed` and `deterministically-inferred` provenance. A provider may suggest better names, grouping, variable labels, or expected outcomes, but suggestions are returned separately and do not mutate the base workflow. Invalid provider output fails validation.

## Persistence and API flow

`GET /api/v1/capture-sessions` returns recent tenant-scoped session summaries. `POST /api/v1/capture-sessions/:id/compile` accepts only an authenticated dashboard request from an approved origin, compiles a finalized session, creates a canonical draft, and stores the compiler version, capture ID, source digest, and full compilation report with that draft.

Migration 013 adds the compilation metadata columns and indexes capture-to-draft lookup. Capture actions remain bounded to 1,000 and approved origins to 20 at both the application and database boundaries.

## Upgrade rule

Compiler behavior changes require a new semantic compiler version and new golden files. Existing draft metadata remains immutable. Recompilation creates a new draft rather than rewriting the stored result, so an author can compare versions before choosing one.
