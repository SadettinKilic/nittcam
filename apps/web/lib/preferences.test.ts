import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DENSITY_STORAGE_KEY,
  MOTION_STORAGE_KEY,
  PREFERENCES_INIT_SCRIPT,
  SIMPLE_3D_STORAGE_KEY,
  parseDensity,
  parseMotion,
  parseSimple3d,
  prefersReducedMotion,
  readDensity,
  readMotion,
  readSimple3d,
  setDensity,
  setMotion,
  setSimple3d,
} from './preferences';

/** A minimal <html> element and localStorage, enough for the preference helpers. */
function fakeBrowser(stored: Record<string, string> = {}, osReduce = false) {
  const store = new Map(Object.entries(stored));
  const attrs = new Map<string, string>();
  const root = {
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    removeAttribute: (n: string) => void attrs.delete(n),
  };
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const events: string[] = [];
  const window = {
    localStorage,
    matchMedia: () => ({ matches: osReduce }),
    dispatchEvent: (e: Event) => void events.push(e.type),
  };
  const document = { documentElement: root };
  return { store, attrs, window, document, events };
}

function install(b: ReturnType<typeof fakeBrowser>) {
  vi.stubGlobal('window', b.window);
  vi.stubGlobal('document', b.document);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preferences (T183)', () => {
  it('parses stored values with safe defaults', () => {
    expect(parseDensity('compact')).toBe('compact');
    expect(parseDensity('comfortable')).toBe('comfortable');
    expect(parseDensity(null)).toBe('comfortable');
    expect(parseDensity('huge')).toBe('comfortable');
    expect(parseMotion('reduce')).toBe('reduce');
    expect(parseMotion(undefined)).toBe('system');
    expect(parseMotion('full')).toBe('system');
    expect(parseSimple3d('1')).toBe(true);
    expect(parseSimple3d('0')).toBe(false);
    expect(parseSimple3d(null)).toBe(false);
  });

  it('the init script copies stored density and motion onto <html> before paint', () => {
    const b = fakeBrowser({ [DENSITY_STORAGE_KEY]: 'compact', [MOTION_STORAGE_KEY]: 'reduce' });
    new Function('window', 'document', PREFERENCES_INIT_SCRIPT)(b.window, b.document);
    expect(b.attrs.get('data-density')).toBe('compact');
    expect(b.attrs.get('data-motion')).toBe('reduce');

    const plain = fakeBrowser({ [DENSITY_STORAGE_KEY]: 'comfortable' });
    new Function('window', 'document', PREFERENCES_INIT_SCRIPT)(plain.window, plain.document);
    expect(plain.attrs.size).toBe(0);
  });

  it('the init script survives blocked storage', () => {
    const b = fakeBrowser();
    const blocked = {
      ...b.window,
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    };
    expect(() =>
      new Function('window', 'document', PREFERENCES_INIT_SCRIPT)(blocked, b.document),
    ).not.toThrow();
  });

  it('density: stored, applied on <html> and announced', () => {
    const b = fakeBrowser();
    install(b);
    setDensity('compact');
    expect(b.store.get(DENSITY_STORAGE_KEY)).toBe('compact');
    expect(b.attrs.get('data-density')).toBe('compact');
    expect(readDensity()).toBe('compact');
    setDensity('comfortable');
    expect(b.store.get(DENSITY_STORAGE_KEY)).toBe('comfortable');
    expect(b.attrs.has('data-density')).toBe(false);
    expect(readDensity()).toBe('comfortable');
    expect(b.events).toHaveLength(2);
  });

  it('motion override: "reduce" wins over an OS that allows motion; "system" follows the OS', () => {
    const allow = fakeBrowser({}, false);
    install(allow);
    expect(prefersReducedMotion()).toBe(false);
    setMotion('reduce');
    expect(allow.attrs.get('data-motion')).toBe('reduce');
    expect(readMotion()).toBe('reduce');
    expect(prefersReducedMotion()).toBe(true);
    setMotion('system');
    expect(allow.attrs.has('data-motion')).toBe(false);
    expect(prefersReducedMotion()).toBe(false);

    vi.unstubAllGlobals();
    const os = fakeBrowser({}, true);
    install(os);
    expect(readMotion()).toBe('system');
    expect(prefersReducedMotion()).toBe(true);
  });

  it('3D simple mode shares the preview button key (T154)', () => {
    const b = fakeBrowser({ [SIMPLE_3D_STORAGE_KEY]: '1' });
    install(b);
    expect(SIMPLE_3D_STORAGE_KEY).toBe('nittcam-3d-simple');
    expect(readSimple3d()).toBe(true);
    setSimple3d(false);
    expect(b.store.get(SIMPLE_3D_STORAGE_KEY)).toBe('0');
    expect(readSimple3d()).toBe(false);
  });
});
