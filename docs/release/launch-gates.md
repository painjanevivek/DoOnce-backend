# Launch Readiness Gates

DoOnce is not production-ready merely because source tests pass. A release is ready only when `npm run release:check -- --file=<manifest>` reports `ready: true` for one evidence-backed manifest copied from `release/launch-readiness.template.json`.

## Automated gates

Record evidence for source verification, security diff, dependency/container scan, migration rehearsal, restore drill, rollback rehearsal, and the signed extension release candidate. References must identify the exact backend and frontend commits.

## External gates

Record an accountable owner, timestamp, and evidence reference for:

- Chrome Web Store publisher/distribution approval;
- infrastructure and provider selections;
- approved privacy, terms, and data-processing decisions;
- support and incident ownership;
- pricing/package evidence from real interviews and measured costs.

Pending or failed gates block launch. There is no `waived` status. A capability affected by a pending gate stays disabled.

## Release record

Keep the manifest with the release evidence, not secrets. Evidence may live in a restricted system, but the reference must be stable and reviewable. Re-run the gate after any commit, migration, browser image, policy, provider, or extension-package change.
