# Controlled beta compatibility matrix

Last reviewed: 2026-08-24. The API copy in `src/beta/beta-types.ts` is the machine-readable source used by the dashboard.

| Area | Qualified support | Not supported in this beta |
|---|---|---|
| User browser | Chrome Stable extension, manual runs | Firefox, Safari, mobile browsers |
| Hosted browser | None until Phase 4 qualification is recorded | All manual, scheduled, and webhook-triggered hosted patterns |
| Tasks | One-file report download and read-only table extraction in an attended Chrome run | Filter/export writes, form entry, copy fields, broad conditions, autonomous research, CAPTCHA, destructive or financial actions |
| Target sites | HTTPS origins allowed by the workflow, plus explicit local demo origins | Local/private network discovery and unreviewed domain drift |
| Locators | Semantic roles, labels, text, test IDs, and verified fallbacks | Durable screen coordinates |
| Scheduling | None until the exact pattern and managed session pass hosted qualification | Every unqualified workflow pattern |
| Authoring | Recorder, calibrated video, and bounded text authoring | Unreviewed model output executing directly |

Compatibility failures use the `website-incompatibility` or `executor-limitation` beta category. Update this matrix only after the expansion review is approved and regression coverage exists.
