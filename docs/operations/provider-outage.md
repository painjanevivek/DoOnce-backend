# Model-provider outage procedure

Text authoring is an optional producer of draft workflows. Published workflows, capture compilation, local execution, hosted execution, schedules, and run verification do not depend on it.

1. Confirm provider error rate and latency metrics, queue age, and whether the fault is regional, quota-related, or a contract/schema regression.
2. Set `TEXT_AUTHORING_ENABLED=false` for a prolonged outage or stop authoring workers while leaving execution workers running.
3. Keep queued jobs bounded. Failed jobs remain failed with a stable code; do not retry indefinitely or silently switch models.
4. Tell users that draft creation from text is unavailable and that existing workflows still run. Recommend recorder-based authoring if capture services are healthy.
5. Before recovery, run the controlled authoring evaluation set against the exact provider/model/prompt version.
6. Resume with low concurrency, watch cost/latency/validation-retry metrics, and preserve the model identity on every result.
