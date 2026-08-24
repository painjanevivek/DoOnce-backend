# Release-blocker register

This register groups the 2026-08-13 static findings by shared control. The capability remains disabled for external use until its cluster has regression evidence.

| Cluster | Affected capability | Repository regression reference | Retained evidence |
|---|---|---|---|
| Object authorization | profiles, captures, artifacts, claims | `test/postgres-mvp-controls.test.ts`, store/service authorization tests | `postgres-security.tap`, backend security TAP |
| Durable identity | pairing, approvals, leases, artifacts | `test/postgres-mvp-controls.test.ts`, `test/postgres-artifact-metadata-store.test.ts`, `test/run-service.test.ts` | PostgreSQL and backend security TAP |
| Executor boundaries | hosted and extension execution | `test/network-policy.test.ts`, `test/deployment-policy.test.ts`, frontend interpreter/transport regressions | Backend and frontend security TAP |
| Action/data policy | compilation and execution | `test/action-policy.test.ts`, `test/capture-service.test.ts`, frontend capture-policy regressions | Backend and frontend security TAP |
| Evidence integrity | publication, runs, receipts, artifacts | `test/run-service.test.ts`, `test/run-receipt.test.ts`, artifact-store tests, frontend evidence regressions | Backend and frontend security TAP |
| Extension/API boundary | pairing and synchronization | `test/server.test.ts`, `test/capture-service.test.ts`, frontend API/pilot configuration tests | Backend and frontend security TAP plus release JSON |
| Supply chain/resources | releases and regex inputs | tracked-secret scanners, dependency audit, bounded-pattern tests, pinned CI actions | secret-scan JSON, SBOMs, Anchore reports, extension release bundle |
| Consent lifecycle | capture data | `test/capture-service.test.ts` and frontend capture storage/session/export tests | Backend and frontend security TAP |

Documentation does not close a finding. Closure requires the focused repository regressions in [the allow/deny matrix](mvp-allow-deny-matrix.md), owning-package checks, a reviewed source diff, and clean release-bound CI artifacts.
