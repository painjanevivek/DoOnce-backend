# Dashboards and alerts

Import `ops/grafana/doonce-overview.json` and load `ops/prometheus/alerts.yml`. Scrape `/internal/metrics` over the internal network with the bearer token; send OTLP/HTTP traces to the trusted collector.

The primary dashboard answers four questions in order:

1. Can users reach the API? HTTP request rate, 5xx ratio, and p95 latency.
2. Is work moving? Queue depth, oldest job age, worker duration, and failures by queue.
3. Are workflows succeeding? Run results/duration by executor, locator failures, and verification failures.
4. Are authoring and evidence services healthy? Model request latency/error/cost, artifact upload failures, and extension sync results.

Page an operator for sustained API 5xx, readiness failure, queue age beyond five minutes, repeated worker failures, or a sharp production-run failure ratio. Create a ticket rather than a page for isolated locator failures or model validation retries. Alert labels must remain low-cardinality and must never contain tenant IDs, workflow IDs, URLs, selectors, prompt text, or input values.
