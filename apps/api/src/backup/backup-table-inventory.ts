/**
 * Explicit include list for logical DB extract (012).
 * Global catalogs (permissions, currencies, users) are excluded.
 */
export const BACKUP_TABLE_INVENTORY = [
  'documents',
  'document_lines',
  'document_artifacts',
  'tenant_eta_credentials',
  'item_codes',
] as const;

export type BackupTableName = (typeof BACKUP_TABLE_INVENTORY)[number];
