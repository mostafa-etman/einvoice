/** Locale-stripped app screens a tenant admin can leave feedback on. */
export const APP_SCREEN_KEYS = [
  'home',
  'documents',
  'documents.detail',
  'receipts',
  'customers',
  'purchases',
  'purchases.detail',
  'imports',
  'exports',
  'sync',
  'sync.conflict',
  'devices',
  'backup',
  'analytics',
  'reports',
  'reports.detail',
  'billing',
  'users',
  'roles',
  'settings',
  'settings.company',
  'settings.branches',
  'settings.pos-devices',
  'settings.item-codes',
  'settings.eta-credentials',
  'settings.eta-document-types',
  'settings.currencies',
  'settings.invoice-numbering',
  'companies.new',
  'other',
] as const;

export type AppScreenKey = (typeof APP_SCREEN_KEYS)[number];

type ScreenMatch = {
  key: AppScreenKey;
  /** Locale-stripped path prefix. Longest match wins. */
  pathPrefix: string;
};

const SCREEN_MATCHES: ScreenMatch[] = [
  { key: 'settings.pos-devices', pathPrefix: '/settings/pos-devices' },
  { key: 'settings.eta-document-types', pathPrefix: '/settings/eta-document-types' },
  { key: 'settings.invoice-numbering', pathPrefix: '/settings/invoice-numbering' },
  { key: 'settings.eta-credentials', pathPrefix: '/settings/eta-credentials' },
  { key: 'settings.item-codes', pathPrefix: '/settings/item-codes' },
  { key: 'settings.currencies', pathPrefix: '/settings/currencies' },
  { key: 'settings.company', pathPrefix: '/settings/company' },
  { key: 'settings.branches', pathPrefix: '/settings/branches' },
  { key: 'companies.new', pathPrefix: '/companies/new' },
  { key: 'sync.conflict', pathPrefix: '/sync/conflict' },
  { key: 'documents.detail', pathPrefix: '/documents/' },
  { key: 'receipts', pathPrefix: '/receipts' },
  { key: 'purchases.detail', pathPrefix: '/purchases/' },
  { key: 'reports.detail', pathPrefix: '/reports/' },
  { key: 'documents', pathPrefix: '/documents' },
  { key: 'customers', pathPrefix: '/customers' },
  { key: 'purchases', pathPrefix: '/purchases' },
  { key: 'imports', pathPrefix: '/imports' },
  { key: 'exports', pathPrefix: '/exports' },
  { key: 'devices', pathPrefix: '/devices' },
  { key: 'backup', pathPrefix: '/backup' },
  { key: 'analytics', pathPrefix: '/analytics' },
  { key: 'reports', pathPrefix: '/reports' },
  { key: 'billing', pathPrefix: '/billing' },
  { key: 'users', pathPrefix: '/users' },
  { key: 'roles', pathPrefix: '/roles' },
  { key: 'settings', pathPrefix: '/settings' },
  { key: 'sync', pathPrefix: '/sync' },
  { key: 'home', pathPrefix: '/' },
];

const SCREEN_KEY_SET = new Set<string>(APP_SCREEN_KEYS);

export function isAppScreenKey(value: string): value is AppScreenKey {
  return SCREEN_KEY_SET.has(value);
}

/** Strip `/en` or `/ar` (and optional trailing path) from a Next.js pathname. */
export function stripLocalePrefix(pathname: string): string {
  const trimmed = pathname.trim() || '/';
  const match = trimmed.match(/^\/(en|ar)(?=\/|$)/i);
  if (!match) return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const rest = trimmed.slice(match[0].length);
  return rest.length === 0 ? '/' : rest;
}

export function matchAppScreen(pathname: string): AppScreenKey {
  const path = stripLocalePrefix(pathname);
  for (const screen of SCREEN_MATCHES) {
    if (screen.pathPrefix === '/') {
      if (path === '/') return screen.key;
      continue;
    }
    if (screen.pathPrefix.endsWith('/')) {
      if (path.startsWith(screen.pathPrefix) && path.length > screen.pathPrefix.length) {
        return screen.key;
      }
      continue;
    }
    if (path === screen.pathPrefix || path.startsWith(`${screen.pathPrefix}/`)) {
      return screen.key;
    }
  }
  return 'other';
}
