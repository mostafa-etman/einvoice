-- Tenant-scoped RLS. GUCs: app.tenant_id, app.user_id (SET LOCAL via set_config(..., true))
--
-- Intentionally NOT RLS-protected (global / shared / identity):
--   users              — global login identity; tenant membership is via memberships
--   tenants            — root registry (access mediated by memberships + app checks)
--   permissions, plans — platform catalogs
--   currencies, eta_code_catalogs, eta_code_entries — shared ETA reference data
--   refresh_sessions, billing_webhook_events — non-tenant or provider-scoped

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

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_customers ON customers;
CREATE POLICY tenant_isolation_customers ON customers
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

ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_sync_conflicts ON sync_conflicts;
CREATE POLICY tenant_isolation_sync_conflicts ON sync_conflicts
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_usage_events ON usage_events;
CREATE POLICY tenant_isolation_usage_events ON usage_events
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE usage_daily_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily_rollups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_usage_daily_rollups ON usage_daily_rollups;
CREATE POLICY tenant_isolation_usage_daily_rollups ON usage_daily_rollups
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE usage_monthly_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_monthly_rollups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_usage_monthly_rollups ON usage_monthly_rollups;
CREATE POLICY tenant_isolation_usage_monthly_rollups ON usage_monthly_rollups
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE usage_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_usage_export_jobs ON usage_export_jobs;
CREATE POLICY tenant_isolation_usage_export_jobs ON usage_export_jobs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE tenant_backup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_backup_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_backup_jobs ON tenant_backup_jobs;
CREATE POLICY tenant_isolation_tenant_backup_jobs ON tenant_backup_jobs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE tenant_backup_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_backup_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_backup_schedules ON tenant_backup_schedules;
CREATE POLICY tenant_isolation_tenant_backup_schedules ON tenant_backup_schedules
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE tenant_restore_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_restore_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_restore_jobs ON tenant_restore_jobs;
CREATE POLICY tenant_isolation_tenant_restore_jobs ON tenant_restore_jobs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE tenant_data_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data_export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_data_export_jobs ON tenant_data_export_jobs;
CREATE POLICY tenant_isolation_tenant_data_export_jobs ON tenant_data_export_jobs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- SaaS layer (013)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_subscriptions ON subscriptions;
CREATE POLICY tenant_isolation_subscriptions ON subscriptions
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE quota_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE quota_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_quota_overrides ON quota_overrides;
CREATE POLICY tenant_isolation_quota_overrides ON quota_overrides
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE payment_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_payment_customers ON payment_customers;
CREATE POLICY tenant_isolation_payment_customers ON payment_customers
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE invoice_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_refs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_invoice_refs ON invoice_refs;
CREATE POLICY tenant_isolation_invoice_refs ON invoice_refs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_email_outbox ON email_outbox;
CREATE POLICY tenant_isolation_email_outbox ON email_outbox
  USING (
    tenant_id IS NULL
    OR tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
  );

ALTER TABLE tenant_invoice_numbering ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invoice_numbering FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_invoice_numbering ON tenant_invoice_numbering;
CREATE POLICY tenant_isolation_tenant_invoice_numbering ON tenant_invoice_numbering
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_number_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_number_sequences ON document_number_sequences;
CREATE POLICY tenant_isolation_document_number_sequences ON document_number_sequences
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- Platform-operator sessions: tenant-scoped reads under app.tenant_id; platform
-- sweeps set app.platform_operator=1 (never from tenant HTTP handlers).
ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_impersonation_sessions ON impersonation_sessions;
CREATE POLICY tenant_isolation_impersonation_sessions ON impersonation_sessions
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR NULLIF(current_setting('app.platform_operator', true), '') = '1'
  )
  WITH CHECK (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR NULLIF(current_setting('app.platform_operator', true), '') = '1'
  );
