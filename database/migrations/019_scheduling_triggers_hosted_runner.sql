ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_executor_check;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_executor_check CHECK (executor IN ('extension', 'hosted-browser'));
ALTER TABLE workflow_runs ADD COLUMN trigger_kind text NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual', 'api', 'webhook', 'schedule'));

CREATE TABLE browser_session_profiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  location text NOT NULL CHECK (location IN ('user-browser', 'managed')),
  secret_reference text CHECK (secret_reference IS NULL OR char_length(secret_reference) BETWEEN 1 AND 500),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((location = 'managed' AND secret_reference IS NOT NULL) OR (location = 'user-browser' AND secret_reference IS NULL)),
  UNIQUE (tenant_id, name)
);
ALTER TABLE workflow_runs ADD COLUMN session_profile_id uuid REFERENCES browser_session_profiles(id) ON DELETE SET NULL;
ALTER TABLE workflow_runs ADD COLUMN queue_job_id uuid;
CREATE INDEX workflow_runs_queue_job_idx ON workflow_runs (queue_job_id) WHERE queue_job_id IS NOT NULL;

CREATE TABLE workflow_schedules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  cron_expression text NOT NULL CHECK (char_length(cron_expression) BETWEEN 5 AND 120),
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 100),
  dst_policy text NOT NULL DEFAULT 'run-once' CHECK (dst_policy IN ('run-once', 'skip-duplicate')),
  input_bindings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_bindings) = 'object'),
  session_profile_id uuid NOT NULL REFERENCES browser_session_profiles(id),
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_enqueued_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_trigger_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('api', 'webhook', 'schedule')),
  source_id uuid,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  run_id uuid REFERENCES workflow_runs(id),
  fired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, trigger_kind, idempotency_key)
);

CREATE TABLE workflow_webhook_endpoints (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  signing_secret_reference text NOT NULL CHECK (char_length(signing_secret_reference) BETWEEN 1 AND 500),
  session_profile_id uuid REFERENCES browser_session_profiles(id),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_schedules_due_idx ON workflow_schedules (next_run_at, id) WHERE enabled = true;
CREATE INDEX workflow_trigger_receipts_run_idx ON workflow_trigger_receipts (tenant_id, run_id);
CREATE INDEX browser_session_profiles_tenant_idx ON browser_session_profiles (tenant_id, enabled);
ALTER TABLE browser_session_profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE browser_session_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_schedules ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_trigger_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_trigger_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_webhook_endpoints ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY browser_session_profiles_are_isolated ON browser_session_profiles USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY workflow_schedules_are_isolated ON workflow_schedules USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY workflow_trigger_receipts_are_isolated ON workflow_trigger_receipts USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY workflow_webhook_endpoints_are_isolated ON workflow_webhook_endpoints USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE OR REPLACE FUNCTION app.resolve_webhook_endpoint(endpoint_id uuid)
RETURNS TABLE (
  id uuid, tenant_id uuid, workflow_id uuid, session_profile_id uuid,
  signing_secret_reference text, enabled boolean, created_by uuid,
  created_by_email text, created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT endpoints.id, endpoints.tenant_id, endpoints.workflow_id, endpoints.session_profile_id,
    endpoints.signing_secret_reference, endpoints.enabled, endpoints.created_by,
    users.email, endpoints.created_at
  FROM public.workflow_webhook_endpoints endpoints
  JOIN public.users users ON users.id = endpoints.created_by
  WHERE endpoints.id = endpoint_id AND endpoints.enabled = true
$$;
REVOKE ALL ON FUNCTION app.resolve_webhook_endpoint(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON browser_session_profiles, workflow_schedules, workflow_trigger_receipts, workflow_webhook_endpoints TO doonce_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION app.resolve_webhook_endpoint(uuid) TO doonce_app';
  END IF;
END;
$$;
