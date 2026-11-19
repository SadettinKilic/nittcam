// App shell navigation model (T103, spec §3.3): menu items, active state and breadcrumbs.
// Pure: no React, no Next; the shell components map keys to icons and text.

/**
 * Menu keys of spec §3.3. Text lives under `nav` in tr.json. `create` (Oluştur) is not in the
 * menu since T247 (same target as "Yeni proje"); it returns with the AI chat in M11.
 */
export type NavKey = 'home' | 'machines' | 'projects' | 'templates' | 'create' | 'settings';

export interface NavItem {
  key: NavKey;
  /** Missing = not built yet: shown with "yakında", not a link. */
  href?: string;
}

export const NEW_PROJECT_HREF = '/projeler/yeni';

/** Ayarlar has one page so far: the material library (T121). */
export const SETTINGS_HREF = '/ayarlar/malzemeler';

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', href: '/' },
  { key: 'machines', href: '/makineler' },
  { key: 'projects', href: '/projeler' },
  { key: 'templates' },
  { key: 'settings', href: SETTINGS_HREF },
];

/** Is the current page under this menu item? Projeler owns the new-project wizard too (T247). */
export function isNavActive(key: NavKey, pathname: string): boolean {
  switch (key) {
    case 'home':
      return pathname === '/';
    case 'machines':
      return pathname === '/makineler' || pathname.startsWith('/makineler/');
    case 'projects':
      return isUnder(pathname, '/projeler');
    case 'create':
      // Not in the menu (T247); kept for M11.
      return false;
    case 'settings':
      return isUnder(pathname, '/ayarlar');
    default:
      return false;
  }
}

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Label keys of a crumb; the shell turns them into Turkish text. */
export type CrumbKey =
  NavKey | 'newProject' | 'project' | 'verification' | 'materials' | 'notFound';

export interface Crumb {
  key: CrumbKey;
  /** Link target; the last crumb (current page) has none. */
  href?: string;
}

/**
 * Breadcrumb trail for a path. The last crumb is the current page (the top-bar title).
 * Unknown paths give a single "notFound" crumb.
 */
export function breadcrumbs(pathname: string): Crumb[] {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/' || path === '') return [{ key: 'home' }];
  const parts = path.split('/').filter(Boolean);
  const [first, second, third] = parts;
  if (first === 'makineler') {
    if (parts.length === 1) return [{ key: 'machines' }];
    if (parts.length === 3 && third === 'dogrulama') {
      return [{ key: 'machines', href: '/makineler' }, { key: 'verification' }];
    }
  }
  if (first === 'projeler') {
    if (parts.length === 1) return [{ key: 'projects' }];
    if (second === 'yeni') return [{ key: 'projects', href: '/projeler' }, { key: 'newProject' }];
    if (parts.length === 2) return [{ key: 'projects', href: '/projeler' }, { key: 'project' }];
  }
  if (first === 'ayarlar' && second === 'malzemeler' && parts.length === 2) {
    return [{ key: 'settings', href: SETTINGS_HREF }, { key: 'materials' }];
  }
  return [{ key: 'notFound' }];
}
