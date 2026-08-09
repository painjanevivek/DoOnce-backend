# Controlled beta compatibility matrix

Last reviewed: 2026-08-09. The API copy in `src/beta/beta-types.ts` is the machine-readable source used by the dashboard.

| Area | Qualified support | Not supported in this beta |
|---|---|---|
| User browser | Chrome Stable extension, manual runs | Firefox, Safari, mobile browsers |
| Hosted browser | Playwright-pinned Chromium, manual and scheduled runs | Arbitrary browser versions or desktop applications |
| Tasks | Report download, filter/export, structured form entry, table extraction, copy fields, bounded conditions | Broad autonomous research, CAPTCHA solving, destructive or financial actions |
| Target sites | HTTPS origins allowed by the workflow, plus explicit local demo origins | Local/private network discovery and unreviewed domain drift |
| Locators | Semantic roles, labels, text, test IDs, and verified fallbacks | Durable screen coordinates |
| Scheduling | Compatible published workflow and managed browser session | Local-only browser sessions |
| Authoring | Recorder, calibrated video, and bounded text authoring | Unreviewed model output executing directly |

Compatibility failures use the `website-incompatibility` or `executor-limitation` beta category. Update this matrix only after the expansion review is approved and regression coverage exists.
