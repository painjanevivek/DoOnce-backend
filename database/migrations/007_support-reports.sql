CREATE TABLE support_reports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id),
  category text NOT NULL CHECK (category IN ('workflow-paused', 'unexpected-result', 'safety-concern', 'other')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_reports_tenant_created_at_idx
  ON support_reports (tenant_id, created_at DESC);

ALTER TABLE support_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY support_reports_are_isolated ON support_reports
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
