# Environment variable reference

All production secrets are injected at runtime. Do not bake them into an image, frontend bundle, workflow, test fixture, support report, or telemetry attribute.

| Variable | Required when | Purpose and operational rule |
| --- | --- | --- |
| `NODE_ENV` | Always | Set to `production`; disables development OpenAPI exposure. |
| `HOST`, `PORT` | Always | Listener address and port. Terminate TLS at a trusted ingress and keep the API on a private network behind it. |
| `DOONCE_ALLOWED_ORIGINS` | Browser dashboard enabled | Exact comma-separated HTTPS dashboard origins. Never use a wildcard with credentialed requests. |
| `DOONCE_EXTENSION_ORIGINS` | Extension enabled | Explicit extension origins accepted by capture routes. Review whenever the extension ID changes. |
| `DOONCE_PILOT_ALLOWED_ORIGIN` | MVP mode | Exact public HTTPS origin of the one authorized report site. It is distinct from the dashboard CORS origin. |
| `DATABASE_URL` | Persistent API | Restricted `doonce_app` role. Startup rejects superuser and row-security-bypass roles. |
| `MIGRATIONS_DATABASE_URL` | Migration job only | Schema-owner credential. Never provide it to the API or worker process. |
| `JOB_DATABASE_URL` | Durable workers or schedules | Role limited to the pg-boss schema. Do not reuse the tenant application role. |
| `SESSION_SECRET` | Authentication enabled | Independent random secret, at least 32 bytes; rotate through a planned session invalidation. |
| `ARTIFACT_SIGNING_SECRET` | Artifacts enabled | Independent key for short-lived download grants; rotate with an overlap plan or invalidate old grants. |
| `ARTIFACT_STORAGE_PATH` | Filesystem artifact adapter | Durable mounted volume writable only by the runtime user. Use a cloud object-store adapter for multi-host deployments. |
| `TEXT_AUTHORING_ENABLED` | Text authoring desired | Enables asynchronous text-to-draft jobs. Existing workflows run when disabled. |
| `REPAIR_ENABLED` | Repair proposals desired | Enables reviewable repair analysis; it never publishes automatically. |
| `VIDEO_AUTHORING_ENABLED` | Video authoring desired | Requires media storage and decode tools. Existing workflows run when disabled. |
| `VIDEO_STORAGE_PATH` | Video authoring enabled | Temporary mounted media volume. Retention cleanup must be monitored. |
| `FFPROBE_EXECUTABLE_PATH`, `FFMPEG_EXECUTABLE_PATH`, `TESSERACT_EXECUTABLE_PATH` | Video authoring enabled | Absolute, operator-controlled tool paths. Keep packages patched and do not accept executable paths from requests. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Hosted runs enabled | Operator-controlled Chromium executable. Browser packages and compatibility must follow the release policy. |
| `METRICS_BEARER_TOKEN` | Metrics scraping enabled | Independent high-entropy token for `/internal/metrics`. Keep the endpoint on an internal network. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Trace export enabled | Trusted OTLP/HTTP collector base URL. No browser content or raw error messages are added to spans. |
| `OTEL_SERVICE_NAME` | Trace export enabled | Stable deployment service name, normally `doonce-api` or `doonce-worker`. |
| `DOONCE_WORKFLOW_CHANGES_ENABLED` | Always | Set `false` to stop authoring/publishing while preserving reads and existing execution. |
| `DOONCE_KILL_SWITCH` | Always | Emergency override that blocks workflow changes, approvals, new runs, and claims; active work may only checkpoint and pause. |
| `DOONCE_DEPLOYMENT_ID`, `DOONCE_ENVIRONMENT` | Production MVP | Stable deployment/environment labels included in health and run receipts. |
| `DOONCE_BACKEND_COMMIT`, `DOONCE_FRONTEND_COMMIT` | Production MVP | Full reviewed source commits for the exact release. |
| `DOONCE_BACKEND_IMAGE_DIGEST`, `DOONCE_FRONTEND_IMAGE_DIGEST` | Production MVP | Immutable `sha256:` registry image digests. |
| `DOONCE_EXTENSION_ID`, `DOONCE_EXTENSION_VERSION`, `DOONCE_EXTENSION_PACKAGE_SHA256` | Production MVP | Exact distributed Chrome package identity. The configured extension origin must match the ID. |
| `DOONCE_PROTOCOL_SCHEMA_SHA256`, `DOONCE_MIGRATION_SET_SHA256` | Production MVP | Contract and ordered migration-set provenance. Startup/readiness rejects database drift. |

Provider- and vault-specific variables belong to their adapter documentation. Only secret references such as `env://FINANCE_SESSION` may be stored in DoOnce tables; raw browser storage state is resolved inside the worker.
