CREATE TABLE workflow_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version integer NOT NULL CHECK (workflow_version > 0),
  actor_id uuid NOT NULL REFERENCES users(id),
  event_type text NOT NULL CHECK (event_type IN ('workflow.draft_created', 'workflow.published')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_versions(workflow_id, version)
);

CREATE INDEX workflow_audit_events_tenant_workflow_created_at_idx
  ON workflow_audit_events (tenant_id, workflow_id, created_at DESC);

ALTER TABLE workflow_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_audit_events_are_isolated ON workflow_audit_events
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE OR REPLACE FUNCTION app.prevent_workflow_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workflow audit events are immutable.';
END;
$$;

CREATE TRIGGER workflow_audit_events_are_immutable
  BEFORE UPDATE OR DELETE ON workflow_audit_events
  FOR EACH ROW EXECUTE FUNCTION app.prevent_workflow_audit_event_mutation();
