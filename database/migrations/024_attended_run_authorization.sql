ALTER TABLE capture_extension_tokens
  ADD COLUMN extension_version text,
  ADD COLUMN last_seen_at timestamptz;

ALTER TABLE capture_extension_tokens
  ADD CONSTRAINT capture_extension_tokens_version_check
  CHECK (extension_version IS NULL OR extension_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$');

CREATE TABLE capture_origin_consents (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin ~ '^https://[^/]+$' AND char_length(origin) <= 255),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, origin)
);

CREATE TABLE run_approval_challenges (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  workflow_id uuid NOT NULL,
  workflow_version integer NOT NULL CHECK (workflow_version > 0),
  workflow_checksum text NOT NULL CHECK (workflow_checksum ~ '^[a-f0-9]{64}$'),
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  exact_origin text NOT NULL CHECK (exact_origin ~ '^https://[^/]+$' AND char_length(exact_origin) <= 255),
  executor text NOT NULL CHECK (executor = 'extension'),
  extension_version text NOT NULL CHECK (extension_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_versions(workflow_id, version)
);

ALTER TABLE workflow_runs
  ADD COLUMN approval_challenge_id uuid REFERENCES run_approval_challenges(id),
  ADD COLUMN approved_extension_version text;

CREATE INDEX capture_origin_consents_active_idx
  ON capture_origin_consents (tenant_id, user_id, origin)
  WHERE revoked_at IS NULL;

CREATE INDEX run_approval_challenges_active_idx
  ON run_approval_challenges (tenant_id, user_id, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE capture_origin_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_origin_consents FORCE ROW LEVEL SECURITY;
ALTER TABLE run_approval_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_approval_challenges FORCE ROW LEVEL SECURITY;

CREATE POLICY capture_origin_consents_are_isolated ON capture_origin_consents
  USING (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id())
  WITH CHECK (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id());

CREATE POLICY run_approval_challenges_are_isolated ON run_approval_challenges
  USING (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id())
  WITH CHECK (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON capture_origin_consents, run_approval_challenges TO doonce_app';
  END IF;
END;
$$;
