-- Application DB role must NOT be superuser and must NOT bypass RLS.
-- POSTGRES_USER (einvoice) remains the migration/admin role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'einvoice_app') THEN
    CREATE ROLE einvoice_app LOGIN PASSWORD 'einvoice_app'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE einvoice TO einvoice_app;
GRANT USAGE ON SCHEMA public TO einvoice_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
ALTER DEFAULT PRIVILEGES FOR ROLE einvoice IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO einvoice_app;
ALTER DEFAULT PRIVILEGES FOR ROLE einvoice IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO einvoice_app;
