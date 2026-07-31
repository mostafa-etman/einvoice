-- Tenant-scoped RLS. GUCs: app.tenant_id, app.user_id (SET LOCAL via set_config(..., true))

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_branches ON branches;
CREATE POLICY tenant_isolation_branches ON branches
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_roles ON roles;
CREATE POLICY tenant_isolation_roles ON roles
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.tenant_id = roles.tenant_id
        AND m.user_id::text = NULLIF(current_setting('app.user_id', true), '')
    )
  )
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_role_permissions ON role_permissions;
CREATE POLICY tenant_isolation_role_permissions ON role_permissions
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_memberships ON memberships;
CREATE POLICY tenant_isolation_memberships ON memberships
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR (
      NULLIF(current_setting('app.tenant_id', true), '') IS NULL
      AND user_id::text = NULLIF(current_setting('app.user_id', true), '')
    )
  )
  WITH CHECK (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
  );

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  USING (
    tenant_id IS NULL
    OR tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
  );

ALTER TABLE tenant_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_currencies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_currencies ON tenant_currencies;
CREATE POLICY tenant_isolation_tenant_currencies ON tenant_currencies
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_exchange_rates ON exchange_rates;
CREATE POLICY tenant_isolation_exchange_rates ON exchange_rates
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE tenant_eta_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_eta_credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_eta_credentials ON tenant_eta_credentials;
CREATE POLICY tenant_isolation_tenant_eta_credentials ON tenant_eta_credentials
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE item_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_item_codes ON item_codes;
CREATE POLICY tenant_isolation_item_codes ON item_codes
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE item_code_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_code_sync_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_item_code_sync_runs ON item_code_sync_runs;
CREATE POLICY tenant_isolation_item_code_sync_runs ON item_code_sync_runs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_documents ON documents;
CREATE POLICY tenant_isolation_documents ON documents
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_lines ON document_lines;
CREATE POLICY tenant_isolation_document_lines ON document_lines
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_line_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_line_taxes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_line_taxes ON document_line_taxes;
CREATE POLICY tenant_isolation_document_line_taxes ON document_line_taxes
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pairing_codes ON pairing_codes;
CREATE POLICY tenant_isolation_pairing_codes ON pairing_codes
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE signing_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_signing_devices ON signing_devices;
CREATE POLICY tenant_isolation_signing_devices ON signing_devices
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE signature_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_signature_jobs ON signature_jobs;
CREATE POLICY tenant_isolation_signature_jobs ON signature_jobs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_submissions ON submissions;
CREATE POLICY tenant_isolation_submissions ON submissions
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE submission_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_submission_documents ON submission_documents;
CREATE POLICY tenant_isolation_submission_documents ON submission_documents
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_filing_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_filing_locks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_filing_locks ON document_filing_locks;
CREATE POLICY tenant_isolation_document_filing_locks ON document_filing_locks
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_status_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_status_events ON document_status_events;
CREATE POLICY tenant_isolation_document_status_events ON document_status_events
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE authority_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_authority_notifications ON authority_notifications;
CREATE POLICY tenant_isolation_authority_notifications ON authority_notifications
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_artifacts ON document_artifacts;
CREATE POLICY tenant_isolation_document_artifacts ON document_artifacts
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE submission_trigger_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_trigger_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_submission_trigger_settings ON submission_trigger_settings;
CREATE POLICY tenant_isolation_submission_trigger_settings ON submission_trigger_settings
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE received_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE received_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_received_documents ON received_documents;
CREATE POLICY tenant_isolation_received_documents ON received_documents
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE received_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE received_document_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_received_document_lines ON received_document_lines;
CREATE POLICY tenant_isolation_received_document_lines ON received_document_lines
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE received_document_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE received_document_sync_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_received_document_sync_runs ON received_document_sync_runs;
CREATE POLICY tenant_isolation_received_document_sync_runs ON received_document_sync_runs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_import_jobs ON import_jobs;
CREATE POLICY tenant_isolation_import_jobs ON import_jobs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE import_row_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_row_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_import_row_results ON import_row_results;
CREATE POLICY tenant_isolation_import_row_results ON import_row_results
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_export_jobs ON export_jobs;
CREATE POLICY tenant_isolation_export_jobs ON export_jobs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE eta_package_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE eta_package_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_eta_package_requests ON eta_package_requests;
CREATE POLICY tenant_isolation_eta_package_requests ON eta_package_requests
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
