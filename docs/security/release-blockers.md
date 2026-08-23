# Release-blocker register

This register groups the 2026-08-13 static findings by shared control. The capability remains disabled for external use until its cluster has regression evidence.

| Cluster | Affected capability | Gate |
|---|---|---|
| Object authorization | profiles, captures, artifacts, claims | Shared allow/deny matrix passes |
| Durable identity | schedules, webhooks, leases | Current membership and lease rechecked |
| Executor boundaries | hosted and extension execution | Exact origin and public-network checks pass |
| Action/data policy | compilation and execution | Sensitive fields pause; writes require run approval |
| Evidence integrity | publication and artifacts | Evidence is bound to draft, run, action, and executor |
| Extension/API boundary | pairing and synchronization | Production HTTPS and exact extension-origin policy |
| Supply chain/resources | releases and regex inputs | Immutable dependencies and bounded evaluation |
| Consent lifecycle | capture data | Revocation cleanup is complete and tested |

Documentation does not close a finding. Closure requires a focused regression test, the owning package checks, and a security diff review.
