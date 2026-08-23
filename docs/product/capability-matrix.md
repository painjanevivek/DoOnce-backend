# DoOnce capability matrix

**Matrix revision:** 2026-08-24
**Release posture:** advanced alpha; controlled external use remains gated

This matrix is the release source of truth. “Implemented” means code exists, “tested” means repository verification covers the stated boundary, “deployed” requires production-like evidence, and “customer-proven” requires repeated real-user outcomes. A capability is never promoted by inference.

| Capability | Implemented | Tested | Deployed | Customer-proven | Release state |
|---|---:|---:|---:|---:|---|
| Account and tenant sessions | Yes | Yes | No | No | Internal only |
| Capture session lifecycle | Yes | Yes | No | No | Internal only |
| Recording to WorkflowSpec compilation | Bounded patterns | Yes | No | No | Fixture only |
| Text authoring | Yes | Provider boundary | No | No | Provider qualification required |
| Video authoring and calibration | Foundation | Yes | No | No | Operator-assisted only |
| Draft review and immutable publication | Yes | Yes | No | No | Security binding required |
| Attended extension execution | Foundation | Controlled fixture | No | No | Beta distribution required |
| Hosted Playwright execution | Foundation | Component tests | No | No | Disabled until qualified |
| Scheduling and webhooks | Foundation | Component tests | No | No | Disabled until identity reauthorization passes |
| Verification receipts and artifacts | Foundation | Component tests | No | No | Evidence binding required |
| Repair proposals | Yes | Yes | No | No | Review required |
| Controlled-beta evidence | Yes | Yes | No | No | Enrollment only |

## Promotion rules

- “Deployed” requires a named environment, immutable release identifier, smoke evidence, monitoring, rollback, and restore evidence.
- “Customer-proven” requires consented observations from real workflows; local fixtures and synthetic runs never qualify.
- A high security finding blocks the affected external capability unless the capability is disabled and the residual decision is recorded.
- Public product copy may describe the teach, review, test, publish, run, and verify model, but must not imply universal website support or unattended reliability.

## Current release blockers

1. Object authorization and durable identity reauthorization.
2. Claim, lease, result, receipt, and artifact binding.
3. Hosted egress and extension origin enforcement.
4. Sensitive-field and per-run approval enforcement.
5. Manifest V3 distribution decision and matching privacy disclosures.
6. Production infrastructure, extension distribution, and customer evidence.
