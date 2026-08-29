# MVP production decision gate

The founder has selected the intended pilot architecture, but selection is not proof that production is ready. The checked-in template records the approved defaults and remains intentionally blocked on human evidence.

## Approved defaults

- Render project `doonce-pilot-production`, Singapore after immediate pre-provisioning reconfirmation.
- One frontend service, one API service, no worker, and no additional service without founder approval.
- Paid PostgreSQL with seven-day point-in-time recovery.
- USD 150 hard monthly ceiling.
- Proposed frontend and API origins `https://pilot.doonce.dev` and `https://api-pilot.doonce.dev`; neither is approved until registrar ownership and Cloudflare zone access are evidenced.
- Unlisted Chrome Web Store distribution, with checksum-verified manual installation restricted to the same three pilots while review is pending.
- Manual password, SSO, and MFA only. CAPTCHA is never automated. Cross-origin report redirects are a no-go.
- Five-minute minimum time saving for each of `pilot-alpha`, `pilot-bravo`, and `pilot-charlie`.

The retention schedule in the template is normative. Downloaded report artifacts are assigned a seven-day expiry. New indefinite artifact pinning is disabled until an approved legal-hold workflow exists; already-authorized legal-hold records remain exempt from ordinary cleanup. Provisioning remains blocked until a stable evidence reference proves physical database/artifact deletion plus provider log, support, PITR, and backup retention enforcement.

## Prepare evidence without committing private data

Copy `ops/environments/mvp-production.template.json` to an access-controlled location outside the repository. Enter legal names, authorization details, participant observations, and evidence references there. Do not enter credentials, API keys, recovery codes, browser sessions, OTPs, CAPTCHA data, page bodies, or report contents.

The production file must contain only metadata for the five authorized historical downloads: filename, MIME type, byte size, SHA-256, generation timestamp, exact observed origin, redirect origins, and a stable evidence reference.

```powershell
npm run production:check -- --file=C:\secure-evidence\mvp-production.json
```

The command exits non-zero until both stages pass:

1. `provisioningReady` requires reconfirmed Singapore region, exact budget/topology, registrar and Cloudflare evidence, local Render/Cloudflare authentication, the approved retention policy, and accepted named accountability.
2. `pilotReady` additionally requires Chrome publishing evidence, final extension distribution, written organization authorization, a same-origin report contract, five legitimate samples, three consenting measured pilots, and the 300-second threshold.

Changing a region, budget, provider, topology, retention value, hostname, distribution boundary, or report scope requires founder review before editing the production evidence.
