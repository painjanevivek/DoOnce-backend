ALTER TABLE workflow_runs
  ADD COLUMN release_identity jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_release_identity_object
  CHECK (jsonb_typeof(release_identity) = 'object');
