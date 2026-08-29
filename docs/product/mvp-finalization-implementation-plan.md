# DoOnce MVP finalization implementation plan

**Plan date:** 2026-08-24  
**Target:** invite-only, attended Chrome pilot for one authorized HTTPS report download  
**MVP state:** achieved only after the release is deployed and three pilot users produce the required real-run evidence

## 1. Product contract

The MVP does one job:

> A signed-in pilot installs DoOnce, approves one authorized HTTPS domain, records one report-download workflow, reviews and tests it, publishes it, explicitly approves every production run, receives a verified or safely paused receipt, and can disable the workflow or report a problem.

The MVP is complete only when all of these statements are true:

1. Exactly one pilot website, report, expected result, and measurable manual baseline are recorded in a signed-off pilot charter.
2. Three invited pilot users can complete the install-to-receipt journey without an engineer editing code or database state for them.
3. Each pilot records three successful production runs, including two repeat runs without developer intervention.
4. Changed or uncertain pages, expired login, missing elements, slow network, and unexpected popups pause without continuing.
5. No credential, OTP, payment value, page content, selector, or typed value leaks into capture data, receipts, artifacts, logs, analytics, or support reports.
6. The exact backend, frontend, extension package, database migration set, and deployment are identified by immutable release IDs.
7. The release has passing source, security, supply-chain, migration, restore, rollback, smoke, and extension-package evidence.
8. The capability matrix is promoted to `Deployed: Yes` and `Customer-proven: Yes` only for the bounded attended report-download capability.

Completion of code alone is therefore release-candidate completion, not MVP completion.

## 2. Confirmed baseline

| Area | Repository evidence | Remaining MVP work |
|---|---|---|
| Backend product foundation | `feat/product-implementation` at `38aff78` contains capability governance, attended-wedge qualification, authorization boundaries, evidence binding, release gates, operations, and beta evidence. | Merge through review, rerun all checks, and close external/deployment evidence. |
| Frontend product foundation | `feat/product-implementation` at `97293d0` includes the Guided Proof baseline, `/install`, onboarding, disable, support reporting, receipt history, and stricter extension boundaries. | Merge through review, replace the local-demo-only execution boundary with the single approved HTTPS pilot pattern, and verify the complete journey. |
| Guided Proof work | The completed `feat/guided-proof-ui` history is already integrated into the frontend product branch. | Do not rebuild marketing motion or authoring variety for MVP. Keep only functional install/account/workflow surfaces in the release gate. |
| Invite-only access | Account creation and sessions exist. `AuthService.signUp` currently creates a tenant for any valid sign-up request. | Add server-enforced, expiring, single-use invitations. Hiding the sign-up link is insufficient. |
| Real attended execution | The general run lease/result foundation and attended-wedge policy exist. | The current frontend/extension product branch still limits runnable onboarding to the local `/demo/reports` fixture. Qualify and execute the one real HTTPS workflow. |
| Per-run approval | Action policy and local-demo approval UX exist. | Add durable, single-use approval binding for every real production run and prove replay/expiry/cross-user rejection. |
| Emergency controls | Workflow disable and `DOONCE_KILL_SWITCH` exist. | The current kill switch freezes workflow changes; it must also prevent new execution and claims for an emergency stop. |
| Extension distribution | Manifest V3, release HTTPS build enforcement, `/install`, controlled-run evidence, and release guidance exist. | Produce a deterministic versioned package, checksum and scan evidence; choose and complete pilot distribution; verify on clean Chrome. |
| Production operations | Docker, RLS role checks, migrations, CI restore drill, metrics, alerts, rollback/restore runbooks, and readiness endpoints exist. | Select infrastructure, deploy immutable releases, provision real backups/alerts, and rehearse restore and rollback in the named environment. |

## 3. Scope lock

### Included

- Chrome stable and previous stable on desktop.
- One exact authorized HTTPS domain.
- One known, size-bounded report download.
- Existing browser login session; the user handles sign-in and MFA outside recording and execution.
- Record, value-free compile, review/rename, test, publish, fresh approval, attended run, verified/safely-paused receipt, export, disable, and bounded support report.
- Invite-only tenant owners for the first three pilots.
- One production-like environment with real monitoring, backup, restore, rollback, and incident controls.

### Disabled or hidden for MVP

- Hosted/unattended execution, schedules, webhooks, worker execution, and browser session profiles.
- Text and video authoring.
- Payments, subscriptions, invoicing, SSO, automatic repair, multiple templates, multiple domains, multi-tab execution, and automatic retries after uncertainty.
- Marketing motion work that does not unblock install-to-receipt completion.

Production configuration must default these capabilities off. Existing code may remain, but it must be unreachable from pilot UI and rejected at server boundaries.

## 4. Decision gates requiring founder input

### Gate A — needed before implementation Phase 1 exits

1. Exact HTTPS origin, report name, navigation path, and authorization to automate it.
2. Expected result: file type, filename rule, size range, and one verifiable completion condition.
3. Whether the report site uses password login, SSO, CAPTCHA, or MFA. Login and MFA will remain manual and outside capture.
4. Three pilot participants, their organizations/roles, recurrence of the task, manual duration, and historical error rate.
5. Minimum success value: time saved per run or another threshold that justifies the proposed pilot price.

### Gate B — needed before distribution/deployment exits

6. Pilot distribution: unlisted Chrome Web Store listing, or temporary controlled manual installation.
7. Chrome Web Store publisher account owner and extension support contact.
8. Deployment provider, production frontend/API hostnames, DNS control, and budget ceiling.
9. Legal entity/jurisdiction and the person approving privacy, terms, data retention, and the target site's permitted use.
10. Named primary and backup owners for support, incidents, rollback, Chrome publishing, privacy requests, and pilot communication.

Until an answer arrives, implementation should use placeholders and fail closed; it must not infer authorization or silently enable a second site.

## 5. Delivery sequence

### Phase 0 — consolidate the actual product baseline

**Objective:** establish one reviewed release branch containing the already-completed work before adding MVP-only changes.

Tasks:

1. Preserve the user's unrelated dirty files (`Frontend/CLAUDE.md` and generated `next-env.d.ts`) and do not include them in product commits.
2. Open/merge the backend `feat/product-implementation` branch into backend `main` after focused review.
3. Open/merge the frontend `feat/product-implementation` branch into frontend `main`; it already contains the Guided Proof implementation, so do not separately merge or recreate that work.
4. Verify shared protocol/schema files match in both repositories.
5. Run backend lint, typecheck, governance verification, tests, production build, Docker build, migration/restore CI job, dependency audit, SBOM, and container scan.
6. Run frontend lint, typecheck, extension tests, controlled-run evidence verification, dashboard build, release extension build with an HTTPS placeholder, Docker build, dependency audit, SBOM, and container scan.
7. Record baseline commit IDs and all failures before beginning new behavior changes.

**Exit gate:** both repositories are green from the integrated branches, and there is one agreed release branch per repository.

**Expected effort:** 0.5–1.5 engineering days, excluding review/CI queue time.

### Phase 1 — freeze the pilot and enforce invite-only MVP mode

**Objective:** make the narrow product boundary an enforced system property, not a document-only promise.

Backend tasks:

1. Add tenant invitation persistence with hashed token, intended email, role, issuer, expiry, consumed timestamp, and audit timestamps. Never store the raw token.
2. Make sign-up require a valid, unexpired, unused invitation and consume it atomically with account/tenant creation. Reject email mismatch, replay, expiry, and concurrent use with generic responses.
3. Add an owner/operator invitation creation path that is disabled by default and covered by audit events and rate limits. For the first three users, an operator CLI is sufficient; a public admin UI is not required.
4. Add `DOONCE_MVP_MODE` and `DOONCE_PILOT_ALLOWED_ORIGIN` configuration. In MVP mode, reject workflow publication/execution outside the exact configured HTTPS origin even if a broader workflow definition is otherwise valid.
5. Default text, video, repair automation, hosted execution, schedules, and webhooks off in the pilot environment. Keep emergency disable and bounded support reporting on.
6. Add a machine-readable pilot charter containing the exact workflow, verification rule, exclusions, pilot IDs, baseline fields, and price-value threshold without credentials or sensitive site data.

Frontend/extension tasks:

1. Add invitation token handling to the sign-up flow and truthful expired/used invitation states.
2. Hide non-MVP authoring and execution paths when the server reports MVP mode.
3. Show the exact approved domain and report outcome throughout onboarding; never advertise generic site support.

Tests:

- Invitation valid/expired/replayed/wrong-email/concurrent-consumption cases.
- Direct API attempts to enable excluded capabilities in MVP mode.
- Publication and run rejection for every non-pilot origin and for HTTP/private-network variations.
- UI tests proving excluded authoring/execution choices are absent, not merely visually hidden.

**Exit gate:** only invited users can create pilot tenants, and the entire deployed stack can authorize only the one approved workflow domain.

**Expected effort:** 2–3 engineering days after Gate A answers.

### Phase 2 — close the real install-to-receipt journey

**Objective:** replace the local-demo-only product path with the one real, attended HTTPS workflow while preserving the demo as a test fixture.

Tasks, in user order:

1. **Install and connect:** keep `/install`, add extension detection/connection confirmation, pair the extension to the signed-in tenant with a short-lived one-time code, and provide recovery for expired pairing.
2. **Approve one domain:** request optional host access only for the exact pilot origin; store explicit consent; revoke it with complete origin-scoped local cleanup.
3. **Record:** allow capture only on the pilot origin. Exclude password, OTP, payment, hidden, file, and contenteditable fields before local persistence and before sync. Keep query strings, values, and page content out of the capture contract.
4. **Compile:** generalize the current local-demo draft creator only as far as the approved one-file download pattern. Require exactly one download action, one domain, supported navigation/read/wait/compare/branch/stop helpers, and declared verification.
5. **Review and rename:** make generated step names editable, show a plain-language preview, surface all uncertainty, and prevent test/publish while validation issues remain.
6. **Test:** execute the exact saved draft in attended test mode, bind completion evidence to tenant, user, workflow ID, version, checksum, executor version, extension version, action IDs, assertions, and downloaded artifact metadata.
7. **Publish:** permit immutable publication only for the same checksum that passed the capability preview and test. Any edit invalidates both.
8. **Approve and run:** implement a short-lived, single-use run approval challenge. Bind it to tenant, current membership, user, workflow/version/checksum, input digest, exact origin, extension executor, and expiry. Consume it atomically when creating/claiming the run. Reject replay, expiry, cross-user, cross-tenant, changed-input, changed-version, and changed-extension attempts.
9. **Execute safely:** validate the tab origin before every action/assertion, correlate the expected browser download with the initiating action and bounded time window, verify filename/type/size/checksum or declared content-independent condition, and pause on uncertainty without fallback selectors that broaden authority.
10. **Receipt:** show completed or safely paused status, step/assertion results, redacted reason code, artifact metadata, release IDs, and checksum. Support bounded export/history with no page content or typed data.
11. **Recover/control:** keep owner emergency disable, extend the kill switch to reject new run creation and claims, allow already-running work only to checkpoint and stop safely, and keep the bounded problem-report path.
12. **Onboarding state:** persist server-derived progress so refresh/relogin resumes at the next truthful step. Local browser state alone must never unlock publication or mark a run verified.

Focused regression suites:

- Install/extension detection and pairing expiry.
- Consent grant/revoke and origin cleanup.
- Sensitive capture exclusion at content-script, service-worker, transport, API, database, receipt, logging, analytics, and support boundaries.
- Exact draft/test/publication binding.
- Approval challenge replay and identity/tenant/version/input/origin binding.
- Download-action/artifact/receipt correlation.
- Changed page, missing element, expired session, slow network, popup, tab change, extension suspension, and API disconnect safe pauses.
- Emergency workflow disable and global execution kill switch.

**Exit gate:** a non-technical internal tester completes the exact production-shaped journey on a staging copy of the real site without code/database intervention, and every injected uncertainty pauses safely.

**Expected effort:** 4–7 engineering days; site-specific behavior may add time if the download is generated asynchronously or crosses an origin.

### Phase 3 — package and distribute the exact extension release

**Objective:** make installation reproducible and bind the distributed extension to the release evidence.

Tasks:

1. Create a deterministic release command that builds with the production HTTPS API origin, validates the manifest, excludes source maps/development files, packages the required static files and bundles, and emits a versioned ZIP plus SHA-256 manifest.
2. Fail release builds on a loopback/non-HTTPS API, an unapproved host permission, version mismatch, dirty generated bundle, missing privacy disclosure, or controlled-run ledger mismatch.
3. Add extension-package static analysis and malware/dependency scan evidence to CI; retain the package, checksum, manifest diff, SBOM, source commits, compiler/protocol versions, and controlled-run report together.
4. Test current stable and previous stable Chrome using a clean profile: installation, update, permission grant, pairing, service-worker suspension, offline recovery, revoke, and uninstall/reinstall.
5. For the preferred path, submit an unlisted Chrome Web Store listing, approve the exact permissions/privacy disclosures, obtain the final extension ID, set `DOONCE_EXTENSION_ORIGINS`, and configure `NEXT_PUBLIC_EXTENSION_INSTALL_URL`.
6. If store review blocks the pilot, use a documented, checksum-verified controlled manual installation only for named participants, then replace it with the store path before broader beta.

**Exit gate:** `/install` points to a working approved distribution path, and a clean Chrome profile installs and connects the exact release candidate.

**Expected effort:** 1–2 engineering days plus external Chrome Web Store review time.

### Phase 4 — deploy one production-like attended environment

**Objective:** run the exact release under real TLS, RLS, backup, monitoring, and rollback controls without enabling non-MVP workers.

Tasks:

1. Choose one provider topology and record it: HTTPS frontend, HTTPS API, managed PostgreSQL, persistent/object artifact storage, secret manager, metrics/traces, and alert delivery. A worker deployment is not required for the attended MVP.
2. Provision separate migration owner and restricted non-superuser/non-`BYPASSRLS` application roles; keep queue credentials absent when workers are disabled.
3. Inject independent session, artifact-signing, metrics, and database credentials. Configure exact dashboard CORS origin and exact Chrome extension origin; use no wildcards.
4. Apply checksum-locked migrations through a one-shot release job, then start the API with the restricted runtime role and verify `/health`, `/ready`, RLS startup checks, security headers, and request-size limits.
5. Add stable backend, frontend, extension, protocol, and migration release identifiers to health/capability responses, receipt evidence, and operator-visible diagnostics.
6. Set all excluded capability flags off. Confirm direct API calls cannot start hosted, scheduled, webhook, text, or video work.
7. Deploy existing Prometheus/Grafana rules or equivalent provider-native monitors. Route readiness, 5xx, latency, run failure ratio, artifact failure, and extension sync alerts to the named owner and test delivery.
8. Configure encrypted backups and retention, perform a restore into an isolated database, compare migrations/counts/integrity, start the exact release against it, and measure recovery time.
9. Rehearse application rollback to the previous immutable image and database recovery to a new database. Record owners, evidence links, recovery point, and elapsed time.
10. Test workflow disable and the expanded execution kill switch from the operator path.

Use `ops/environments/mvp-production.template.json` as an external evidence template and run `npm run production:check -- --file=<secure-production-decision.json>`. The checker separates provisioning readiness from pilot readiness and rejects unverified domain/account control, unreconfirmed region, budget or topology drift, unnamed owners, unsafe retention, missing written authorization, cross-origin downloads, incomplete historical samples, and synthetic pilot baselines.

**Exit gate:** the named environment has an immutable release record, green readiness, verified RLS, tested alerts, successful backup restore, rollback evidence, and all non-MVP capabilities disabled.

**Expected effort:** 2–4 engineering days after provider/DNS access is available.

### Phase 5 — close the repository security gates

**Objective:** convert release-blocker claims into repository-owned regression and CI evidence for the exact release candidate. Only the commands and retained artifacts defined in this phase are MVP release gates.

Create a focused allow/deny matrix and retain raw test/scan evidence for:

1. Object authorization: workflow, capture, run, receipt, artifact, support, invitation, approval, and beta records across owner/builder/runner/reviewer, same tenant, other tenant, expired membership, and anonymous access.
2. Durable identity: current membership rechecked during pairing, approval, run creation, claim, heartbeat, checkpoint, finish, receipt import, and artifact upload/download.
3. Evidence integrity: request, claim, lease, approval, workflow checksum, result, receipt, download action, and artifact cannot be mixed across runs/users/tenants/versions.
4. Extension/API boundary: production HTTPS only, exact `chrome-extension://<id>` origin, valid pairing/lease credentials, rejected website-origin calls, and rejected prior extension IDs after rotation.
5. Action/data policy: sensitive fields excluded; unknown/sensitive/irreversible actions pause or reject; no user-entered values in telemetry, logs, analytics, receipts, artifacts, or support reports.
6. Per-run approval: fresh, user-visible, single-use, short-lived, bound, and non-replayable for every attended production run.
7. Supply chain: dependency audit, extension package scan, container scan, SBOMs, pinned base images/actions, tracked-secret scan, and reviewed source diff for both repositories.
8. Consent lifecycle: permission revocation removes only the selected origin's local captures, approvals, recording state, and receipts, while server retention follows the approved policy.

Any high finding blocks the affected external capability. There is no waiver; disable the capability or fix and rerun the evidence.

**Exit gate:** every cluster in `docs/security/release-blockers.md` has a passing repository regression reference bound to the release commits/package checksum, the raw CI artifacts are retained, and the release manifest reports `ready: true` except for pilot evidence.

**Expected effort:** 2–4 engineering days if no high finding requires redesign.

### Phase 6 — run release-candidate smoke and failure drills

**Objective:** prove the exact deployed release and package, not a local approximation.

Run and retain evidence for:

1. Clean install, update, uninstall/reinstall, sign-up by valid invitation, sign-in, sign-out, session expiry, and pairing recovery.
2. Cross-tenant and cross-role access rejection.
3. Domain permission grant/revocation and sensitive capture exclusion.
4. Recording, compile, step rename, draft refresh/resume, test, immutable publication, fresh approval, production run, receipt/history/export, disable, and problem report.
5. Correct report download and declared verification.
6. Changed page, expired site login, missing element, slow network, unexpected popup, tab/origin change, API interruption, extension suspension, and approval expiry/replay.
7. Alert delivery, workflow disable, global kill switch, deployment rollback, and database restore.
8. Desktop and minimum supported viewport accessibility checks, keyboard navigation, focus order, error recovery, and reduced motion where relevant.

Every result records release IDs, Chrome version, extension ID/version/package checksum, pilot workflow checksum, environment, tester, timestamp, outcome, failure class, and evidence reference.

Use `docs/release/mvp-smoke-drills.md` and the fail-closed `npm run smoke:create` / `npm run smoke:check` commands so no case can be omitted, duplicated, relabeled, or carried across release contexts.

**Exit gate:** all release smoke cases pass; expected negative cases pause/reject safely; no unclassified failure remains.

**Expected effort:** 1–2 engineering days after Phases 3–5.

### Phase 7 — conduct the attended pilot and promote the MVP

**Objective:** obtain real-user proof and make the final go/no-go decision.

For each of three users:

1. Record consent, authorized site/workflow, manual duration, historical error baseline, and product-expectation check.
2. Observe installation and the first full creation/test/publication/production journey. Record every prompt, confusion, intervention, pause, and failure class.
3. Observe two later repeat production runs with no developer intervention.
4. Confirm the user can explain the exact domain/task, what data is excluded, why every run needs approval, what a safe pause means, and how to disable/report a problem.
5. Measure median active time, elapsed time, success, intervention, safe-pause, and support time. Compare saved time against the price-value threshold.

Promotion rule:

- Promote only the attended one-file report-download capability when all three users have three verified production runs, including two repeat runs without developer intervention; all uncertainties pause safely; there is zero sensitive-data leakage; and the value threshold is met.
- If the product code works but the value threshold fails, the release is technically pilot-ready but not a validated MVP. Revisit user/workflow selection, not feature breadth.
- If one recurring site-specific failure appears, fix only that bounded failure, publish a new release candidate, rerun affected security/smoke gates, and restart evidence counting for the changed release.

Use `docs/release/mvp-promotion.md` and the fail-closed `npm run pilot:create` / `npm run pilot:check` commands. The manifest accepts only three pseudonymous pilot records, binds every counted run to the Phase 6 release context, computes the value threshold, and rejects incomplete, unsafe, intervention-dependent, leakage-positive, or unsigned promotion evidence.

**Exit gate:** capability matrix and release manifest are updated with stable pilot evidence references, a founder go/no-go record is signed, and the exact MVP capability is declared deployed and customer-proven.

**Expected calendar time:** determined by the report's real recurrence; it cannot be replaced by synthetic runs.

## 6. Dependency map and critical path

```text
Gate A decisions
      |
Phase 0 baseline consolidation
      |
Phase 1 invite + exact pilot boundary
      |
Phase 2 real install-to-receipt loop
      +-------------------+
      |                   |
Phase 3 extension      Phase 4 deployment
distribution             environment
      |                   |
      +---------+---------+
                |
         Phase 5 security
                |
         Phase 6 smoke/drills
                |
         Phase 7 real pilots
                |
          MVP promotion
```

Phases 3 and 4 can run in parallel once the production API origin, extension distribution choice, and release candidate are stable. Security testing begins during implementation, but its release gate runs against the final package and deployed configuration.

## 7. Automation and manual-input boundary

### Work Codex can perform with repository and infrastructure access

- Branch integration support, scoped implementation, migrations, contracts, tests, CI, release scripts, deterministic extension package, checksums, SBOMs, scans, and documentation.
- Local/staging environment startup, database migration, synthetic fixture generation, negative security tests, controlled-run replay, browser automation that does not require pilot secrets, and evidence manifest generation.
- Deployment and configuration through provider CLIs after the user authenticates locally and explicitly selects the provider/project.
- Monitoring configuration, alert test commands, backup/restore/rollback scripts, release notes, pilot forms, scorecards, and capability-matrix updates supported by real evidence.

### Manual input or action that cannot be truthfully automated away

- Authorizing the target site and choosing the one report/outcome.
- Providing three real pilot participants and measuring their current manual baseline.
- Pilot users logging in, completing MFA/CAPTCHA, granting Chrome permission, approving each run, and giving consent/feedback. Credentials must never be shared with Codex.
- Creating/owning cloud, DNS, Chrome Web Store, support, and incident accounts; locally granting CLI access where desired.
- Chrome Web Store identity verification and final submission approvals.
- Legal/privacy/terms approval, permitted-use confirmation for the target site, support ownership, price threshold, and final founder go/no-go.
- Waiting for the real task to recur. Synthetic repetition does not become customer proof.

With the above access and decisions, roughly 85–90% of implementation and verification work is automatable. The remaining 10–15% is small in task count but decisive: authorization, identities, credentials, approvals, human observations, and commercial judgment.

## 8. Evidence artifacts produced by completion

- Signed pilot charter and scope/non-goals record.
- Backend/frontend commit IDs and immutable image digests.
- Extension ID, version, package ZIP, SHA-256 manifest, permission diff, SBOM, scan, and store/manual-distribution evidence.
- Migration checksum list, RLS-role proof, backup ID, restore report, rollback report, alert-delivery proof, and incident-owner record.
- Security allow/deny matrix and gate-by-gate regression references.
- Release smoke matrix with Chrome/environment/release identifiers.
- Three pilot records containing baseline, three run observations, interventions, safe pauses, time saved, and expectation comprehension.
- Final `launch-readiness` manifest reporting `ready: true`.
- Updated capability matrix promoting only the bounded attended report-download capability.

## 9. Stop rules

Stop and return to the last green gate when any of the following occurs:

- Target-site authorization is uncertain.
- The workflow requires credentials, OTPs, payment data, final submission, multiple domains, unknown downloads, or unverifiable output.
- A high security finding affects the pilot path.
- The extension package, source commits, deployment, and evidence identifiers do not match.
- An unexpected page condition continues instead of pausing.
- A pilot run needs hidden developer/database intervention to count as successful.
- The measured value does not support the proposed pilot price.

Do not respond to these failures by adding a second workflow or broader automation. Fix the bounded cause, choose a safer first workflow, or stop the pilot.
