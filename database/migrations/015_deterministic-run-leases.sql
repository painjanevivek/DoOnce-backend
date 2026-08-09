CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  workflow_id uuid NOT NULL,
  workflow_version integer NOT NULL CHECK (workflow_version > 0),
  executor text NOT NULL CHECK (executor = 'extension'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  inputs jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  workflow_definition jsonb NOT NULL CHECK (jsonb_typeof(workflow_definition) = 'object'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  requested_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  current_step_index integer NOT NULL DEFAULT 0 CHECK (current_step_index >= 0),
  step_results jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(step_results) = 'array'),
  checkpoint jsonb,
  extension_version text,
  extension_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(extension_capabilities) = 'array'),
  lease_token_hash text CHECK (lease_token_hash IS NULL OR lease_token_hash ~ '^[a-f0-9]{64}$'),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_versions(workflow_id, version),
  UNIQUE (tenant_id, requested_by, idempotency_key)
);

CREATE INDEX workflow_runs_queue_idx ON workflow_runs (tenant_id, status, requested_at)
  WHERE status IN ('queued', 'running');
CREATE INDEX workflow_runs_history_idx ON workflow_runs (tenant_id, requested_at DESC);

CREATE FUNCTION touch_workflow_run_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_runs_touch_updated_at
BEFORE UPDATE ON workflow_runs
FOR EACH ROW EXECUTE FUNCTION touch_workflow_run_updated_at();

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_runs_are_isolated ON workflow_runs
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_runs TO doonce_app';
  END IF;
END;
$$;
