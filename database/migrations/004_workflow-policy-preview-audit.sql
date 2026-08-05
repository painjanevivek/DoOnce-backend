ALTER TABLE workflow_audit_events
  DROP CONSTRAINT IF EXISTS workflow_audit_events_event_type_check;

ALTER TABLE workflow_audit_events
  ADD CONSTRAINT workflow_audit_events_event_type_check
  CHECK (event_type IN ('workflow.draft_created', 'workflow.policy_previewed', 'workflow.published'));
