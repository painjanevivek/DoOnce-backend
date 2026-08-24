# MVP release-candidate smoke and failure drills

Phase 6 proves the deployed release, deterministic Chrome package, and pilot workflow together. Local unit tests and synthetic controlled runs are prerequisites; they are not substitutes for this evidence.

## Create the release-bound manifest

1. Copy `release/mvp-smoke-context.template.json` to a private release-evidence workspace.
2. Replace every placeholder with the exact deployed backend/frontend commits, deployment, extension ID/version/package SHA-256, 26-migration set SHA-256, pilot workflow checksum, environment, and installed Chrome version.
3. Generate the complete pending case set without overwriting an existing record:

   `npm run smoke:create -- --context=<context.json> --output=<smoke.json>`

4. For each case, replace `pending` only after the expected behavior is observed. Add the tester, UTC timestamp, stable evidence reference, and observed outcome. Do not paste credentials, report contents, selectors, or typed values into the manifest.
5. Run `npm run smoke:check -- --file=<smoke.json>`. A nonzero exit blocks release.

Every result carries the SHA-256 of the immutable release context. Changing a commit, deployment, package, migration set, workflow, or Chrome version invalidates all previously recorded cases.

## Automation boundary

| Evidence | Codex/repository can perform | Manual input still required |
|---|---|---|
| Source, contracts, unit regressions, controlled extension runs, package determinism, dependency audits, SBOMs, container/package scans | Fully automated in CI | None after push |
| Fresh PostgreSQL migration, forced-RLS identity checks, approval concurrency, backup/restore integrity | Automated against an isolated PostgreSQL 16 database | Production restore timing and owner sign-off |
| Dashboard accessibility smoke on supported viewports | Headless browser checks can cover rendering, landmarks, keyboard focus, errors, and reduced motion | Final clean-profile Chrome confirmation |
| Extension install, update, uninstall/reinstall, permissions, service-worker suspension | Scripts and checklists prepare the run | A named tester, clean Chrome profile, and the final distributed extension ID/package |
| Real report journey and uncertainty injection | Product records bounded receipts and pause codes | Authorized pilot site/login, deployed URLs, expected report rule, and human attendance |
| Alerts, kill switch, rollback, and production restore | Repository provides commands/runbooks | Provider access, alert recipient, immutable deployment IDs, backup, and accountable operator |

## Execution order

1. Verify the exact CI runs and download their retained security/SBOM/scan/package artifacts.
2. Verify `/health`, `/ready`, `/api/v1/system/capabilities`, TLS, security headers, exact dashboard CORS origin, and exact extension origin.
3. Complete clean-profile lifecycle and identity cases.
4. Complete the one-domain consent and first record-to-receipt journey.
5. Inject each failure independently; restore the baseline between cases. A changed page, login expiry, missing element, slow network, popup, tab/origin change, API interruption, or extension suspension must pause. Approval expiry and replay must reject.
6. Test workflow disable and global kill switch before alert, rollback, and restore drills.
7. Complete desktop/minimum viewport, keyboard/focus/error recovery, and reduced-motion checks.
8. Run the checker and attach the passing manifest to the launch record.

## Stop conditions

- Stop immediately for sensitive-data leakage, cross-tenant access, continued execution after uncertainty, approval replay, or release-identity mismatch.
- Record any failure with one bounded class. `unclassified` is a temporary investigation state and never satisfies the gate.
- After a code, workflow, deployment, extension package, migration, or Chrome change, generate a new context and rerun all affected cases.
