export const PERMISSIONS = {
  TENANT_MANAGE: 'tenant.manage',
  MEMBERS_VIEW: 'members.view',
  MEMBERS_MANAGE: 'members.manage',
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',
  BRANCHES_VIEW: 'branches.view',
  BRANCHES_MANAGE: 'branches.manage',
  AUDIT_VIEW: 'audit.view',
  BILLING_VIEW: 'billing.view',
  BILLING_MANAGE: 'billing.manage',
  SETTINGS_CURRENCIES_VIEW: 'settings.currencies.view',
  SETTINGS_CURRENCIES_MANAGE: 'settings.currencies.manage',
  SETTINGS_ETA_VIEW: 'settings.eta.view',
  SETTINGS_ETA_MANAGE: 'settings.eta.manage',
  SETTINGS_ITEM_CODES_VIEW: 'settings.item_codes.view',
  SETTINGS_ITEM_CODES_MANAGE: 'settings.item_codes.manage',
  SETTINGS_NUMBERING_VIEW: 'settings.numbering.view',
  SETTINGS_NUMBERING_MANAGE: 'settings.numbering.manage',
  SETTINGS_COMPANY_VIEW: 'settings.company.view',
  SETTINGS_COMPANY_MANAGE: 'settings.company.manage',
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_MANAGE: 'customers.manage',
  DOCUMENTS_VIEW: 'documents.view',
  DOCUMENTS_MANAGE: 'documents.manage',
  PURCHASES_VIEW: 'purchases.view',
  PURCHASES_MANAGE: 'purchases.manage',
  DEVICES_VIEW: 'devices.view',
  DEVICES_MANAGE: 'devices.manage',
  ANALYTICS_VIEW: 'analytics.view',
  ANALYTICS_EXPORT: 'analytics.export',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  BACKUP_CREATE: 'backup.create',
  BACKUP_SCHEDULE: 'backup.schedule',
  BACKUP_DOWNLOAD: 'backup.download',
  BACKUP_EXPORT: 'backup.export',
  BACKUP_RESTORE: 'backup.restore',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_CODES = Object.values(PERMISSIONS) as PermissionCode[];

export const DEFAULT_ROLE_NAMES = ['Owner', 'Admin', 'Accountant', 'Viewer'] as const;

export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

export const SYSTEM_OWNER_NAME: DefaultRoleName = 'Owner';

/** Permissions the system Owner role must always keep (lockout prevention). */
export const OWNER_PROTECTED_PERMISSIONS: PermissionCode[] = [
  PERMISSIONS.ROLES_MANAGE,
  PERMISSIONS.TENANT_MANAGE,
];

export type PermissionGroupId =
  | 'documents'
  | 'purchases'
  | 'customers'
  | 'reports'
  | 'analytics'
  | 'settings'
  | 'billing'
  | 'users'
  | 'roles'
  | 'devices'
  | 'backup'
  | 'company';

export const PERMISSION_GROUPS: ReadonlyArray<{
  id: PermissionGroupId;
  codes: PermissionCode[];
}> = [
  {
    id: 'documents',
    codes: [PERMISSIONS.DOCUMENTS_VIEW, PERMISSIONS.DOCUMENTS_MANAGE],
  },
  {
    id: 'purchases',
    codes: [PERMISSIONS.PURCHASES_VIEW, PERMISSIONS.PURCHASES_MANAGE],
  },
  {
    id: 'customers',
    codes: [PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_MANAGE],
  },
  {
    id: 'reports',
    codes: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_EXPORT],
  },
  {
    id: 'analytics',
    codes: [PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.ANALYTICS_EXPORT],
  },
  {
    id: 'settings',
    codes: [
      PERMISSIONS.SETTINGS_COMPANY_VIEW,
      PERMISSIONS.SETTINGS_COMPANY_MANAGE,
      PERMISSIONS.SETTINGS_CURRENCIES_VIEW,
      PERMISSIONS.SETTINGS_CURRENCIES_MANAGE,
      PERMISSIONS.SETTINGS_ETA_VIEW,
      PERMISSIONS.SETTINGS_ETA_MANAGE,
      PERMISSIONS.SETTINGS_ITEM_CODES_VIEW,
      PERMISSIONS.SETTINGS_ITEM_CODES_MANAGE,
      PERMISSIONS.SETTINGS_NUMBERING_VIEW,
      PERMISSIONS.SETTINGS_NUMBERING_MANAGE,
    ],
  },
  {
    id: 'billing',
    codes: [PERMISSIONS.BILLING_VIEW, PERMISSIONS.BILLING_MANAGE],
  },
  {
    id: 'users',
    codes: [PERMISSIONS.MEMBERS_VIEW, PERMISSIONS.MEMBERS_MANAGE],
  },
  {
    id: 'roles',
    codes: [PERMISSIONS.ROLES_VIEW, PERMISSIONS.ROLES_MANAGE],
  },
  {
    id: 'devices',
    codes: [PERMISSIONS.DEVICES_VIEW, PERMISSIONS.DEVICES_MANAGE],
  },
  {
    id: 'backup',
    codes: [
      PERMISSIONS.BACKUP_CREATE,
      PERMISSIONS.BACKUP_SCHEDULE,
      PERMISSIONS.BACKUP_DOWNLOAD,
      PERMISSIONS.BACKUP_EXPORT,
      PERMISSIONS.BACKUP_RESTORE,
    ],
  },
  {
    id: 'company',
    codes: [
      PERMISSIONS.TENANT_MANAGE,
      PERMISSIONS.BRANCHES_VIEW,
      PERMISSIONS.BRANCHES_MANAGE,
      PERMISSIONS.AUDIT_VIEW,
    ],
  },
];

export const ROLE_PERMISSION_MATRIX: Record<DefaultRoleName, PermissionCode[]> = {
  Owner: [...ALL_PERMISSION_CODES],
  // New catalog codes land on Admin automatically except tenant.manage.
  Admin: ALL_PERMISSION_CODES.filter((code) => code !== PERMISSIONS.TENANT_MANAGE),
  Accountant: [
    PERMISSIONS.MEMBERS_VIEW,
    PERMISSIONS.BRANCHES_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.SETTINGS_CURRENCIES_VIEW,
    PERMISSIONS.SETTINGS_ITEM_CODES_VIEW,
    PERMISSIONS.SETTINGS_NUMBERING_VIEW,
    PERMISSIONS.SETTINGS_COMPANY_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.DOCUMENTS_VIEW,
    PERMISSIONS.DOCUMENTS_MANAGE,
    PERMISSIONS.PURCHASES_VIEW,
    PERMISSIONS.PURCHASES_MANAGE,
    PERMISSIONS.DEVICES_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
  ],
  Viewer: [
    PERMISSIONS.MEMBERS_VIEW,
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.BRANCHES_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.DOCUMENTS_VIEW,
    PERMISSIONS.PURCHASES_VIEW,
  ],
};

export function isReservedRoleName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return DEFAULT_ROLE_NAMES.some((n) => n.toLowerCase() === normalized);
}

export function isSystemOwnerRole(role: { name: string; isSystem: boolean }): boolean {
  return role.isSystem && role.name === SYSTEM_OWNER_NAME;
}
