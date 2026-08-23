# Attended wedge playbook

This phase enables two finite Chrome-extension patterns for controlled evaluation. It does not claim customer proof; participant evidence must be recorded through the beta APIs before either pattern graduates.

## Qualified patterns

| Pattern | Required shape | Verified outcome |
|---|---|---|
| One-file report download | One HTTPS domain, exactly one `download` step, only navigation/read/wait/compare/branch/stop helpers | The initiating page and time window match the browser download; its size is known and bounded; every run step and assertion is verified |
| Read-only table extraction | One HTTPS domain, at least one `read` step, no write or download action | Declared text, presence, row-count, or comparison assertions are verified |

Recording, bounded text authoring, and calibrated video may all produce these shapes. The same `WorkflowSpec` validator and `qualifyAttendedWedge` policy decide runtime eligibility after authoring.

## Explicit exclusions

Do not enroll workflows with credentials, OTPs, payment fields, contenteditable entry, submissions, multiple domains, unknown downloads, private-network targets, or an outcome that cannot be asserted. Hosted, scheduled, and webhook execution remain disabled until Phase 4 qualification.

## Pilot evidence record

For each participant, record the manual duration and historical error baseline before automation. Observe first test, first production, and repeat production runs. Mark developer intervention explicitly and classify every failure; never convert a note or unclassified pause into success. A pilot is independent-ready only after three successful production runs, including two repeat runs without developer intervention, with no unclassified failure.

The repository supplies fixtures, policy tests, exact-draft evidence binding, and failure categories. Recruiting participants, obtaining site authorization, and observing real recurring work are external activities and must not be inferred from automated fixtures.
