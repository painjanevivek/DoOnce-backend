# Product Metrics Taxonomy

DoOnce records aggregate, low-cardinality product signals only. URLs, domains, page text, selectors, field values, emails, workflow titles, and user identifiers are prohibited dimensions.

## Approved events

- Activation funnel: extension paired, capture finalized, draft created, draft tested, workflow published, verified outcome.
- Reliability: run started by executor/trigger and run outcome by executor/status.
- Unit costs: authoring tokens, hosted-browser seconds, artifact bytes, and support seconds.

Metrics use counters so dashboards can calculate conversion and rates with explicit denominators. A dashboard must show raw numerator and denominator beside any percentage. Cost metrics are inputs, not revenue or “time saved” claims.

The `ProductAnalytics` boundary rejects unknown events, arbitrary fields, invalid enums, and negative/non-finite quantities. Additions require privacy review and an expansion-gate proposal.

## Dashboard views

1. Install → pair → first draft → exact test → publish → first verified outcome.
2. Run outcomes grouped only by executor and trigger.
3. Intervention rate from beta evidence.
4. Unit-cost inputs per verified outcome.

No customer-value claim should be derived until real beta participants establish the baseline and outcome definition.
