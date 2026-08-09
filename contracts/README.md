# DoOnce contracts

The backend owns versioned, language-neutral contracts used by the dashboard, extension, and future executors.

`protocol.v1.schema.json` is the canonical source for WorkflowSpec, locator, capture lifecycle, capture handshake and synchronization, runtime, run-result, repair, extension-message, and API-error contracts. `workflow-spec.v1.schema.json` is a compatibility reference into that protocol, not a second definition.

`src/contracts/protocol.ts` is the matching generated TypeScript surface. `manifest.json` pins both artifacts by SHA-256; `npm run contracts:verify` prevents edited or stale generated files from entering a build.

Canonical drafts are validated before storage and after loading. The current report-download slice is represented by an ordinary `download` step with a locator, so executors and clients do not need a report-specific branch.

Capture synchronization uses bounded, ordered, idempotent batches. The contract records semantic evidence and value classifications but never ephemeral browser handles; this keeps a recorded timeline reviewable and independent from any future executor implementation.

`WorkflowCompilation` explains how a finalized capture became a workflow. `CaptureSessionSummary` is the bounded dashboard listing shape. Together they allow the UI to present uncertainty progressively without returning the full raw timeline for every list request.
