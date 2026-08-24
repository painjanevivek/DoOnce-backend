DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON capture_sessions TO doonce_app';
    EXECUTE 'GRANT SELECT, INSERT ON capture_actions, capture_batches TO doonce_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON capture_pairing_codes TO doonce_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON capture_extension_tokens TO doonce_app';
  END IF;
END;
$$;
