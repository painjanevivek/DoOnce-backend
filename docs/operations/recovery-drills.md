# Recovery Drill Protocol

Run these drills in a production-like environment before enabling hosted execution. Unit tests validate the evidence format; they do not count as infrastructure proof.

## Required drills

- authoring provider timeout and invalid response;
- database unavailability and checksum-verified restore;
- queue outage and restart;
- worker termination after checkpoint and before/after a side effect;
- object-storage interruption and checksum-verified restore;
- extension suspension, disconnect, cancellation, and lease expiry.

For each drill, record an ordered event sequence: fault injection, safe pause/termination, checkpoint when applicable, recovery, every side-effect idempotency key, and restore verification. Evaluate it with `evaluateRecoveryDrill`.

## Pass conditions

- no side-effect key appears twice;
- work pauses, resumes, or terminates predictably;
- database/storage restore checksums match;
- alerts fire and identify the stable failure class;
- the runbook contains the observed recovery action and owner;
- the evidence references the deployed build, browser image, and environment.

Store actual drill evidence outside source control if it contains infrastructure identifiers. Commit only a redacted decision record and qualification reference. A simulated test result must never be labeled as a completed production-like drill.
