ALTER TABLE workflow_runs ADD COLUMN workflow_checksum text;
ALTER TABLE workflow_runs ADD COLUMN mode text NOT NULL DEFAULT 'production' CHECK (mode IN ('test', 'production'));
UPDATE workflow_runs runs SET workflow_checksum = versions.definition_checksum
FROM workflow_versions versions
WHERE versions.workflow_id = runs.workflow_id AND versions.version = runs.workflow_version;
ALTER TABLE workflow_runs ALTER COLUMN workflow_checksum SET NOT NULL;
ALTER TABLE workflow_runs ADD CHECK (workflow_checksum ~ '^[a-f0-9]{64}$');

CREATE TABLE workflow_step_runs (
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  status text NOT NULL CHECK (status IN ('verified', 'paused', 'failed', 'skipped')),
  reason_code text,
  result jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, step_id)
);

CREATE TABLE executor_leases (
  run_id uuid PRIMARY KEY REFERENCES workflow_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  executor text NOT NULL CHECK (executor IN ('extension', 'hosted-browser')),
  executor_version text NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz
);

CREATE TABLE run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('run.queued', 'run.claimed', 'run.heartbeat', 'run.checkpointed', 'run.cancel_requested', 'run.completed', 'run.paused', 'run.failed', 'run.cancelled', 'artifact.created')),
  step_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id uuid,
  retention_class text NOT NULL CHECK (retention_class IN ('debug', 'workflow-output', 'publication-evidence', 'pinned')),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 240),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 3 AND 120),
  byte_size bigint NOT NULL CHECK (byte_size >= 0 AND byte_size <= 1073741824),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  storage_key text NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 500),
  expires_at timestamptz,
  pinned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, storage_key)
);

CREATE TABLE workflow_test_evidence (
  run_id uuid PRIMARY KEY REFERENCES workflow_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL,
  workflow_version integer NOT NULL,
  workflow_checksum text NOT NULL CHECK (workflow_checksum ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_versions(workflow_id, version)
);

CREATE INDEX workflow_step_runs_timeline_idx ON workflow_step_runs (tenant_id, run_id, sequence);
CREATE INDEX run_events_timeline_idx ON run_events (tenant_id, run_id, created_at, id);
CREATE INDEX workflow_artifacts_run_idx ON workflow_artifacts (tenant_id, run_id, created_at);
CREATE INDEX workflow_artifacts_cleanup_idx ON workflow_artifacts (expires_at) WHERE expires_at IS NOT NULL AND pinned_at IS NULL;
CREATE INDEX workflow_test_evidence_gate_idx ON workflow_test_evidence (tenant_id, workflow_id, workflow_version, workflow_checksum);

ALTER TABLE workflow_step_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_step_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE executor_leases ENABLE ROW LEVEL SECURITY; ALTER TABLE executor_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE run_events ENABLE ROW LEVEL SECURITY; ALTER TABLE run_events FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_artifacts ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_test_evidence ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_test_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_step_runs_are_isolated ON workflow_step_runs USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY executor_leases_are_isolated ON executor_leases USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY run_events_are_isolated ON run_events USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY workflow_artifacts_are_isolated ON workflow_artifacts USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY workflow_test_evidence_is_isolated ON workflow_test_evidence USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_step_runs, executor_leases, run_events, workflow_artifacts, workflow_test_evidence TO doonce_app';
  END IF;
END;
$$;
