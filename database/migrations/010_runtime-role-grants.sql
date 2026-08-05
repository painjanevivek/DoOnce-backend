DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doonce_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA app TO doonce_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO doonce_app';
  END IF;
END;
$$;
