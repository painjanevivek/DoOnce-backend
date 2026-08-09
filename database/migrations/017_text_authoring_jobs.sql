CREATE TABLE authoring_tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  daily_job_limit integer NOT NULL DEFAULT 20 CHECK (daily_job_limit BETWEEN 1 AND 10000),
  daily_token_limit integer NOT NULL DEFAULT 200000 CHECK (daily_token_limit BETWEEN 1000 AND 100000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO authoring_tenant_settings (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE authoring_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'needs-input', 'completed', 'failed', 'cancelled')),
  task_description text NOT NULL CHECK (char_length(task_description) BETWEEN 10 AND 5000),
  starting_url text CHECK (starting_url IS NULL OR char_length(starting_url) BETWEEN 8 AND 2048),
  available_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  observation_session_id uuid REFERENCES capture_sessions(id) ON DELETE SET NULL,
  executor_capabilities jsonb NOT NULL,
  workflow_schema_version integer NOT NULL DEFAULT 1 CHECK (workflow_schema_version = 1),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 200),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 200),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 200),
  progress_phase text NOT NULL DEFAULT 'queued' CHECK (char_length(progress_phase) BETWEEN 1 AND 100),
  progress_message text NOT NULL DEFAULT 'Waiting to start.' CHECK (char_length(progress_message) BETWEEN 1 AND 1000),
  result jsonb,
  workflow_id uuid REFERENCES workflows(id),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 200),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  validation_retries integer NOT NULL DEFAULT 0 CHECK (validation_retries BETWEEN 0 AND 5),
  prompt_tokens integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens integer NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  estimated_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_microusd >= 0),
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, requested_by, idempotency_key)
);

CREATE TABLE authoring_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES authoring_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX authoring_jobs_queue_idx ON authoring_jobs (tenant_id, status, created_at);
CREATE INDEX authoring_jobs_usage_idx ON authoring_jobs (tenant_id, created_at) INCLUDE (prompt_tokens, completion_tokens);
CREATE INDEX authoring_job_events_timeline_idx ON authoring_job_events (tenant_id, job_id, created_at, id);

ALTER TABLE authoring_tenant_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE authoring_tenant_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE authoring_jobs ENABLE ROW LEVEL SECURITY; ALTER TABLE authoring_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE authoring_job_events ENABLE ROW LEVEL SECURITY; ALTER TABLE authoring_job_events FORCE ROW LEVEL SECURITY;
CREATE POLICY authoring_tenant_settings_are_isolated ON authoring_tenant_settings USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY authoring_jobs_are_isolated ON authoring_jobs USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY authoring_job_events_are_isolated ON authoring_job_events USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON authoring_tenant_settings, authoring_jobs, authoring_job_events TO doonce_app';
  END IF;
END;
$$;
