CREATE TABLE capture_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('recording', 'finalized', 'discarded')),
  approved_origins text[] NOT NULL DEFAULT '{}',
  accepted_through integer NOT NULL DEFAULT -1 CHECK (accepted_through >= -1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);

CREATE TABLE capture_actions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  action jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_id, sequence)
);

CREATE TABLE capture_batches (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  cursor integer NOT NULL CHECK (cursor >= -1),
  accepted_through integer NOT NULL CHECK (accepted_through >= -1),
  status text NOT NULL CHECK (status IN ('accepted', 'duplicate', 'finalized')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id, batch_id)
);

CREATE TABLE capture_pairing_codes (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE CHECK (char_length(code_hash) = 64),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE capture_extension_tokens (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, user_id, token_hash)
);

CREATE INDEX capture_actions_timeline_idx ON capture_actions (tenant_id, session_id, sequence);

ALTER TABLE capture_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE capture_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE capture_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY capture_sessions_tenant_policy ON capture_sessions USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY capture_actions_tenant_policy ON capture_actions USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY capture_batches_tenant_policy ON capture_batches USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
