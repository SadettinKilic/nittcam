// Keyboard shortcut registry (T104, spec §3.7): the single source for the global key handler,
// the command palette, menus/tooltips and the "?" help dialog. Pure: no DOM globals.

export type ShortcutId =
  | 'palette'
  | 'help'
  | 'goHome'
  | 'goProjects'
  | 'goMachines'
  | 'newProject'
  | 'toggleTheme'
  | 'toggleSidebar'
  | 'undo'
  | 'redo'
  | 'boardSelect'
  | 'boardPan'
  | 'boardRect'
  | 'boardCircle'
  | 'boardLine'
  | 'boardArc'
  | 'boardHole'
  | 'boardDim'
  | 'boardSnapHold'
  | 'boardFitSelection'
  | 'boardTypeLength'
  | 'boardCancel'
  | 'boardPanHold'
  | 'boardZoomIn'
  | 'boardZoomOut'
  | 'boardFit'
  | 'boardCopy'
  | 'boardPaste'
  | 'boardDuplicate'
  | 'boardDelete'
  | 'boardMirrorH'
  | 'boardMirrorV'
  | 'boardRotate'
  | 'canvasZoomIn'
  | 'canvasZoomOut'
  | 'canvasFit'
  | 'canvasFitJob'
  | 'benchMove'
  | 'benchRotate'
  | 'benchMate'
  | 'benchHide'
  | 'benchCancel';

export type ShortcutGroup = 'general' | 'navigation' | 'project' | 'board' | 'canvas' | 'bench';

export interface Shortcut {
  id: ShortcutId;
  /**
   * Key steps separated by a space ("g p" = G then P). A step is modifiers plus one key:
   * "mod+k" (Ctrl on Windows/Linux, ⌘ on macOS), "shift+t", "?".
   */
  keys: string;
  group: ShortcutGroup;
  /** Fires even while typing in a text field (only the palette). */
  inInputs?: boolean;
  /** Handled by a page (listed in help, not by the global handler). */
  page?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'palette', keys: 'mod+k', group: 'general', inInputs: true },
  { id: 'help', keys: '?', group: 'general' },
  { id: 'toggleTheme', keys: 'shift+t', group: 'general' },
  { id: 'toggleSidebar', keys: 'mod+b', group: 'general' },
  { id: 'goHome', keys: 'g h', group: 'navigation' },
  { id: 'goProjects', keys: 'g p', group: 'navigation' },
  { id: 'goMachines', keys: 'g m', group: 'navigation' },
  { id: 'newProject', keys: 'c', group: 'navigation' },
  { id: 'undo', keys: 'mod+z', group: 'project', page: true },
  { id: 'redo', keys: 'mod+y', group: 'project', page: true },
  // Drawing board (T242, D-039): handled by the board itself; listed in the help dialog, used in
  // the inspector tooltips.
  { id: 'boardSelect', keys: 'v', group: 'board', page: true },
  { id: 'boardPan', keys: 'h', group: 'board', page: true },
  { id: 'boardRect', keys: 'r', group: 'board', page: true },
  { id: 'boardCircle', keys: 'c', group: 'board', page: true },
  { id: 'boardLine', keys: 'l', group: 'board', page: true },
  { id: 'boardArc', keys: 'a', group: 'board', page: true },
  { id: 'boardHole', keys: 'o', group: 'board', page: true },
  { id: 'boardDim', keys: 'd', group: 'board', page: true },
  // T136: drawing keys of the editor tools, so the shortcut sheet covers every board key.
  { id: 'boardTypeLength', keys: 'enter', group: 'board', page: true },
  { id: 'boardCancel', keys: 'escape', group: 'board', page: true },
  { id: 'boardPanHold', keys: 'space', group: 'board', page: true },
  // B50 (CTO #7): Alt held = snapping off for a moment (status bar snap menu).
  { id: 'boardSnapHold', keys: 'alt', group: 'board', page: true },
  { id: 'boardZoomIn', keys: 'plus', group: 'board', page: true },
  { id: 'boardZoomOut', keys: '-', group: 'board', page: true },
  { id: 'boardFit', keys: 'f', group: 'board', page: true },
  { id: 'boardFitSelection', keys: 'shift+f', group: 'board', page: true },
  { id: 'boardCopy', keys: 'mod+c', group: 'board', page: true },
  { id: 'boardPaste', keys: 'mod+v', group: 'board', page: true },
  { id: 'boardDuplicate', keys: 'mod+d', group: 'board', page: true },
  { id: 'boardDelete', keys: 'delete', group: 'board', page: true },
  { id: 'boardMirrorH', keys: 'shift+x', group: 'board', page: true },
  { id: 'boardMirrorV', keys: 'shift+y', group: 'board', page: true },
  { id: 'boardRotate', keys: 'shift+r', group: 'board', page: true },
  // T381: the same zoom keys on the Dizilim, Simülasyon and 3D canvases (never while typing).
  { id: 'canvasZoomIn', keys: 'plus', group: 'canvas', page: true },
  { id: 'canvasZoomOut', keys: '-', group: 'canvas', page: true },
  { id: 'canvasFit', keys: 'f', group: 'canvas', page: true },
  { id: 'canvasFitJob', keys: '0', group: 'canvas', page: true },
  // T387: montaj tezgâhı tools (handled by the bench; zoom and fit use the canvas keys).
  { id: 'benchMove', keys: 'w', group: 'bench', page: true },
  { id: 'benchRotate', keys: 'e', group: 'bench', page: true },
  { id: 'benchMate', keys: 'm', group: 'bench', page: true },
  { id: 'benchHide', keys: 'h', group: 'bench', page: true },
  { id: 'benchCancel', keys: 'escape', group: 'bench', page: true },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  'general',
  'navigation',
  'project',
  'board',
  'canvas',
  'bench',
];

/**
 * Event that opens the shortcuts dialog from a page (the board status bar "?", T242). A
 * `CustomEvent` whose `detail` is a group opens the sheet of that group only (T136).
 */
export const OPEN_SHORTCUTS_EVENT = 'nittcam:shortcuts';

/** Opens the shortcut sheet; `group` limits it to one group (the editor's sheet, T136). */
export function openShortcuts(group?: ShortcutGroup): void {
  window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT, { detail: group ?? null }));
}

/**
 * The group a mounted page owns (the drawing board → 'board', T136): "?" there opens that
 * group's sheet first. Returns the release function for the effect cleanup.
 */
let pageGroup: { group: ShortcutGroup } | null = null;
export function claimPageGroup(group: ShortcutGroup): () => void {
  const own = { group };
  pageGroup = own;
  return () => {
    if (pageGroup === own) pageGroup = null;
  };
}

/** The group of the open page, if any. */
export function currentPageGroup(): ShortcutGroup | null {
  return pageGroup?.group ?? null;
}

/** Display text of a shortcut for tooltips ("Shift+X", "Ctrl+D", "⌘D"). */
export function shortcutText(id: ShortcutId, isMac: boolean): string {
  return formatShortcut(shortcutById(id).keys, isMac)
    .map((step) => step.join(isMac ? '' : '+'))
    .join(' ');
}

/** T381: a control's tooltip with its shortcut, e.g. "Yakınlaştır · +" (same form as the board, T242). */
export function withShortcut(label: string, id: ShortcutId, isMac = false): string {
  return `${label} · ${shortcutText(id, isMac)}`;
}

export function shortcutById(id: ShortcutId): Shortcut {
  const found = SHORTCUTS.find((s) => s.id === id);
  if (!found) throw new Error(`unknown shortcut ${id}`);
  return found;
}

interface Step {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseStep(step: string): Step {
  const parts = step.split('+');
  const key = parts.pop() ?? '';
  return {
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key: key.toLowerCase(),
  };
}

/** The parts of a KeyboardEvent the matcher reads (easy to fake in tests). */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

function isLetter(key: string): boolean {
  return /^[a-z]$/.test(key);
}

function matchesStep(e: KeyLike, step: Step, isMac: boolean): boolean {
  const key = e.key.toLowerCase();
  if (key !== step.key) return false;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const otherMod = isMac ? e.ctrlKey : e.metaKey;
  if (mod !== step.mod || otherMod || e.altKey !== step.alt) return false;
  // Shift is part of letter shortcuts; for symbols ("?") it depends on the keyboard layout.
  if (isLetter(step.key) && e.shiftKey !== step.shift) return false;
  return true;
}

/** Keys that never start or break a sequence on their own. */
const MODIFIER_KEYS = new Set(['shift', 'control', 'alt', 'meta', 'altgraph', 'capslock']);

const first = (p: { steps: Step[] }): Step =>
  p.steps[0] ?? { mod: false, shift: false, alt: false, key: '' };

/** Time a sequence ("g" then "p") may take. */
export const SEQUENCE_MS = 1000;

/**
 * Keeps the pending first step of two-key sequences. `match` returns the shortcut for this key
 * press, or null. `inInput` = the key was typed into a text field.
 */
export function createShortcutMatcher(shortcuts: readonly Shortcut[], isMac: boolean) {
  const parsed = shortcuts
    .filter((s) => !s.page)
    .map((s) => ({ s, steps: s.keys.split(' ').map(parseStep) }));
  let pending: { step: number; candidates: typeof parsed; at: number } | null = null;

  return function match(e: KeyLike, inInput: boolean, now: number): Shortcut | null {
    if (MODIFIER_KEYS.has(e.key.toLowerCase())) return null;
    const usable = parsed.filter((p) => !inInput || p.s.inInputs);
    if (pending && now - pending.at <= SEQUENCE_MS && !inInput) {
      const { step, candidates } = pending;
      pending = null;
      const hit = candidates.find((p) => p.steps[step] && matchesStep(e, p.steps[step], isMac));
      if (hit) return hit.s;
    }
    pending = null;
    const single = usable.find((p) => p.steps.length === 1 && matchesStep(e, first(p), isMac));
    if (single) return single.s;
    const starts = usable.filter((p) => p.steps.length > 1 && matchesStep(e, first(p), isMac));
    if (starts.length > 0) pending = { step: 1, candidates: starts, at: now };
    return null;
  };
}

/** Duck-typed element, so the check runs without a DOM in unit tests. */
export interface TargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
]);

/** Is the key going into a text field? Shortcuts are ignored there (spec §3.7). */
export function isTypingTarget(target: TargetLike | null | undefined): boolean {
  if (!target || typeof target.tagName !== 'string') return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((target.type ?? 'text').toLowerCase());
  const role = target.getAttribute?.('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

const KEY_NAMES: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  enter: 'Enter',
  delete: 'Delete',
  escape: 'Esc',
  space: 'Space',
  alt: 'Alt',
  // "+" cannot be written in a key step (it joins modifiers), so the registry names it.
  plus: '+',
};

/** Display keys per step, e.g. "mod+k" → [["Ctrl", "K"]] or [["⌘", "K"]]; "g p" → [["G"], ["P"]]. */
export function formatShortcut(keys: string, isMac: boolean): string[][] {
  return keys.split(' ').map((raw) => {
    const step = parseStep(raw);
    const out: string[] = [];
    if (step.mod) out.push(isMac ? '⌘' : 'Ctrl');
    if (step.alt) out.push(isMac ? '⌥' : 'Alt');
    if (step.shift) out.push(isMac ? '⇧' : 'Shift');
    out.push(KEY_NAMES[step.key] ?? step.key.toUpperCase());
    return out;
  });
}

/** aria-keyshortcuts value ("Control+K", "Shift+T"); sequences are left out (not expressible). */
export function ariaKeyShortcuts(keys: string, isMac: boolean): string | undefined {
  if (keys.includes(' ')) return undefined;
  const step = parseStep(keys);
  const parts: string[] = [];
  if (step.mod) parts.push(isMac ? 'Meta' : 'Control');
  if (step.alt) parts.push('Alt');
  if (step.shift) parts.push('Shift');
  parts.push(step.key.length === 1 ? step.key.toUpperCase() : step.key);
  return parts.join('+');
}

/**
 * Plain keys a mounted page (the drawing board) owns while it is open. The global handler skips
 * them, so a tool key like C never also fires a global shortcut such as "new project".
 */
const claimedKeys = new Map<string, number>();

/** Claim plain (no Ctrl/Cmd/Alt) keys; returns the release function for the effect cleanup. */
export function claimPageKeys(keys: readonly string[]): () => void {
  const ks = keys.map((k) => k.toLowerCase());
  for (const k of ks) claimedKeys.set(k, (claimedKeys.get(k) ?? 0) + 1);
  return () => {
    for (const k of ks) {
      const n = (claimedKeys.get(k) ?? 0) - 1;
      if (n > 0) claimedKeys.set(k, n);
      else claimedKeys.delete(k);
    }
  };
}

/** Is this plain key press owned by the open page? Modified presses (Ctrl+K, ...) never are. */
export function isPageClaimedKey(e: KeyLike): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return claimedKeys.has(e.key.toLowerCase());
}
