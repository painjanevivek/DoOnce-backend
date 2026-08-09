ALTER TABLE workflow_versions
  ADD COLUMN compiler_version text,
  ADD COLUMN source_capture_session_id uuid REFERENCES capture_sessions(id),
  ADD COLUMN compilation_metadata jsonb;

ALTER TABLE workflow_versions
  ADD CONSTRAINT workflow_versions_compiler_version_check CHECK (compiler_version IS NULL OR compiler_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  ADD CONSTRAINT workflow_versions_compilation_metadata_check CHECK (compilation_metadata IS NULL OR jsonb_typeof(compilation_metadata) = 'object'),
  ADD CONSTRAINT workflow_versions_compilation_fields_check CHECK (
    (compiler_version IS NULL AND source_capture_session_id IS NULL AND compilation_metadata IS NULL)
    OR (compiler_version IS NOT NULL AND source_capture_session_id IS NOT NULL AND compilation_metadata IS NOT NULL)
  );

CREATE INDEX workflow_versions_capture_source_idx ON workflow_versions (tenant_id, source_capture_session_id) WHERE source_capture_session_id IS NOT NULL;

ALTER TABLE capture_sessions ADD CONSTRAINT capture_sessions_origin_bound_check CHECK (cardinality(approved_origins) <= 20);
ALTER TABLE capture_actions ADD CONSTRAINT capture_actions_sequence_bound_check CHECK (sequence <= 999);
