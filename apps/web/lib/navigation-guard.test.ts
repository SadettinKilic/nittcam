import { describe, expect, it, vi } from 'vitest';
import {
  guardedNavigate,
  leavingLinkHref,
  onNavigationStart,
  setNavigationGuard,
} from './navigation-guard';

describe('navigation guard', () => {
  it('navigates when no guard is set or the guard lets it through', () => {
    const go = vi.fn();
    guardedNavigate('/projeler', go);
    expect(go).toHaveBeenCalledWith('/projeler');
    const off = setNavigationGuard(() => false);
    guardedNavigate('/makineler', go);
    expect(go).toHaveBeenCalledWith('/makineler');
    off();
  });

  it('lets an active guard take over, and only the active guard can be removed', () => {
    const go = vi.fn();
    const seen: string[] = [];
    const offA = setNavigationGuard((href) => (seen.push(href), true));
    guardedNavigate('/projeler', go);
    expect(go).not.toHaveBeenCalled();
    expect(seen).toEqual(['/projeler']);
    const offB = setNavigationGuard(() => true);
    offA(); // stale remover: B stays active
    guardedNavigate('/', go);
    expect(go).not.toHaveBeenCalled();
    offB();
    guardedNavigate('/', go);
    expect(go).toHaveBeenCalledWith('/');
  });
});

describe('navigation start (B49)', () => {
  it('tells listeners about navigations the guard let through, not about taken-over ones', () => {
    const seen: string[] = [];
    const off = onNavigationStart((href) => seen.push(href));
    guardedNavigate('/makineler', () => {});
    const offGuard = setNavigationGuard(() => true);
    guardedNavigate('/projeler', () => {});
    offGuard();
    off();
    guardedNavigate('/', () => {});
    expect(seen).toEqual(['/makineler']);
  });

  const here = {
    href: 'http://app.test/projeler/yeni?adim=parcalar',
    origin: 'http://app.test',
    pathname: '/projeler/yeni',
    search: '?adim=parcalar',
  };
  const anchor = (href: string, attrs: Record<string, string> = {}) => ({
    closest: () => ({
      getAttribute: (k: string) => (k === 'href' ? href : (attrs[k] ?? null)),
      hasAttribute: (k: string) => k in attrs,
    }),
  });
  const click = (target: unknown, mods: Partial<MouseEvent> = {}) => ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: target as EventTarget,
    ...mods,
  });

  it('reads same-tab in-app link clicks that leave the address', () => {
    expect(leavingLinkHref(click(anchor('/makineler')), here)).toBe('/makineler');
    expect(leavingLinkHref(click(anchor('/projeler/yeni')), here)).toBe('/projeler/yeni');
    expect(leavingLinkHref(click(anchor('?adim=parcalar#x')), here)).toBeNull();
    expect(leavingLinkHref(click(anchor('https://example.com/')), here)).toBeNull();
    expect(leavingLinkHref(click(anchor('/makineler', { target: '_blank' })), here)).toBeNull();
    expect(leavingLinkHref(click(anchor('/a.pdf', { download: '' })), here)).toBeNull();
    expect(leavingLinkHref(click(anchor('/makineler'), { ctrlKey: true }), here)).toBeNull();
    expect(leavingLinkHref(click(anchor('/makineler'), { button: 1 }), here)).toBeNull();
    expect(leavingLinkHref(click({ closest: () => null }), here)).toBeNull();
    expect(leavingLinkHref(click(null), here)).toBeNull();
  });
});
