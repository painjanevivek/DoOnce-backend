# Phase 1 terminology and API migration

DoOnce now describes executable behavior as workflow capabilities. Validation, tenant isolation, approval checkpoints, redaction, and operational controls remain functional requirements; only the old product positioning changed.

| Deprecated surface | Current surface | Compatibility behavior |
| --- | --- | --- |
| `src/policy/action-policy.ts` | `src/execution/action-capabilities.ts` | Deprecated TypeScript adapter preserves old exports and `policy.*` rule IDs. |
| `GET /api/v1/system/safety` | `GET /api/v1/system/capabilities` | Old route returns the same public summary with `Deprecation`, `Sunset`, and successor `Link` headers. |
| `POST /api/v1/policy/evaluate` | `POST /api/v1/capabilities/evaluate` | Old route preserves `policy.*` rule IDs and advertises the replacement. |
| `policyPreviewed` response field | `capabilitiesPreviewed` | Both are returned during the migration window; new clients use the current field. |
| `workflow.policy_previewed` audit value | Future versioned audit vocabulary | Persisted v1 events remain readable and are not rewritten. |

The compatibility window ends no earlier than 31 January 2027. Removal also requires evidence that supported clients no longer call the deprecated routes.
