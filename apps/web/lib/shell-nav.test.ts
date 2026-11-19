import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, breadcrumbs, isNavActive } from './shell-nav';

describe('NAV_ITEMS', () => {
  it('follows the menu order of spec §3.3', () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual([
      'home',
      'machines',
      'projects',
      'templates',
      'settings',
    ]);
  });
});

describe('isNavActive', () => {
  const active = (path: string) =>
    NAV_ITEMS.filter((i) => isNavActive(i.key, path)).map((i) => i.key);

  it('marks exactly one item for every built page', () => {
    expect(active('/')).toEqual(['home']);
    expect(active('/makineler')).toEqual(['machines']);
    expect(active('/makineler/abc/dogrulama')).toEqual(['machines']);
    expect(active('/projeler')).toEqual(['projects']);
    expect(active('/projeler/123')).toEqual(['projects']);
    // T247: no "Oluştur" item; the new-project wizard belongs to Projeler.
    expect(active('/projeler/yeni')).toEqual(['projects']);
    expect(active('/projeler/yeni/parcalar')).toEqual(['projects']);
    expect(active('/ayarlar/malzemeler')).toEqual(['settings']);
  });

  it('does not match look-alike prefixes', () => {
    expect(active('/makinelerx')).toEqual([]);
    expect(active('/projeler/yenilik')).toEqual(['projects']);
    expect(active('/bilinmeyen')).toEqual([]);
  });
});

describe('breadcrumbs', () => {
  it('gives the trail with links on all but the last crumb', () => {
    expect(breadcrumbs('/')).toEqual([{ key: 'home' }]);
    expect(breadcrumbs('/makineler')).toEqual([{ key: 'machines' }]);
    expect(breadcrumbs('/makineler/m1/dogrulama')).toEqual([
      { key: 'machines', href: '/makineler' },
      { key: 'verification' },
    ]);
    expect(breadcrumbs('/projeler/yeni')).toEqual([
      { key: 'projects', href: '/projeler' },
      { key: 'newProject' },
    ]);
    expect(breadcrumbs('/projeler/p1')).toEqual([
      { key: 'projects', href: '/projeler' },
      { key: 'project' },
    ]);
  });

  it('gives Ayarlar → Malzemeler (T121)', () => {
    expect(breadcrumbs('/ayarlar/malzemeler')).toEqual([
      { key: 'settings', href: '/ayarlar/malzemeler' },
      { key: 'materials' },
    ]);
  });

  it('ignores a trailing slash and reports unknown paths as not found', () => {
    expect(breadcrumbs('/projeler/')).toEqual([{ key: 'projects' }]);
    expect(breadcrumbs('/yok/burada')).toEqual([{ key: 'notFound' }]);
    expect(breadcrumbs('/makineler/m1')).toEqual([{ key: 'notFound' }]);
  });
});
