# Expansion gate proposal

Copy this template for any proposed action type, connector, model, browser, or desktop runtime. Approval requires evidence in every section.

Start from `governance/expansion-proposal.template.json` and validate the completed record with:

```sh
npm run expansion:check -- --file=governance/proposals/<proposal-id>.json
```

The checked-in template intentionally fails. `npm run governance:verify` also locks the current WorkflowSpec version, action vocabulary, executor kinds, attended wedge, and authoring-provider vocabulary. Any baseline change must include the approved proposal and compatibility change in the same reviewed pull request.

## User evidence

- Beta workflow IDs requiring the capability:
- Number of affected users and repeated runs:
- Current stable failure categories and counts:
- Measured time/error impact:

## Representation

- Proposed WorkflowSpec change:
- Why the existing model cannot represent the requirement:
- Compatibility and migration behavior for existing workflows:
- What remains deliberately unsupported:

## Verification

- Observable success criteria:
- Deterministic failure and pause behavior:
- Unit, contract, integration, browser, and end-to-end tests:
- Evaluation changes if a model is involved:

## Ownership and operations

- Owning team/person:
- Runtime, queue, storage, model, and support cost:
- Metrics, dashboards, alerts, rollback, and incident procedure:
- Security/privacy review changes:

## Decision

- Outcome: approved / rejected / needs more beta evidence
- Reviewers and date:
- Earliest compatible schema/runtime version:

Two distinct reviewers are required for approval. A rejected or `needs-evidence` proposal cannot unlock development. Provider proposals additionally require model-evaluation evidence. References named `TBD`, `TODO`, or `placeholder` are rejected.
