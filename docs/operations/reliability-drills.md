# Load, chaos, and recovery drills

Run drills in an isolated environment with fixture tenants and pages. Never load-test production with real customer workflows or session material.

| Drill | Method | Required evidence | Pass condition |
| --- | --- | --- | --- |
| Workflow list | Authenticated reads at expected peak and 2x peak | p50/p95/p99 latency, errors, DB saturation | p95 below 500 ms at peak; errors below 1% |
| Run creation | Repeated idempotent requests plus unique requests | created run IDs and duplicate count | one run per idempotency key |
| Capture ingestion | Contiguous and retried event batches | cursor acknowledgements and stored action count | no gaps and no duplicate actions |
| Artifact metadata | Concurrent bounded uploads with storage healthy/unavailable | API status, metadata/binary consistency | clean failure; no metadata points to missing bytes |
| Worker termination | Kill a worker before claim, after claim, and after checkpoint | queue job ID, lease, checkpoint, terminal result | no lost job; no duplicate terminal run or side effect |
| Database failover | Force primary failover during API and worker activity | readiness, reconnect time, error rates | service fails closed and recovers without cross-tenant reads |
| Object-store outage | Deny writes and reads | upload/download failure metrics | runs explain evidence failure without corrupting run state |
| Provider outage | Timeout/error the authoring adapter | model/job metrics and execution tests | authoring fails boundedly; published workflows still run |
| Extension disconnect | Suspend worker/network during a run | checkpoint and resume receipt | uncertain in-flight action pauses; verified steps are not repeated |
| Backup restore | Restore encrypted backup into isolated environment | counts, migration checksums, RTO/RPO | documented objectives met and controlled fixture runs |

Use a staged ramp (1, 2, 4, 8, then expected concurrency), stop on saturation, and retain only aggregate performance data. The alert thresholds in `ops/prometheus/alerts.yml` are starting points and must be recalibrated from beta traffic.
