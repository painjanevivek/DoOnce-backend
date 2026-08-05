# Draft data-retention policy — legal review required

**Status:** internal draft; retention periods are placeholders until counsel approves them.  
**Owner:** [privacy owner].

## Data-minimisation rules

- Do not retain passwords, OTPs, payment credentials, final-submission payloads, browser page content, or raw action values.
- Keep workflow audit events lifecycle-only: identifiers, version, actor, timestamp, event type, and aggregate counts.
- Store tenant data behind tenant-scoped access controls; a deletion/export request must never expose another tenant’s data.

## Proposed schedule to validate

| Data | Proposed retention | Disposal expectation |
| --- | --- | --- |
| Active account and tenant records | while account is active | delete or anonymise after the approved account-closure period |
| Revoked session-token hashes | [30 days] | delete automatically after expiry and security-review window |
| Draft/active workflow versions and lifecycle audit events | while tenant keeps the workflow + [90 days] | delete after approved request/closure schedule unless a lawful hold applies |
| Redacted support diagnostics | [30 days] | delete after case closure unless retained for an approved incident |
| Security/operational logs | [30–90 days] | restrict access and purge on an automated schedule |

## Required controls before launch

- documented retention owner, approved durations, deletion jobs, and restoration/back-up treatment;
- tested tenant-scoped export and deletion procedures;
- legal-hold process that overrides deletion only when approved and recorded; and
- quarterly review of data categories, access, and retention evidence.
