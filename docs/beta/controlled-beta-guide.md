# Controlled beta guide

The controlled beta exists to prove that people repeatedly save time on a narrow browser task. It is not permission to add every requested connector or action.

## Supported participants and data

- Recruit users who repeat a measurable browser task at least weekly.
- Restrict the initial beta to ordinary business data. Do not enroll regulated healthcare, financial, government, or similarly sensitive workflows without a separate review.
- Enroll only the six task categories returned by `GET /api/v1/beta/compatibility`.
- Use manual execution in the paired Chrome extension or scheduled execution in the qualified hosted Chromium runtime.

## Onboarding sequence

1. Ask the user to perform the task manually and record elapsed minutes and the historical error percentage.
2. Create, review, test, and publish the workflow through the normal authoring flow.
3. Enroll the workflow with `POST /api/v1/beta/workflows` or the progressively disclosed **Controlled beta evidence** panel.
4. Observe the first test run. Record the run ID, `first-test`, and whether a developer intervened.
5. Observe the first real production run in the same way with `first-production`.
6. Record later production runs as `repeat-production`. Three production runs recorded without developer intervention, with at least 90% production success, make a workflow “independent-ready.”
7. Classify every actionable failure using one of the seven stable categories. Store a stable error code, never page content or user-entered values.

## Weekly review

Run `GET /api/v1/beta/summary` and review:

- enrolled workflows that have not reached a first test or first real run;
- independent-ready workflow count and repeat unassisted runs;
- the top failure categories and unclassified failed runs;
- recurring website/runtime incompatibility;
- support reports and relevant operational alerts.

Fix repeated failure categories before expanding the action model. A one-off feature request does not pass the expansion gate.

## Evidence integrity

- A run observation is accepted only when the run belongs to the enrolled workflow.
- `first-test` accepts only a test run. Production stages accept only production runs.
- Tenant row-level security applies to enrollments, observations, failures, and referenced runs.
- Baselines, stable categories, intervention flags, and IDs are stored; free-form notes are intentionally excluded.
- Pausing or graduating an enrollment never changes or disables the underlying workflow.

## Exit decision

Engineering is beta-ready when the API, evidence panel, compatibility matrix, telemetry, authorization tests, and runbook ship. Product validation is complete only after real users repeatedly run workflows without developer intervention and the next roadmap is chosen from recorded demand.
