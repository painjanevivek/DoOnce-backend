CREATE TABLE signup_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 320),
  role text NOT NULL CHECK (role IN ('owner', 'builder', 'runner', 'reviewer')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_by text NOT NULL CHECK (char_length(issued_by) BETWEEN 1 AND 120),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL AND consumed_by IS NULL AND tenant_id IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL AND tenant_id IS NOT NULL))
);

CREATE TABLE signup_invitation_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES signup_invitations(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'consumed')),
  actor text NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 320),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX signup_invitations_email_status_idx
  ON signup_invitations (email, consumed_at, expires_at DESC);
CREATE INDEX signup_invitation_audit_actor_idx
  ON signup_invitation_audit_events (actor, created_at DESC);

ALTER TABLE signup_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY signup_invitations_require_token_context ON signup_invitations
  USING (token_hash = NULLIF(current_setting('app.invitation_token_hash', true), ''))
  WITH CHECK (token_hash = NULLIF(current_setting('app.invitation_token_hash', true), ''));

REVOKE ALL ON signup_invitations, signup_invitation_audit_events FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, UPDATE ON signup_invitations TO doonce_app';
    EXECUTE 'GRANT INSERT ON signup_invitation_audit_events TO doonce_app';
  END IF;
END;
$$;
