ALTER TABLE workflow_audit_events
  DROP CONSTRAINT workflow_audit_events_event_type_check;

ALTER TABLE workflow_audit_events
  ADD CONSTRAINT workflow_audit_events_event_type_check
  CHECK (event_type IN (
    'workflow.draft_created',
    'workflow.draft_edited',
    'workflow.version_draft_created',
    'workflow.policy_previewed',
    'workflow.published',
    'workflow.disabled',
    'workflow.repair_draft_created'
  ));

CREATE INDEX workflow_versions_editor_lookup_idx
  ON workflow_versions (tenant_id, workflow_id, status, schema_version, version DESC);
