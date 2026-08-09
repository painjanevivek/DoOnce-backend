# Protocol contracts and migration

## What is authoritative

The backend owns `contracts/protocol.v1.schema.json`. It defines every object exchanged between capture, authoring, execution, repair, the browser extension, and the API. The generated TypeScript surface is `src/contracts/protocol.ts`; its contents must match `contracts/manifest.json`.

All protocol objects reject unknown fields. Workflow validation also checks rules that JSON Schema cannot express clearly: step IDs and input names are unique, input-consuming steps reference declared inputs, and every step target belongs to an approved domain.

## How an ordinary workflow moves through the system

1. The extension negotiates `CaptureHandshake`, records a recoverable `CaptureSession`, and sends ordered `CaptureSyncRequest` batches.
2. The API acknowledges each idempotent batch with `CaptureSyncAck`; a final acknowledgment makes the session immutable.
3. A capture compiler creates `doonce.workflow-spec.v1` from the finalized timeline.
4. The API validates the spec before accepting a draft.
5. PostgreSQL stores the spec with schema version, source, and a generated SHA-256 checksum.
6. The service validates the stored value again when loading it.
7. Dashboard and extension snapshots verify the backend artifact hashes before compiling.

Recorded actions carry stable IDs, sequence numbers, normalized page state, semantic element evidence, and value classifications. Protected values are represented by typed placeholders rather than raw text. Element evidence stores durable locator candidates; ephemeral DOM handles are never part of the protocol.

The compiler emits `WorkflowCompilation` alongside `WorkflowSpec`. It contains the compiler version, capture digest, warnings, field provenance, per-action coverage, and optional authoring suggestions. Suggestions are evidence for the editor and never silently alter the deterministic base draft.

A report download is an ordinary `download` step. Its target, locator candidates, and expected outcome live in the spec; no report-specific executor behavior is permitted.

## Migrating legacy drafts

Run `npm run db:migrate` first so migration 011 adds schema metadata and checksums. Then inspect the deterministic conversion report without writing:

```powershell
npm run db:migrate-workflows -- --report=workflow-migration-report.json
```

Review every unsupported action converted to `ask-approval`. Apply only after the report is accepted:

```powershell
npm run db:migrate-workflows -- --apply --report=workflow-migration-applied.json
```

The apply path uses one transaction. A failed record prevents partial migration, and reports use exclusive file creation so earlier evidence cannot be overwritten accidentally.

## Changing a contract

Update the backend schema and generated type surface together, export snapshots with `npm run contracts:export`, and commit the refreshed manifests in both repositories. Add one valid fixture and at least one invalid compatibility test for every new or changed contract branch. Breaking meanings require a new schema version; do not silently reinterpret version 1.
