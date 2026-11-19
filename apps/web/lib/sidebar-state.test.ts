import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_INIT_SCRIPT,
  SIDEBAR_STORAGE_KEY,
  WORKSPACE_SIDEBAR_STORAGE_KEY,
  isWorkspaceUrl,
  parseCollapsed,
  resolveCollapsed,
} from './sidebar-state';

describe('sidebar state', () => {
  it('treats only "collapsed" as collapsed', () => {
    expect(parseCollapsed('collapsed')).toBe(true);
    expect(parseCollapsed('expanded')).toBe(false);
    expect(parseCollapsed(null)).toBe(false);
    expect(parseCollapsed('garbage')).toBe(false);
  });

  it('knows the workspace steps from the URL (T263)', () => {
    expect(isWorkspaceUrl('/projeler/yeni', '?adim=dizilim')).toBe(true);
    expect(isWorkspaceUrl('/projeler/abc', '?adim=simulasyon')).toBe(true);
    expect(isWorkspaceUrl('/projeler/abc', '?adim=parcalar&gorunum=cizim')).toBe(true);
    expect(isWorkspaceUrl('/projeler/abc', '?adim=parcalar')).toBe(false);
    expect(isWorkspaceUrl('/projeler/abc', '?adim=export')).toBe(false);
    expect(isWorkspaceUrl('/projeler/abc', '')).toBe(false);
    expect(isWorkspaceUrl('/ayarlar/malzemeler', '?adim=dizilim')).toBe(false);
  });

  it('workspace below 1440 opens as the rail; the own toggle wins; elsewhere T103 applies', () => {
    const ws = (width: number) => ({ workspace: true, width });
    expect(resolveCollapsed(ws(1280), null, null)).toBe(true);
    expect(resolveCollapsed(ws(1024), 'expanded', null)).toBe(true);
    expect(resolveCollapsed(ws(1280), null, 'expanded')).toBe(false);
    expect(resolveCollapsed(ws(1280), 'collapsed', 'expanded')).toBe(false);
    expect(resolveCollapsed(ws(1280), null, 'collapsed')).toBe(true);
    // ≥ 1440 and off the workspace: the T103 key, unchanged behaviour.
    expect(resolveCollapsed(ws(1440), null, null)).toBe(false);
    expect(resolveCollapsed(ws(1440), 'collapsed', 'expanded')).toBe(true);
    expect(resolveCollapsed({ workspace: false, width: 1024 }, null, null)).toBe(false);
    expect(resolveCollapsed({ workspace: false, width: 1024 }, 'collapsed', 'expanded')).toBe(true);
  });

  it('init script applies the same rules before hydration and survives blocked storage', () => {
    const attrs = new Map<string, string>();
    const run = (
      stored: Record<string, string | null>,
      opts: { url?: string; width?: number; throws?: boolean } = {},
    ) => {
      attrs.clear();
      const u = new URL(opts.url ?? '/', 'http://x');
      const localStorage = {
        getItem: (k: string) => {
          if (opts.throws) throw new Error('blocked');
          return stored[k] ?? null;
        },
      };
      const document = {
        documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) },
      };
      new Function('localStorage', 'document', 'location', 'innerWidth', SIDEBAR_INIT_SCRIPT)(
        localStorage,
        document,
        { pathname: u.pathname, search: u.search },
        opts.width ?? 1440,
      );
      return attrs.get('data-sidebar');
    };
    expect(run({ [SIDEBAR_STORAGE_KEY]: 'collapsed' })).toBe('collapsed');
    expect(run({ [SIDEBAR_STORAGE_KEY]: 'expanded' })).toBeUndefined();
    expect(run({}, { throws: true })).toBeUndefined();
    const dizilim = '/projeler/p1?adim=dizilim';
    expect(run({}, { url: dizilim, width: 1280 })).toBe('collapsed');
    expect(run({}, { url: dizilim, width: 1440 })).toBeUndefined();
    expect(
      run({ [WORKSPACE_SIDEBAR_STORAGE_KEY]: 'expanded' }, { url: dizilim, width: 1024 }),
    ).toBeUndefined();
    expect(run({}, { url: '/projeler/p1?adim=parcalar', width: 1024 })).toBeUndefined();
    expect(run({}, { url: '/projeler/p1?adim=parcalar&gorunum=cizim', width: 1024 })).toBe(
      'collapsed',
    );
  });
});
