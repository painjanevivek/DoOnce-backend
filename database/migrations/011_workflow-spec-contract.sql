ALTER TABLE workflow_versions
  ADD COLUMN schema_version smallint NOT NULL DEFAULT 0,
  ADD COLUMN source text NOT NULL DEFAULT 'legacy-v0',
  ADD COLUMN definition_checksum text GENERATED ALWAYS AS (encode(digest(definition::text, 'sha256'), 'hex')) STORED;

ALTER TABLE workflow_versions
  ADD CONSTRAINT workflow_versions_schema_version_check CHECK (schema_version IN (0, 1)),
  ADD CONSTRAINT workflow_versions_source_check CHECK (char_length(source) BETWEEN 1 AND 64),
  ADD CONSTRAINT workflow_versions_definition_checksum_check CHECK (char_length(definition_checksum) = 64);

CREATE INDEX workflow_versions_checksum_idx ON workflow_versions (tenant_id, workflow_id, definition_checksum);
