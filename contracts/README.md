# DoOnce contracts

The backend owns versioned, language-neutral contracts used by the dashboard, extension, and future executors.

`workflow-spec.v1.schema.json` is the canonical WorkflowSpec v1 schema. Its matching server validator rejects unknown fields, literal values, undeclared inputs, unapproved domains, and unstable selectors before a workflow can be accepted for authoring or execution.

This contract is not yet persisted as a general workflow definition. The current report-download template remains the supported product slice until the capture compiler and editor consume this contract.
