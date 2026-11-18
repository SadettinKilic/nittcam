/**
 * Editor store (T124, spec §4.2): tool, selection, hover, viewport and snap toggles. UI state
 * only; project data changes go through commands (`run`), never through this store.
 */
import type { DrawTool } from './draw-tool';
import { panBy, zoomAt, type Pt, type Viewport } from './viewport';

export type EditorTool = 'select' | 'pan' | DrawTool;

/** Snap kinds the status bar toggles (T126); the engine lives in `@nittcam/core`. */
export const SNAP_TOGGLES = [
  'endpoint',
  'midpoint',
  'centre',
  'intersection',
  'perpendicular',
  'grid',
  'angle',
] as const;
export type SnapToggle = (typeof SNAP_TOGGLES)[number];

export interface EditorState {
  tool: EditorTool;
  selection: string[];
  hover: string | null;
  /** null until the canvas has a size and the first fit ran. */
  view: Viewport | null;
  snap: Record<SnapToggle, boolean>;
  grid: boolean;
  /** Stock sheet reference outline (T243): view state only, never a command or project data. */
  sheet: boolean;
}

export type EditorAction =
  | { type: 'tool'; tool: EditorTool }
  | { type: 'select'; ids: string[] }
  | { type: 'toggle'; id: string }
  | { type: 'add'; ids: string[] }
  | { type: 'clear' }
  | { type: 'hover'; id: string | null }
  | { type: 'view'; view: Viewport }
  /** Relative view changes read the latest view (several pointer events per frame). */
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; factor: number; at: Pt }
  | { type: 'snap'; kind: SnapToggle; on: boolean }
  | { type: 'grid'; on: boolean }
  | { type: 'sheet'; on: boolean }
  /** Drops selected ids that no longer exist (after delete or undo). */
  | { type: 'prune'; ids: readonly string[] };

export const initialEditorState: EditorState = {
  tool: 'select',
  selection: [],
  hover: null,
  view: null,
  snap: {
    endpoint: true,
    midpoint: true,
    centre: true,
    intersection: true,
    perpendicular: false,
    grid: true,
    angle: true,
  },
  grid: true,
  sheet: true,
};

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'tool':
      return state.tool === action.tool ? state : { ...state, tool: action.tool };
    case 'select':
      return same(state.selection, action.ids) ? state : { ...state, selection: [...action.ids] };
    case 'toggle':
      return {
        ...state,
        selection: state.selection.includes(action.id)
          ? state.selection.filter((x) => x !== action.id)
          : [...state.selection, action.id],
      };
    case 'add': {
      const next = [...state.selection, ...action.ids.filter((x) => !state.selection.includes(x))];
      return same(next, state.selection) ? state : { ...state, selection: next };
    }
    case 'clear':
      return state.selection.length === 0 ? state : { ...state, selection: [] };
    case 'hover':
      return state.hover === action.id ? state : { ...state, hover: action.id };
    case 'view':
      return { ...state, view: action.view };
    case 'pan':
      return state.view ? { ...state, view: panBy(state.view, action.dx, action.dy) } : state;
    case 'zoom':
      return state.view ? { ...state, view: zoomAt(state.view, action.factor, action.at) } : state;
    case 'snap':
      return { ...state, snap: { ...state.snap, [action.kind]: action.on } };
    case 'grid':
      return { ...state, grid: action.on };
    case 'sheet':
      return state.sheet === action.on ? state : { ...state, sheet: action.on };
    case 'prune': {
      const keep = state.selection.filter((x) => action.ids.includes(x));
      const hover = state.hover !== null && action.ids.includes(state.hover) ? state.hover : null;
      return keep.length === state.selection.length && hover === state.hover
        ? state
        : { ...state, selection: keep, hover };
    }
  }
}
