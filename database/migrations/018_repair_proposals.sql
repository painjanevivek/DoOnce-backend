CREATE TABLE repair_proposals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  base_version integer NOT NULL CHECK (base_version > 0),
  base_checksum text NOT NULL CHECK (base_checksum ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  failure_category text NOT NULL CHECK (failure_category IN ('locator-not-found', 'locator-ambiguous', 'unexpected-page', 'navigation-timeout', 'assertion-failed', 'download-failed', 'authentication-required', 'executor-disconnected', 'unsupported-capability', 'user-input-required', 'unknown-internal-error')),
  cause_summary text NOT NULL CHECK (char_length(cause_summary) BETWEEN 1 AND 1000),
  failed_step_id uuid NOT NULL,
  old_step jsonb NOT NULL CHECK (jsonb_typeof(old_step) = 'object'),
  proposed_step jsonb NOT NULL CHECK (jsonb_typeof(proposed_step) = 'object'),
  changed_fields jsonb NOT NULL CHECK (jsonb_typeof(changed_fields) = 'array'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  required_test_plan jsonb NOT NULL CHECK (jsonb_typeof(required_test_plan) = 'array'),
  protocol_proposal jsonb NOT NULL CHECK (jsonb_typeof(protocol_proposal) = 'object'),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 200),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 200),
  created_by uuid NOT NULL REFERENCES users(id),
  accepted_draft_version integer,
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejected_reason text CHECK (rejected_reason IS NULL OR char_length(rejected_reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, failed_step_id),
  FOREIGN KEY (workflow_id, base_version) REFERENCES workflow_versions(workflow_id, version),
  FOREIGN KEY (workflow_id, accepted_draft_version) REFERENCES workflow_versions(workflow_id, version),
  CHECK ((status = 'accepted' AND accepted_draft_version IS NOT NULL AND accepted_at IS NOT NULL AND rejected_at IS NULL) OR (status = 'rejected' AND rejected_at IS NOT NULL AND accepted_at IS NULL) OR (status = 'pending' AND accepted_at IS NULL AND rejected_at IS NULL))
);

CREATE INDEX repair_proposals_workflow_idx ON repair_proposals (tenant_id, workflow_id, created_at DESC);
CREATE INDEX repair_proposals_effectiveness_idx ON repair_proposals (tenant_id, status, accepted_at) WHERE status = 'accepted';
ALTER TABLE repair_proposals ENABLE ROW LEVEL SECURITY; ALTER TABLE repair_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY repair_proposals_are_isolated ON repair_proposals USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON repair_proposals TO doonce_app';
  END IF;
END;
$$;
