# DoOnce contracts

The backend owns versioned, language-neutral contracts used by the dashboard, extension, and future executors.

`protocol.v1.schema.json` is the canonical source for WorkflowSpec, locator, capture, runtime, run-result, repair, extension-message, and API-error contracts. `workflow-spec.v1.schema.json` is a compatibility reference into that protocol, not a second definition.

`src/contracts/protocol.ts` is the matching generated TypeScript surface. `manifest.json` pins both artifacts by SHA-256; `npm run contracts:verify` prevents edited or stale generated files from entering a build.

Canonical drafts are validated before storage and after loading. The current report-download slice is represented by an ordinary `download` step with a locator, so executors and clients do not need a report-specific branch.
