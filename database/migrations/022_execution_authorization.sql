DROP FUNCTION IF EXISTS app.resolve_webhook_endpoint(uuid);

CREATE OR REPLACE FUNCTION app.resolve_webhook_endpoint(endpoint_id uuid)
RETURNS TABLE (
  id uuid, tenant_id uuid, workflow_id uuid, session_profile_id uuid,
  signing_secret_reference text, enabled boolean, created_by uuid,
  created_by_email text, created_by_role text, created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT endpoints.id, endpoints.tenant_id, endpoints.workflow_id, endpoints.session_profile_id,
    endpoints.signing_secret_reference, endpoints.enabled, endpoints.created_by,
    users.email, memberships.role, endpoints.created_at
  FROM public.workflow_webhook_endpoints endpoints
  JOIN public.users users ON users.id = endpoints.created_by
  JOIN public.memberships memberships ON memberships.tenant_id = endpoints.tenant_id
    AND memberships.user_id = endpoints.created_by AND memberships.role IN ('owner', 'builder')
  JOIN public.browser_session_profiles profiles ON profiles.id = endpoints.session_profile_id
    AND profiles.tenant_id = endpoints.tenant_id AND profiles.created_by = endpoints.created_by
    AND profiles.location = 'managed' AND profiles.enabled = true
  JOIN public.workflow_versions versions ON versions.workflow_id = endpoints.workflow_id
    AND versions.status = 'active'
  WHERE endpoints.id = endpoint_id AND endpoints.enabled = true
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.resolve_webhook_endpoint(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION app.resolve_webhook_endpoint(uuid) TO doonce_app';
  END IF;
END;
$$;
