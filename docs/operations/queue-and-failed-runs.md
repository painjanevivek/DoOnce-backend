# Queue recovery and failed-run investigation

## Queue alert triage

1. Check queue depth, oldest ready-job age, active jobs, failure rate, database readiness, and worker deployment health.
2. Decide whether the fault is producer-side, queue/database-side, or worker/executor-side. Do not redrive until the cause is bounded.
3. Pause new schedules or workflow changes if backlog growth threatens normal runs. Existing job idempotency keys must remain unchanged.
4. Restart one worker. pg-boss leases/retries should make the job available without creating a second run; verify the run ID and terminal result before scaling restarts.
5. For dead-lettered jobs, record queue, stable error type, attempts, source job ID, and age. Fix the cause, then redrive a bounded batch oldest-first.

Never edit job payloads in the database. Never mark a browser side effect complete from queue state alone. An interrupted in-flight action is treated as uncertain and must pause or resume from its stored checkpoint.

## Failed run investigation

1. Locate the run by tenant-safe support reference, run ID, workflow ID/version, executor type/version, and time window.
2. Review stable reason codes and step results. Use artifacts only through short-lived signed grants and only when the reporter authorized them.
3. Classify the failure: locator, verification, authentication/session, executor disconnect, capability mismatch, infrastructure, or unknown.
4. Confirm whether a side effect may have occurred. If uncertain, do not retry automatically.
5. Create a repair proposal only when bounded semantic candidates exist. A person must review, test, and publish a separate draft.
6. Record the resolution category and link it to the incident or repeated-failure review; do not copy page content, credentials, selectors, or raw values into tickets.
