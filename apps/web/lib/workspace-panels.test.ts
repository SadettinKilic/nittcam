import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL_STORAGE_KEY,
  defaultPanelOpen,
  parsePanelState,
  readPanelOpen,
  writePanelOpen,
} from './workspace-panels';

function fakeStorage(throwing = false) {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => {
      if (throwing) throw new Error('blocked');
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (throwing) throw new Error('blocked');
      map.set(k, v);
    },
    map,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('workspace panel state (T241)', () => {
  it('parses only open / closed', () => {
    expect(parsePanelState('open')).toBe(true);
    expect(parsePanelState('closed')).toBe(false);
    expect(parsePanelState(null)).toBeNull();
    expect(parsePanelState('x')).toBeNull();
  });

  it('left starts collapsed below 1280 px, right always open', () => {
    expect(defaultPanelOpen('left', 1024)).toBe(false);
    expect(defaultPanelOpen('left', 1279)).toBe(false);
    expect(defaultPanelOpen('left', 1280)).toBe(true);
    expect(defaultPanelOpen('right', 1024)).toBe(true);
  });

  it('remembers the choice per side', () => {
    const s = fakeStorage();
    vi.stubGlobal('window', { localStorage: s });
    writePanelOpen('left', true);
    expect(s.map.get(PANEL_STORAGE_KEY.left)).toBe('open');
    expect(readPanelOpen('left', 1024)).toBe(true);
    expect(readPanelOpen('right', 1440)).toBe(true);
    writePanelOpen('right', false);
    expect(readPanelOpen('right', 1440)).toBe(false);
  });

  it('is safe when storage is blocked', () => {
    vi.stubGlobal('window', { localStorage: fakeStorage(true) });
    expect(() => writePanelOpen('left', false)).not.toThrow();
    expect(readPanelOpen('left', 1100)).toBe(false);
    expect(readPanelOpen('left', 1440)).toBe(true);
  });
});
