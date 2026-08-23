# Hosted Qualification Gate

Hosted execution is disabled unless one exact published workflow version has a current qualification record. Generic Playwright compatibility is not sufficient.

## Required evidence

A qualification record binds all of the following:

- attended wedge: `report-download` or read-only `table-extraction`;
- exact WorkflowSpec checksum and one exact DNS domain;
- immutable Chromium image digest;
- evidence reference for managed-session, isolation, and egress checks;
- explicit qualification and expiry timestamps.

The API reads records from `HOSTED_QUALIFICATIONS_JSON`. An absent or empty value denies every managed run, including schedules and webhooks. Records expire and must be renewed against the current browser image and workflow checksum.

## Qualification procedure

1. Prove the workflow in an attended browser and retain verified run evidence.
2. Run it in an isolated managed session with restricted egress.
3. Exercise authentication expiry, redirects, target failure, cancellation, lease expiry, and worker restart.
4. Verify no side effect occurs twice and the declared artifact remains bound to its initiating step.
5. Record the immutable image digest and drill evidence location.
6. Set a short expiry; review before renewal.

Never qualify wildcards, mutable image tags, unbounded actions, interactive approvals, raw credentials, or multiple domains.
