import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import {
  SEQUENCE_MS,
  SHORTCUTS,
  SHORTCUT_GROUPS,
  ariaKeyShortcuts,
  claimPageKeys,
  createShortcutMatcher,
  formatShortcut,
  isPageClaimedKey,
  isTypingTarget,
  type KeyLike,
} from './shortcuts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('registry', () => {
  it('has unique ids and key combinations, each with Turkish text', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SHORTCUTS) {
      expect(tr.shortcuts.items[s.id], s.id).toBeTruthy();
      expect(SHORTCUT_GROUPS).toContain(s.group);
    }
    for (const g of SHORTCUT_GROUPS) expect(tr.shortcuts.groups[g]).toBeTruthy();
  });
});

describe('createShortcutMatcher', () => {
  it('matches mod+k with Ctrl on Windows and ⌘ on macOS', () => {
    const win = createShortcutMatcher(SHORTCUTS, false);
    expect(win(key('k', { ctrlKey: true }), false, 0)?.id).toBe('palette');
    expect(win(key('k', { metaKey: true }), false, 0)).toBeNull();
    expect(win(key('K', { ctrlKey: true, shiftKey: true }), false, 0)).toBeNull();
    const mac = createShortcutMatcher(SHORTCUTS, true);
    expect(mac(key('k', { metaKey: true }), false, 0)?.id).toBe('palette');
    expect(mac(key('k', { ctrlKey: true }), false, 0)).toBeNull();
  });

  it('matches "?" whatever shift the layout needs, and shift+T only with shift', () => {
    const m = createShortcutMatcher(SHORTCUTS, false);
    expect(m(key('?', { shiftKey: true }), false, 0)?.id).toBe('help');
    expect(m(key('?'), false, 0)?.id).toBe('help');
    expect(m(key('T', { shiftKey: true }), false, 0)?.id).toBe('toggleTheme');
    expect(m(key('t'), false, 0)).toBeNull();
  });

  it('follows two-key sequences within the time limit', () => {
    const m = createShortcutMatcher(SHORTCUTS, false);
    expect(m(key('g'), false, 0)).toBeNull();
    expect(m(key('Shift'), false, 10)).toBeNull(); // a modifier does not break the sequence
    expect(m(key('p'), false, 100)?.id).toBe('goProjects');
    expect(m(key('g'), false, 1000)).toBeNull();
    expect(m(key('m'), false, 1000 + SEQUENCE_MS + 1)).toBeNull();
    expect(m(key('g'), false, 5000)).toBeNull();
    expect(m(key('x'), false, 5010)).toBeNull();
    expect(m(key('h'), false, 5020)).toBeNull(); // the sequence was broken by "x"
  });

  it('ignores everything but the palette while typing', () => {
    const m = createShortcutMatcher(SHORTCUTS, false);
    expect(m(key('?'), true, 0)).toBeNull();
    expect(m(key('c'), true, 0)).toBeNull();
    expect(m(key('g'), true, 0)).toBeNull();
    expect(m(key('p'), false, 10)).toBeNull();
    expect(m(key('b', { ctrlKey: true }), true, 20)).toBeNull();
    expect(m(key('k', { ctrlKey: true }), true, 30)?.id).toBe('palette');
  });

  it('never fires page-handled shortcuts (undo/redo)', () => {
    const m = createShortcutMatcher(SHORTCUTS, false);
    expect(m(key('z', { ctrlKey: true }), false, 0)).toBeNull();
  });
});

describe('isTypingTarget', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra });
  it('knows text fields', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'number' }))).toBe(true);
    expect(isTypingTarget(el('input', { type: 'search' }))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(el('DIV', { getAttribute: () => 'combobox' }))).toBe(true);
  });
  it('lets shortcuts through elsewhere', () => {
    expect(isTypingTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(el('DIV', { getAttribute: () => null }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});

describe('formatting', () => {
  it('shows platform keys', () => {
    expect(formatShortcut('mod+k', false)).toEqual([['Ctrl', 'K']]);
    expect(formatShortcut('mod+k', true)).toEqual([['⌘', 'K']]);
    expect(formatShortcut('g p', false)).toEqual([['G'], ['P']]);
    expect(formatShortcut('shift+t', false)).toEqual([['Shift', 'T']]);
    expect(formatShortcut('?', true)).toEqual([['?']]);
  });
  it('gives aria-keyshortcuts for chords only', () => {
    expect(ariaKeyShortcuts('mod+k', false)).toBe('Control+K');
    expect(ariaKeyShortcuts('mod+k', true)).toBe('Meta+K');
    expect(ariaKeyShortcuts('shift+t', false)).toBe('Shift+T');
    expect(ariaKeyShortcuts('g p', false)).toBeUndefined();
  });
});

describe('claimPageKeys (B10-1)', () => {
  it('hides claimed plain keys from the global handler until released', () => {
    expect(isPageClaimedKey(key('c'))).toBe(false);
    const release = claimPageKeys(['c', 'v']);
    const again = claimPageKeys(['c']);
    expect(isPageClaimedKey(key('C', { shiftKey: true }))).toBe(true);
    expect(isPageClaimedKey(key('c', { ctrlKey: true }))).toBe(false);
    expect(isPageClaimedKey(key('k', { metaKey: true }))).toBe(false);
    release();
    expect(isPageClaimedKey(key('v'))).toBe(false);
    expect(isPageClaimedKey(key('c'))).toBe(true);
    again();
    expect(isPageClaimedKey(key('c'))).toBe(false);
  });
});
