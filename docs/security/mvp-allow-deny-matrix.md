# MVP security allow/deny matrix

This matrix is the Phase 5 source of truth for the bounded attended Chrome release. It maps each release-blocker cluster to executable repository checks. A document reference alone never passes a gate.

## Reproducible commands

Run these from clean release commits:

- Backend: `npm run security:verify -- --release`.
- Backend with PostgreSQL 16 and the restricted `doonce_app` role: `npm run test:postgres-security`.
- Frontend after deterministic packaging: `npm run package:extension:release`, then `npm run security:verify -- --release`.
- Both repositories: `npm audit --omit=dev --audit-level=high`, SBOM generation, and the pinned CI container/package scans.

CI retains the raw TAP, tracked-secret JSON, release metadata, SBOM, and vulnerability-scan outputs for 30 days. The launch manifest must link those artifacts and identify the exact backend commit, frontend commit, extension package SHA-256, and migration-set SHA-256.

## Matrix

| Cluster | Allowed proof | Required deny proof | Executable references |
|---|---|---|---|
| Object authorization | Current member accesses only owned resources permitted by their role and tenant. | Anonymous, removed member, other user, other tenant, and wrong role cannot enumerate or mutate the object. | Backend auth, store, server, and `postgres-mvp-controls` tests. |
| Durable identity | Pairing, approval, claims, checkpoints, finish, receipt, and artifact operations use a currently valid member and bound credential. | Removed membership, expired/revoked credential, wrong lease, replay, or changed identity fails closed. | Backend capture, run, artifact, tenant-context, and PostgreSQL tests. |
| Evidence integrity | Test, publication, run, result, receipt, download action, and artifact share the expected immutable identifiers and checksums. | Cross-run, cross-user, cross-version, cross-action, and changed-checksum evidence is rejected. | Backend run/receipt/artifact tests and frontend eligibility/evidence/interpreter tests. |
| Extension/API boundary | The one release extension talks to the release HTTPS API and one approved HTTPS pilot origin. | HTTP, loopback, wildcard, website-origin mutation, prior extension ID, missing token, and version mismatch are rejected. | Backend deployment/MVP/server tests and frontend API/pilot/transport/package tests. |
| Action/data policy | Value-free navigation/read/wait/compare/download actions execute within the declared origin and verification bounds. | Password, OTP, payment, hidden/file/contenteditable capture, unknown write, raw selector, page content, query, or typed value is rejected or safely paused. | Backend action/capture/server tests and frontend capture-target/storage/export/interpreter tests. |
| Per-run approval | A visible, short-lived approval is consumed once for the bound user, tenant, workflow version/checksum, inputs, origin, and extension version. | Replay, expiry, concurrent reuse, changed binding, missing approval, or kill switch rejects run creation/claim. | Backend `run-service` and `postgres-mvp-controls` tests plus frontend run-eligibility tests. |
| Supply chain/resources | Clean lockfiles, deterministic package, pinned CI actions/images, bounded regex, passing audits/scans, and no high-confidence tracked credential. | Dirty package inputs, source maps, extra permissions/files, vulnerable gated dependency/image, unsafe regex, or tracked credential blocks release. | Both security commands, frontend package tests, bounded-pattern tests, audits, SBOMs, and pinned CI scans. |
| Consent lifecycle | Grant applies to one exact origin; revocation clears that origin's capture/run state while preserving unrelated origins. | Recording/sync after revocation and cross-origin cleanup are rejected; server records follow the approved retention policy. | Backend capture tests and frontend capture storage/session/export tests; retention approval remains a founder/legal gate. |

## Pass and block rules

- A report is release-bound only when its source tree is clean and its commit matches the release manifest.
- Frontend evidence is release-bound only when the deterministic release JSON matches the frontend commit and archive SHA-256.
- The live PostgreSQL test is mandatory because mocked store tests cannot prove forced RLS or atomic approval consumption.
- Any high-severity finding on the pilot path blocks release. Fix it and rerun, or keep the affected capability disabled.
- Provider scans, final source-diff sign-off, retention approval, and evidence URLs require manual review; the repository produces everything else automatically.
