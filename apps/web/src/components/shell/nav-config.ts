export type NavIcon =
  | 'home'
  | 'documents'
  | 'customers'
  | 'sync'
  | 'analytics'
  | 'reports'
  | 'backup'
  | 'billing'
  | 'purchases'
  | 'imports'
  | 'exports'
  | 'devices'
  | 'users'
  | 'roles'
  | 'settings';

export type NavItemId = NavIcon;
export type NavSectionId = 'sales' | 'operations' | 'insights';

export type NavItem = {
  id: NavItemId;
  icon: NavIcon;
  href: string;
  labelKey: `nav.${NavItemId}`;
};

export type NavGroup = {
  id: NavSectionId;
  titleKey: `nav.sections.${NavSectionId}`;
  items: NavItem[];
};

const PATH: Record<NavItemId, string | null> = {
  home: null,
  documents: 'documents',
  customers: 'customers',
  purchases: 'purchases',
  imports: 'imports',
  sync: 'sync',
  exports: 'exports',
  analytics: 'analytics',
  reports: 'reports',
  billing: 'billing',
  devices: 'devices',
  backup: 'backup',
  users: 'users',
  roles: 'roles',
  settings: 'settings',
};

export function navHref(locale: string, id: NavItemId): string {
  const segment = PATH[id];
  return segment ? `/${locale}/${segment}` : `/${locale}`;
}

export function isNavActive(pathname: string, href: string, locale: string): boolean {
  const home = `/${locale}`;
  if (href === home) return pathname === home || pathname === `${home}/`;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Demo grouping (Sales / Operations / Insights & admin), with every existing route kept. */
const GROUP_ITEMS: Record<NavSectionId, NavItemId[]> = {
  sales: ['home', 'documents', 'customers'],
  operations: ['purchases', 'imports', 'exports', 'sync', 'devices', 'backup'],
  insights: ['analytics', 'reports', 'billing', 'users', 'roles', 'settings'],
};

export function buildNavGroups(locale: string): NavGroup[] {
  return (Object.keys(GROUP_ITEMS) as NavSectionId[]).map((id) => ({
    id,
    titleKey: `nav.sections.${id}`,
    items: GROUP_ITEMS[id].map((itemId) => ({
      id: itemId,
      icon: itemId,
      href: navHref(locale, itemId),
      labelKey: `nav.${itemId}`,
    })),
  }));
}

export function flattenNav(locale: string): NavItem[] {
  return buildNavGroups(locale).flatMap((group) => group.items);
}
