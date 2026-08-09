CREATE TABLE beta_workflow_enrollments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  task_category text NOT NULL CHECK (task_category IN (
    'report-download', 'filter-export', 'structured-form-entry',
    'table-extraction', 'copy-fields', 'bounded-condition'
  )),
  baseline_duration_seconds integer NOT NULL CHECK (baseline_duration_seconds BETWEEN 1 AND 86400),
  baseline_error_rate_percent numeric(5,2) NOT NULL CHECK (baseline_error_rate_percent BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'paused', 'graduated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workflow_id)
);

CREATE TABLE beta_run_observations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES beta_workflow_enrollments(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('first-test', 'first-production', 'repeat-production')),
  developer_intervened boolean NOT NULL,
  observed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, enrollment_id, run_id)
);

CREATE TABLE beta_failure_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES beta_workflow_enrollments(id) ON DELETE CASCADE,
  run_id uuid REFERENCES workflow_runs(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN (
    'compiler-problem', 'locator-problem', 'editor-confusion',
    'executor-limitation', 'website-incompatibility',
    'verification-gap', 'infrastructure-problem'
  )),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  classified_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX beta_enrollments_status_idx ON beta_workflow_enrollments (tenant_id, status, updated_at DESC);
CREATE INDEX beta_observations_enrollment_idx ON beta_run_observations (tenant_id, enrollment_id, created_at DESC);
CREATE INDEX beta_failures_category_idx ON beta_failure_events (tenant_id, category, created_at DESC);

ALTER TABLE beta_workflow_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE beta_workflow_enrollments FORCE ROW LEVEL SECURITY;
ALTER TABLE beta_run_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE beta_run_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE beta_failure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE beta_failure_events FORCE ROW LEVEL SECURITY;

CREATE POLICY beta_workflow_enrollments_are_isolated ON beta_workflow_enrollments
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY beta_run_observations_are_isolated ON beta_run_observations
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY beta_failure_events_are_isolated ON beta_failure_events
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON beta_workflow_enrollments, beta_run_observations, beta_failure_events TO doonce_app';
  END IF;
END;
$$;
