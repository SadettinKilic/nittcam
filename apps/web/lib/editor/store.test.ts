import { describe, expect, it } from 'vitest';
import { editorReducer, initialEditorState as s0 } from './store';

describe('editor store (T124)', () => {
  it('selects, toggles, adds and clears', () => {
    let s = editorReducer(s0, { type: 'select', ids: ['a'] });
    expect(s.selection).toEqual(['a']);
    s = editorReducer(s, { type: 'toggle', id: 'b' });
    expect(s.selection).toEqual(['a', 'b']);
    s = editorReducer(s, { type: 'toggle', id: 'a' });
    expect(s.selection).toEqual(['b']);
    s = editorReducer(s, { type: 'add', ids: ['b', 'c'] });
    expect(s.selection).toEqual(['b', 'c']);
    expect(editorReducer(s, { type: 'clear' }).selection).toEqual([]);
  });

  it('returns the same state for no-op actions', () => {
    const s = editorReducer(s0, { type: 'select', ids: ['a'] });
    expect(editorReducer(s, { type: 'select', ids: ['a'] })).toBe(s);
    expect(editorReducer(s, { type: 'tool', tool: 'select' })).toBe(s);
    expect(editorReducer(s, { type: 'prune', ids: ['a', 'b'] })).toBe(s);
  });

  it('prunes selection and hover of removed parts', () => {
    let s = editorReducer(s0, { type: 'select', ids: ['a', 'b'] });
    s = editorReducer(s, { type: 'hover', id: 'b' });
    s = editorReducer(s, { type: 'prune', ids: ['a'] });
    expect(s.selection).toEqual(['a']);
    expect(s.hover).toBeNull();
  });

  it('toggles snap kinds and the grid', () => {
    const s = editorReducer(s0, { type: 'snap', kind: 'grid', on: false });
    expect(s.snap.grid).toBe(false);
    expect(s.snap.endpoint).toBe(true);
    expect(editorReducer(s, { type: 'grid', on: false }).grid).toBe(false);
  });

  it('toggles the sheet reference as view state only (T243)', () => {
    expect(s0.sheet).toBe(true);
    const off = editorReducer(s0, { type: 'sheet', on: false });
    expect(off.sheet).toBe(false);
    // Nothing but the flag changes: no selection, view or tool change, nothing to send.
    expect({ ...off, sheet: true }).toEqual(s0);
    expect(editorReducer(off, { type: 'sheet', on: false })).toBe(off);
  });
});
