ALTER TABLE support_reports
  ADD COLUMN diagnostic jsonb;

ALTER TABLE support_reports
  ADD CONSTRAINT support_reports_diagnostic_is_object
  CHECK (diagnostic IS NULL OR jsonb_typeof(diagnostic) = 'object');
