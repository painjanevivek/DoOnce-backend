# MVP promotion evidence

MVP promotion is a human decision backed by real-user evidence. The checker prevents missing, duplicated, release-mismatched, or unsafe claims from being represented as a completed pilot; it does not manufacture customer proof.

## Prepare the release-bound record

1. Copy `release/mvp-promotion-input.template.json` outside the repository's tracked files.
2. Replace every release placeholder with the exact context that passed `npm run smoke:check`.
3. Set `charterSha256` to the signed pilot charter checksum and `minimumTimeSavedSeconds` to the founder-approved value threshold.
4. Use three distinct pseudonymous IDs. Keep participant names, emails, credentials, site content, and free-form feedback out of this manifest.
5. Generate the fail-closed record once:

```powershell
npm run pilot:create -- --input=C:\secure-evidence\promotion-input.json --output=C:\secure-evidence\promotion.json
```

The output uses exclusive creation and will not overwrite an existing evidence file.

## Record the attended pilot

For each participant, retain private source evidence in the approved evidence store and put only stable references in the manifest. A passing participant needs:

- dated consent, expectation, observer, safe-pause, and leakage-review evidence;
- a positive manual-duration baseline and historical error rate;
- exactly three distinct production run IDs: one first production run and two repeat runs;
- a fresh approval reference and verified receipt reference for every run;
- release-context binding, no developer intervention, and no sensitive-data leakage for every counted run;
- active, elapsed, and support durations in whole seconds;
- all five comprehension checks and explicit recording of every observed uncertainty, including an empty set when none occurred.

The checker computes median active and elapsed time. Every participant must meet the charter's minimum median time saved. A technically working product that misses this value gate is not a validated MVP.

After the release smoke record is passed and all participant records are complete, the founder records `go` or `no-go`. A `go` requires stable references to the signed decision, passing launch-readiness manifest, and updated capability matrix.

```powershell
npm run pilot:check -- --file=C:\secure-evidence\promotion.json
```

Any pending, failed, unknown, duplicate, unsafe, intervention-dependent, leakage-positive, below-threshold, or cross-release evidence returns a non-zero exit code. Changing a release identifier changes the context checksum and invalidates carried pilot results.

## Manual boundary

Codex can generate and validate the manifest, calculate promotion metrics, and update the capability matrix after valid references exist. Only authorized humans can provide consent, perform the real recurring task, approve runs, judge comprehension, approve legal/privacy terms, and sign the final commercial decision. Do not paste credentials or raw customer/site data into repository files or Codex prompts.
