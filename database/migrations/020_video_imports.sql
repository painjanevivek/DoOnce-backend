CREATE TABLE video_imports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  mode text NOT NULL CHECK (mode IN ('video-with-telemetry', 'pure-video')),
  capture_session_id uuid REFERENCES capture_sessions(id),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('video/mp4', 'video/webm', 'video/quicktime')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 524288000),
  uploaded_bytes bigint NOT NULL DEFAULT 0 CHECK (uploaded_bytes >= 0 AND uploaded_bytes <= byte_size),
  checksum_sha256 text CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'uploaded', 'analyzing', 'needs-input', 'needs-calibration', 'ready', 'completed', 'failed', 'cancelled')),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 1 AND 3600000),
  width integer CHECK (width IS NULL OR width BETWEEN 1 AND 16384),
  height integer CHECK (height IS NULL OR height BETWEEN 1 AND 16384),
  frame_rate numeric CHECK (frame_rate IS NULL OR frame_rate > 0 AND frame_rate <= 240),
  timeline jsonb CHECK (timeline IS NULL OR jsonb_typeof(timeline) = 'object'),
  workflow_id uuid REFERENCES workflows(id),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 120),
  retention_until timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX video_imports_recent_idx ON video_imports (tenant_id, created_at DESC);
CREATE INDEX video_imports_retention_idx ON video_imports (retention_until) WHERE status IN ('completed', 'failed', 'cancelled');
ALTER TABLE video_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY video_imports_are_isolated ON video_imports USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON video_imports TO doonce_app';
  END IF;
END;
$$;
