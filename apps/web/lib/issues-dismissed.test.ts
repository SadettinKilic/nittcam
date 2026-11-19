import { afterEach, describe, expect, it, vi } from 'vitest';
import { mayAutoOpen, readDismissed, writeDismissed } from './issues-dismissed';

describe('Uyarılar panel memory (T256)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens by itself only when it fits and something is new since the user closed it', () => {
    expect(mayAutoOpen(false, ['A'], null)).toBe(false);
    expect(mayAutoOpen(true, [], null)).toBe(false);
    expect(mayAutoOpen(true, ['A'], null)).toBe(true);
    expect(mayAutoOpen(true, ['A'], ['A', 'B'])).toBe(false);
    expect(mayAutoOpen(true, ['A', 'C'], ['A', 'B'])).toBe(true);
  });

  it('stores per project, survives a reload (same storage), tolerates a broken storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    expect(readDismissed('p1')).toBeNull();
    writeDismissed('p1', ['B', 'A', 'A']);
    expect(readDismissed('p1')).toEqual(['A', 'B']);
    expect(readDismissed('p2')).toBeNull();
    expect(readDismissed(undefined)).toBeNull();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    });
    expect(readDismissed('p1')).toBeNull();
    expect(() => writeDismissed('p1', ['A'])).not.toThrow();
  });
});
