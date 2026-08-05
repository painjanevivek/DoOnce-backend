# Draft incident-response workflow — legal and operations review required

**Status:** internal operating draft.  
**Incident lead:** [on-call role].  
**Escalation contacts:** [security], [engineering], [legal/privacy], [customer support].

## Trigger and contain

1. Open an incident record with time, reporter, affected service/tenant, and observable impact. Do not copy passwords, OTPs, or unredacted customer content into it.
2. Assess whether confidentiality, integrity, availability, tenant isolation, or workflow safety is affected.
3. Use the workflow kill switch to halt workflow creation and publication when automation safety is in doubt. Revoke affected sessions or isolate infrastructure only with the incident lead’s approval.
4. Preserve relevant, redacted logs and immutable workflow audit events. Record every containment action and decision.

## Investigate, communicate, recover

1. Assign a technical owner and legal/privacy reviewer. Establish the affected population and data categories from evidence, not assumption.
2. Provide factual internal updates; externally communicate only through approved legal and support channels.
3. Fix the cause, peer-review the change, test it, and verify that tenant isolation and safety controls still hold.
4. Restore service gradually. Keep the kill switch active until the incident lead approves recovery.

## Close and learn

- Publish a redacted post-incident review with timeline, impact, root cause, corrective actions, owners, and due dates.
- Determine notification obligations and timing with qualified counsel for affected jurisdictions.
- Rehearse this workflow, including kill-switch operation and rollback, before production launch and at least [cadence] thereafter.
