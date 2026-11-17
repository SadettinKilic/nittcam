import { describe, expect, it } from 'vitest';
import { SIDEBAR_INIT_SCRIPT, SIDEBAR_STORAGE_KEY, parseCollapsed } from './sidebar-state';

describe('sidebar state', () => {
  it('treats only "collapsed" as collapsed', () => {
    expect(parseCollapsed('collapsed')).toBe(true);
    expect(parseCollapsed('expanded')).toBe(false);
    expect(parseCollapsed(null)).toBe(false);
    expect(parseCollapsed('garbage')).toBe(false);
  });

  it('init script sets the attribute from storage and survives blocked storage', () => {
    const attrs = new Map<string, string>();
    const run = (stored: string | null, throws = false) => {
      attrs.clear();
      const localStorage = {
        getItem: (k: string) => {
          if (throws) throw new Error('blocked');
          return k === SIDEBAR_STORAGE_KEY ? stored : null;
        },
      };
      const document = {
        documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) },
      };
      new Function('localStorage', 'document', SIDEBAR_INIT_SCRIPT)(localStorage, document);
      return attrs.get('data-sidebar');
    };
    expect(run('collapsed')).toBe('collapsed');
    expect(run('expanded')).toBeUndefined();
    expect(run(null, true)).toBeUndefined();
  });
});
