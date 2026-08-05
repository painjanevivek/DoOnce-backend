CREATE TABLE workflow_run_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version integer NOT NULL CHECK (workflow_version > 0),
  actor_id uuid NOT NULL REFERENCES users(id),
  outcome text NOT NULL CHECK (outcome IN ('completed', 'paused', 'failed', 'cancelled')),
  pause_reason text,
  step_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_versions(workflow_id, version),
  CHECK ((outcome = 'paused') = (pause_reason IS NOT NULL))
);

CREATE INDEX workflow_run_receipts_tenant_workflow_finished_at_idx
  ON workflow_run_receipts (tenant_id, workflow_id, finished_at DESC);

ALTER TABLE workflow_run_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_run_receipts_are_isolated ON workflow_run_receipts
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE TRIGGER workflow_run_receipts_are_immutable
  BEFORE UPDATE OR DELETE ON workflow_run_receipts
  FOR EACH ROW EXECUTE FUNCTION app.prevent_workflow_audit_event_mutation();
