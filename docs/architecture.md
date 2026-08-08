# Backend architecture direction

DoOnce uses a versioned WorkflowSpec as the shared domain contract. The backend remains independently deployable from the dashboard/extension repository and owns the canonical JSON Schemas and OpenAPI contract.

The target backend modules are:

```text
auth          identities, sessions, tenant membership
captures      capture sessions and action batches
workflows     drafts, immutable versions, templates, lifecycle events
authoring     recording/text/video jobs that produce WorkflowSpec drafts
runs          orchestration, executor leases, step results, verification
schedules     time-based and API/webhook triggers
repairs       failure classification and repair proposals
artifacts     metadata and object-storage references
infrastructure database, queue, storage, telemetry
```

Architecture decisions are canonical in the main DoOnce repository under `docs/architecture/adr`:

- WorkflowSpec is the central artifact.
- The two existing repositories remain independently deployable.
- Extension and Playwright executors implement one contract.
- AI is limited to authoring and repair.
- PostgreSQL-backed jobs are the initial durable queue.
- Video authoring follows the core workflow lifecycle.
