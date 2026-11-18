'use client';

import {
  boardBox,
  boardParts,
  arcOf,
  bulgeFromSagitta,
  nextPartName,
  segmentMidpoint,
  snap,
  tidy,
  type Part,
  type Project,
  type SnapKind,
} from '@nittcam/core';
import { Button, Checkbox, IconButton, Tooltip, cn, notify } from '@nittcam/ui';
import {
  Circle,
  Hand,
  List,
  Maximize,
  MousePointer2,
  PenLine,
  Spline,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Messages } from '../../lib/messages';
import { onThemeChange } from '../../lib/canvas-theme';
import { newPartId } from '../../lib/draft-project';
import {
  backspace,
  clickAt,
  enter,
  fieldsFor,
  hintFor,
  isDrawTool,
  parseTyped,
  preview,
  type DraftView,
  type DrawDraft,
  type DrawStep,
  type DrawTool,
  type DrawnShape,
  type Typed,
} from '../../lib/editor/draw-tool';
import { claimPageKeys } from '../../lib/shortcuts';
import { useMediaQuery } from '../../lib/use-media-query';
import { boxFrom, hitPart, partsInBox } from '../../lib/editor/hit';
import {
  SNAP_TOGGLES,
  editorReducer,
  initialEditorState,
  type EditorTool,
} from '../../lib/editor/store';
import {
  fitBox,
  gridLevels,
  toScreen,
  toWorld,
  type Box,
  type Pt,
} from '../../lib/editor/viewport';
import { formatMm, sizeText } from '../../lib/canvas-labels';
import { CanvasBoundary } from '../feedback/canvas-boundary';
import { WorkspaceLayout } from '../wizard/workspace-layout';
import { readEditorColors, type EditorColors } from './colors';
import { DynamicInput } from './dynamic-input';
import { RULER_PX, type SnapGlyph } from './editor-canvas';
import { EditorInspector } from './inspector';
import { BoardPartList } from './part-list';
import { StatusBar } from './status-bar';

const EditorCanvas = dynamic(() => import('./editor-canvas'), { ssr: false });

type T = Messages['editor'];

/** Screen area kept free of the drawing when fitting: rulers, tool rail, view toolbar. */
const FIT_INSETS = { top: RULER_PX + 56, right: 16, bottom: 16, left: RULER_PX + 64 };
/** Offset of a pasted / duplicated copy, mm (right and down). */
const PASTE_OFFSET = 20;
/** Height of the top toolbar band (view switch, zoom) plus its gap: the rail starts below it. */
const BAND_PX = 48;
/** Snap capture distance on screen, px. */
const SNAP_PX = 10;
/** Pointer movement that turns a click into a drag, px. */
const DRAG_PX = 3;

/** No typed values: every chip field shows its live value. */
const NO_TYPED = { values: [] as string[], active: 0 };

/** Keys go to a text field, not to the board. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [role="combobox"], [role="dialog"]') !== null)
  );
}

/** Plain keys the board owns while open (global shortcuts skip them). */
const BOARD_KEYS = ['v', 'h', 'r', 'c', 'l', 'a', 'f', '+', '=', '-'] as const;

/** One pointer gesture on the canvas. */
type Gesture =
  | { kind: 'pan'; last: Pt }
  | { kind: 'pinch'; dist: number; mid: Pt }
  | { kind: 'marquee'; start: Pt; startScreen: Pt; additive: boolean; moved: boolean }
  | { kind: 'press'; id: string; start: Pt; startScreen: Pt; additive: boolean }
  | { kind: 'move'; ids: string[]; start: Pt; anchor: Pt }
  /** Drawing-tool press; `before` is the draft to restore if a pinch takes over. */
  | { kind: 'draw'; startScreen: Pt; placed: boolean; before: DrawDraft | null }
  /** Dragging a segment's bend handle (T129). */
  | { kind: 'bend'; id: string; index: number; p0: Pt; p1: Pt; bulge: number };

/** Board moves are kept to 0.01 mm (no float dust in the project). */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Drawing board of the Parts step (T124, spec §4.2): the cut list's parts as editable shapes on a
 * board in millimetres (Y up). Built on `WorkspaceLayout`: parts list left, inspector right, tool
 * rail and view toolbar floating on the canvas, status bar docked under it.
 */
export function DrawingBoard({
  t,
  project,
  run,
  onToList,
  viewSwitch,
}: {
  t: T;
  project: Project;
  run: (command: string, params: unknown) => boolean;
  onToList: () => void;
  /** Liste / Çizim switch placed in the canvas toolbar band (below 1024 px, T240). */
  viewSwitch?: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [colors, setColors] = useState<EditorColors | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [drag, setDrag] = useState<Pt | null>(null);
  const [snapMark, setSnapMark] = useState<{ kind: SnapGlyph; point: Pt } | null>(null);
  const clipboard = useRef<Part[]>([]);
  const pastes = useRef(0);
  const [spaceDown, setSpaceDown] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  // The canvas element can be remounted (the workspace switches between its phone and desktop
  // trees), so observers attach to the current element, not to the first one.
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture | null>(null);
  const gridId = useId();

  const parts = useMemo(() => boardParts(project), [project]);
  const bounds = useMemo(() => boardBox(parts), [parts]);
  const names = useMemo(
    () =>
      new Map(
        project.parts.map((p, i) => [
          p.id,
          {
            number: String(i + 1),
            name: `${p.name.trim() || t.parts.unnamed}${p.qty > 1 ? ` ${t.parts.qty.replace('{qty}', String(p.qty))}` : ''}`,
          },
        ]),
      ),
    [project.parts, t.parts],
  );
  const selection = useMemo(() => new Set(state.selection), [state.selection]);
  const view = state.view;

  // Drawing tools (T127–T129, D-039): the in-progress shape, the snapped cursor and the typed
  // values of the dynamic input chip. All UI state; a finished shape is one `drawPart` command.
  const drawTool: DrawTool | null = isDrawTool(state.tool) ? state.tool : null;
  const [draft, setDraft] = useState<DrawDraft | null>(null);
  const [typed, setTyped] = useState<{ values: string[]; active: number }>(NO_TYPED);
  const [drawAt, setDrawAt] = useState<Pt | null>(null);
  const [lock, setLock] = useState(false);
  const docked = useMediaQuery('(max-width: 639px)', false);
  const fields = drawTool ? fieldsFor(drawTool, draft) : [];
  const typedValues: Typed = {};
  fields.forEach((f, i) => {
    const v = parseTyped(typed.values[i] ?? '');
    if (v !== undefined) typedValues[f] = v;
  });
  const drawCursor: Pt | null =
    drawAt ??
    (draft?.kind === 'rect'
      ? draft.a
      : draft?.kind === 'circle'
        ? draft.c
        : draft?.kind === 'path'
          ? (draft.pts.at(-1) ?? null)
          : null);
  const draftView =
    drawTool && drawCursor ? preview(drawTool, draft, drawCursor, typedValues, lock) : null;
  const draftLabel = !draftView
    ? null
    : draft?.kind === 'rect' && draftView.live.w !== undefined && draftView.live.h !== undefined
      ? sizeText(draftView.live.w, draftView.live.h)
      : draft?.kind === 'circle' && draftView.live.r !== undefined && draftView.live.r > 0
        ? `R ${formatMm(draftView.live.r)}`
        : null;

  const selected = useMemo(() => parts.filter((p) => selection.has(p.id)), [parts, selection]);

  // Bend handles (T129): with one part selected in Seç, a round node at every segment middle
  // (on the arc for arcs); dragging it bends the segment (`setSegmentBulge`, one undo step).
  const [bend, setBend] = useState<{ id: string; index: number; bulge: number; at: Pt } | null>(
    null,
  );
  const bendHandles = useMemo(() => {
    const part = selected.length === 1 ? selected[0] : undefined;
    if (state.tool !== 'select' || !part || drag) return [];
    const vs = part.outline;
    return vs.map((a, i) => {
      const b = vs[(i + 1) % vs.length] ?? a;
      return {
        id: part.id,
        index: i,
        p0: { x: a.x, y: a.y },
        p1: { x: b.x, y: b.y },
        bulge: a.bulge,
        at: segmentMidpoint(a, b, a.bulge),
      };
    });
  }, [state.tool, selected, drag]);
  /** Live preview while bending: the outline with the new bulge, arc centre and radius. */
  const bendView = useMemo((): DraftView | null => {
    if (!bend) return null;
    const part = parts.find((x) => x.id === bend.id);
    if (!part) return null;
    const vs = part.outline.map((v, i) => (i === bend.index ? { ...v, bulge: bend.bulge } : v));
    const a = vs[bend.index];
    const b = vs[(bend.index + 1) % vs.length];
    const arc = a && b ? arcOf(a, b, bend.bulge) : undefined;
    return {
      vertices: vs,
      closed: true,
      rubber: null,
      nodes: [],
      closing: false,
      open: false,
      centre: arc?.center ?? null,
      live: { r: arc ? tidy(arc.radius) : 0 },
    };
  }, [bend, parts]);

  // Selected ids that disappear (removed, undone) leave the selection.
  const ids = useMemo(() => project.parts.map((p) => p.id), [project.parts]);
  useEffect(() => dispatch({ type: 'prune', ids }), [ids]);

  const touched = useRef(false);
  const fit = useCallback(() => {
    touched.current = false;
    if (size.w > 0 && size.h > 0) {
      dispatch({ type: 'view', view: fitBox(bounds, size.w, size.h, FIT_INSETS) });
    }
  }, [bounds, size.w, size.h]);
  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  // The canvas fills its workspace cell; the first size fits the board.
  useEffect(() => {
    const el = canvasEl;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      const h = Math.floor(entries[0]?.contentRect.height ?? 0);
      if (w <= 0 || h <= 0) return;
      setColors((c) => c ?? readEditorColors());
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasEl]);
  // Until the user pans or zooms, the board stays fitted: a new canvas size (panel toggled,
  // window resized, phone/desktop layout switch) or the first parts refit it.
  const hasParts = parts.length > 0;
  useEffect(() => {
    if (!touched.current && size.w > 0) fitRef.current();
  }, [size.w, size.h, hasParts]);
  useEffect(() => onThemeChange(() => setColors((c) => (c ? readEditorColors() : c))), []);

  const zoomBy = useCallback(
    (factor: number, at?: Pt) => {
      touched.current = true;
      dispatch({ type: 'zoom', factor, at: at ?? { x: size.w / 2, y: size.h / 2 } });
    },
    [size.w, size.h],
  );

  // Wheel / trackpad pinch zooms at the cursor (non-passive so the page does not scroll).
  useEffect(() => {
    const el = canvasEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      touched.current = true;
      dispatch({ type: 'zoom', factor: Math.exp(-e.deltaY * 0.0015), at });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvasEl]);

  /** Switching tools ends the shape in progress; line ↔ arc keeps the path (one shape, two tools). */
  const setTool = useCallback((tool: EditorTool) => {
    dispatch({ type: 'tool', tool });
    setTyped(NO_TYPED);
    setSnapMark(null);
    setDraft((d) =>
      d?.kind === 'path' && (tool === 'line' || tool === 'arc') ? { ...d, pending: null } : null,
    );
  }, []);

  /** Adds a finished shape as a part with the next free name and selects it (T127). */
  function commitShape(shape: DrawnShape) {
    const id = newPartId();
    const name = nextPartName(
      t.defaultName,
      project.parts.map((p) => p.name),
    );
    if (run('drawPart', { id, name, at: shape.at, shape: shape.shape })) {
      dispatch({ type: 'select', ids: [id] });
    }
  }

  function applyStep(step: DrawStep) {
    setDraft(step.draft);
    setTyped(NO_TYPED);
    if (step.commit) commitShape(step.commit);
  }

  /**
   * Snapped drawing point: the path start when the cursor is near it ("Kapat"), else the T126
   * snap engine (corners, midpoints, centres, grid, 45°/90° from the last point). Alt = free.
   */
  function drawPoint(w: Pt, free: boolean): { point: Pt; kind: SnapKind | 'close' } {
    if (!view) return { point: w, kind: 'none' };
    const tol = SNAP_PX / view.scale;
    if (draft?.kind === 'path' && !draft.open && draft.pts.length >= 2) {
      const start = draft.pts[0];
      if (start && Math.hypot(w.x - start.x, w.y - start.y) <= tol) {
        return { point: { x: start.x, y: start.y }, kind: 'close' };
      }
    }
    if (free) return { point: w, kind: 'none' };
    const from =
      draft?.kind === 'path'
        ? (draft.pending ?? draft.pts.at(-1))
        : draft?.kind === 'rect'
          ? draft.a
          : draft?.kind === 'circle'
            ? draft.c
            : undefined;
    const res = snap(w, {
      contours: parts.flatMap((p) => [p.outline, ...p.inners]),
      centres: parts.flatMap((p) => p.holes.map((h) => ({ x: h.x, y: h.y }))),
      tolerance: tol,
      grid: gridLevels(view.scale).fine,
      ...(from ? { from: { x: from.x, y: from.y } } : {}),
      disabled: SNAP_TOGGLES.filter((k) => !state.snap[k]),
    });
    return { point: res.kind === 'none' ? w : res.point, kind: res.kind };
  }

  // Drawing keys (capture phase, before the board and edit shortcuts): digits fill the chip,
  // Tab / ; switch fields, Enter commits, Backspace edits or drops the last vertex, Esc cancels.
  useEffect(() => {
    if (!drawTool) return;
    const tool = drawTool;
    function onKey(e: KeyboardEvent) {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      const n = fields.length;
      if (/^[0-9]$/.test(k) || k === '.' || k === ',' || k === '-') {
        if (n === 0) return;
        setTyped((t) => {
          const values = [...t.values];
          values[t.active] = (values[t.active] ?? '') + k;
          return { ...t, values };
        });
      } else if (k === 'Tab' || k === ';') {
        if (n === 0) return;
        setTyped((t) => ({ ...t, active: (t.active + (e.shiftKey ? n - 1 : 1)) % n }));
      } else if (k === 'Enter') {
        if (!drawCursor) return;
        applyStep(enter(tool, draft, drawCursor, typedValues, lock));
      } else if (k === 'Backspace') {
        const cur = typed.values[typed.active] ?? '';
        if (cur !== '') {
          setTyped((t) => {
            const values = [...t.values];
            values[t.active] = cur.slice(0, -1);
            return { ...t, values };
          });
        } else if (draft) {
          setDraft(backspace(draft));
          setTyped(NO_TYPED);
        } else return;
      } else if (k === 'Delete') {
        if (!draft) return;
      } else if (k === 'Escape') {
        if (typed.values.some((v) => v !== '')) setTyped(NO_TYPED);
        else if (draft) setDraft(null);
        else setTool('select');
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Board keys (not while typing): V select, H pan, F fit, +/- zoom, Esc clears, Space pans.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        setSpaceDown(true);
      } else if (k === 'v') setTool('select');
      else if (k === 'h') setTool('pan');
      else if (k === 'r' && !e.shiftKey) setTool('rect');
      else if (k === 'c' && !e.shiftKey) setTool('circle');
      else if (k === 'l' && !e.shiftKey) setTool('line');
      else if (k === 'a' && !e.shiftKey) setTool('arc');
      else if (k === 'f') fit();
      else if (k === '+' || k === '=') zoomBy(1.25);
      else if (k === '-') zoomBy(1 / 1.25);
      else if (k === 'escape') {
        dispatch({ type: 'clear' });
        return; // Esc stays visible to dialogs and popovers.
      } else return;
      // Handled here: the global shortcuts (C = new project, ...) must not see it too.
      e.preventDefault();
    }
    function onUp(e: KeyboardEvent) {
      if (e.key === ' ') setSpaceDown(false);
    }
    // The claim keeps the shell's global handler off these keys whichever listener runs first.
    const release = claimPageKeys(BOARD_KEYS);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      release();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [fit, zoomBy, setTool]);

  function local(e: { clientX: number; clientY: number }): Pt {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!view) return;
    const s = local(e);
    pointers.current.set(e.pointerId, s);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured; the gesture still works.
    }
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && pts[0] && pts[1]) {
      setMarquee(null);
      // A second finger turns a drawing tap into pinch/pan: undo what the first finger placed.
      const g0 = gesture.current;
      if (g0?.kind === 'draw' && g0.placed) setDraft(g0.before);
      gesture.current = {
        kind: 'pinch',
        dist: dist(pts[0], pts[1]),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
      return;
    }
    if (pts.length > 2) return;
    const w = toWorld(view, s);
    const panning = e.button === 1 || state.tool === 'pan' || spaceDown;
    if (panning) {
      gesture.current = { kind: 'pan', last: s };
      return;
    }
    if (e.button !== 0) return;
    if (drawTool) {
      // Rectangle and circle start on press (drag or click-click); paths add points on release.
      const before = draft;
      const { point } = drawPoint(w, e.altKey);
      setDrawAt(point);
      let placed = false;
      if (!draft && (drawTool === 'rect' || drawTool === 'circle')) {
        applyStep(clickAt(drawTool, null, point, {}, e.shiftKey));
        placed = true;
      }
      gesture.current = { kind: 'draw', startScreen: s, placed, before };
      return;
    }
    // Bend handle of the selected part: ≥ 24 px hit area (44 px on touch).
    const reach = e.pointerType === 'touch' ? 22 : 12;
    const handle = bendHandles.find((h) => dist(toScreen(view, h.at), s) <= reach);
    if (handle) {
      gesture.current = { kind: 'bend', ...handle };
      setBend({ id: handle.id, index: handle.index, bulge: handle.bulge, at: w });
      return;
    }
    const hit = hitPart(parts, w, 4 / view.scale);
    if (hit) {
      gesture.current = { kind: 'press', id: hit, start: w, startScreen: s, additive: e.shiftKey };
      return;
    }
    // Empty canvas: one finger pans on touch; mouse/pen draws a selection box.
    gesture.current =
      e.pointerType === 'touch'
        ? { kind: 'pan', last: s }
        : { kind: 'marquee', start: w, startScreen: s, additive: e.shiftKey, moved: false };
  }

  /** The grabbed part's outline vertex nearest to the press point: the point that snaps. */
  function anchorOf(id: string, at: Pt): Pt {
    const part = parts.find((p) => p.id === id);
    let best: Pt = at;
    let bestD = Infinity;
    for (const v of part?.outline ?? []) {
      const dd = Math.hypot(v.x - at.x, v.y - at.y);
      if (dd < bestD) {
        best = { x: v.x, y: v.y };
        bestD = dd;
      }
    }
    return best;
  }

  /**
   * Drag offset of a move with snapping (T126): the anchor snaps to the other parts' corners,
   * midpoints, centres and crossings, to the grid, or along 45°/90° from where it started.
   * Holding Alt moves freely.
   */
  function snapMove(g: { ids: string[]; start: Pt; anchor: Pt }, w: Pt, free: boolean): Pt {
    const raw = { x: w.x - g.start.x, y: w.y - g.start.y };
    if (!view || free) {
      setSnapMark(null);
      return raw;
    }
    const moving = new Set(g.ids);
    const others = parts.filter((p) => !moving.has(p.id));
    const target = { x: g.anchor.x + raw.x, y: g.anchor.y + raw.y };
    const res = snap(target, {
      contours: others.flatMap((p) => [p.outline, ...p.inners]),
      centres: others.flatMap((p) => p.holes.map((h) => ({ x: h.x, y: h.y }))),
      tolerance: SNAP_PX / view.scale,
      grid: gridLevels(view.scale).fine,
      from: g.anchor,
      disabled: SNAP_TOGGLES.filter((k) => !state.snap[k]),
    });
    if (res.kind === 'none') {
      setSnapMark(null);
      return raw;
    }
    setSnapMark({ kind: res.kind, point: res.point });
    return { x: res.point.x - g.anchor.x, y: res.point.y - g.anchor.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!view) return;
    const s = local(e);
    const w = toWorld(view, s);
    setCursor(w);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, s);
    const g = gesture.current;
    if (drawTool && (!g || g.kind === 'draw')) {
      const r = drawPoint(w, e.altKey);
      setDrawAt(r.point);
      setLock(e.shiftKey);
      setSnapMark(
        r.kind === 'none' || r.kind === 'close' ? null : { kind: r.kind, point: r.point },
      );
      return;
    }
    if (!g) {
      if (e.pointerType !== 'touch' && state.tool === 'select') {
        dispatch({ type: 'hover', id: hitPart(parts, w, 4 / view.scale) });
      }
      return;
    }
    if (g.kind === 'pan') {
      touched.current = true;
      dispatch({ type: 'pan', dx: s.x - g.last.x, dy: s.y - g.last.y });
      g.last = s;
    } else if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2 || !pts[0] || !pts[1]) return;
      const d = dist(pts[0], pts[1]);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      touched.current = true;
      dispatch({ type: 'pan', dx: mid.x - g.mid.x, dy: mid.y - g.mid.y });
      dispatch({ type: 'zoom', factor: d / Math.max(g.dist, 1), at: mid });
      gesture.current = { kind: 'pinch', dist: d, mid };
    } else if (g.kind === 'press') {
      // A press that moves becomes a move of the selection (the pressed part joins it).
      if (dist(s, g.startScreen) < DRAG_PX) return;
      const ids = selection.has(g.id) ? state.selection : [g.id];
      if (!selection.has(g.id)) dispatch({ type: 'select', ids });
      const move = { kind: 'move' as const, ids, start: g.start, anchor: anchorOf(g.id, g.start) };
      gesture.current = move;
      setDrag(snapMove(move, w, e.altKey));
    } else if (g.kind === 'bend') {
      setBend({ id: g.id, index: g.index, bulge: bulgeFromSagitta(g.p0, g.p1, w), at: w });
    } else if (g.kind === 'move') {
      setDrag(snapMove(g, w, e.altKey));
    } else if (g.kind === 'marquee') {
      if (!g.moved && dist(s, g.startScreen) < DRAG_PX) return;
      g.moved = true;
      setMarquee(boxFrom(g.start, w));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!view || !g) return;
    if (g.kind === 'pinch') {
      // Lifting one finger of a pinch ends the gesture; the other one starts nothing.
      gesture.current = null;
      return;
    }
    gesture.current = null;
    if (g.kind === 'draw') {
      if (!drawTool) return;
      const moved = dist(local(e), g.startScreen) >= DRAG_PX;
      // A press that placed the first corner waits for the second click unless it was a drag.
      if (g.placed && !moved) return;
      const { point } = drawPoint(toWorld(view, local(e)), e.altKey);
      setDrawAt(point);
      applyStep(clickAt(drawTool, draft, point, typedValues, e.shiftKey));
      return;
    }
    if (g.kind === 'bend') {
      const b = bend;
      setBend(null);
      if (b && Math.abs(b.bulge - g.bulge) > 1e-9) {
        run('setSegmentBulge', {
          id: g.id,
          index: g.index,
          bulge: Math.round(b.bulge * 1e6) / 1e6,
        });
      }
      return;
    }
    if (g.kind === 'press') {
      dispatch(g.additive ? { type: 'toggle', id: g.id } : { type: 'select', ids: [g.id] });
    } else if (g.kind === 'move') {
      const d = drag;
      setDrag(null);
      setSnapMark(null);
      if (d && (d.x !== 0 || d.y !== 0)) {
        run('movePart', { ids: g.ids, dx: round(d.x), dy: round(d.y) });
      }
    } else if (g.kind === 'marquee') {
      if (g.moved) {
        const found = partsInBox(parts, boxFrom(g.start, toWorld(view, local(e))));
        dispatch(g.additive ? { type: 'add', ids: found } : { type: 'select', ids: found });
      } else if (!g.additive) {
        dispatch({ type: 'clear' });
      }
      setMarquee(null);
    }
  }

  // Edit actions (T125): every change is a command with undo (Ctrl+Z / Ctrl+Y in the wizard).
  const actions = useMemo(() => {
    const ids = state.selection;
    const at = new Map(parts.map((p) => [p.id, p.at]));
    /** Selected parts with their current board position (a clipboard snapshot). */
    const snapshot = (): Part[] =>
      project.parts
        .filter((p) => ids.includes(p.id))
        .map((p) => {
          const pos = at.get(p.id) ?? { x: 0, y: 0 };
          return { ...structuredClone(p), draw: { x: pos.x, y: pos.y } };
        });
    const paste = (src: readonly Part[], offset: number): boolean => {
      if (src.length === 0) return false;
      const copies = src.map((p) => ({
        ...structuredClone(p),
        id: newPartId(),
        name: p.name.trim() ? t.copyName.replace('{name}', p.name.trim()) : p.name,
        draw: { x: (p.draw?.x ?? 0) + offset, y: (p.draw?.y ?? 0) - offset },
      }));
      if (!run('pasteParts', { parts: copies })) return false;
      dispatch({ type: 'select', ids: copies.map((c) => c.id) });
      return true;
    };
    const has = ids.length > 0;
    return {
      has,
      move: (dx: number, dy: number) => has && run('movePart', { ids, dx, dy }),
      mirrorH: () => has && run('mirrorPart', { ids, axis: 'h' }),
      mirrorV: () => has && run('mirrorPart', { ids, axis: 'v' }),
      // The button turns clockwise (= 270° counter-clockwise).
      rotate: () => has && run('rotatePart', { ids, turns: 270 }),
      remove: () => has && run('removeParts', { ids }),
      duplicate: () => has && paste(snapshot(), PASTE_OFFSET),
      /** False when nothing is selected, so the browser keeps its own copy (T125). */
      copy: (): boolean => {
        if (!has) return false;
        clipboard.current = snapshot();
        pastes.current = 0;
        notify.success(t.copied.replace('{count}', String(ids.length)));
        return true;
      },
      /** False when the board clipboard is empty, so the browser keeps its own paste (T125). */
      paste: (): boolean => {
        if (clipboard.current.length === 0) return false;
        pastes.current += 1;
        return paste(clipboard.current, PASTE_OFFSET * pastes.current);
      },
      selectAll: () => dispatch({ type: 'select', ids: parts.map((p) => p.id) }),
    };
  }, [state.selection, parts, project.parts, run, t.copyName, t.copied]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [role="combobox"], [role="dialog"]') !== null)
      ) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const step = e.shiftKey ? 10 : 1;
      let done = true;
      if (mod && !e.altKey && k === 'c') done = actions.copy();
      else if (mod && !e.altKey && k === 'v') done = actions.paste();
      else if (mod && !e.altKey && k === 'd') done = actions.duplicate();
      else if (mod && !e.altKey && k === 'a') actions.selectAll();
      else if (mod || e.altKey) done = false;
      else if (k === 'delete' || k === 'backspace')
        done = actions.has && actions.remove() !== false;
      else if (k === 'arrowleft') done = actions.has && actions.move(-step, 0) !== false;
      else if (k === 'arrowright') done = actions.has && actions.move(step, 0) !== false;
      else if (k === 'arrowup') done = actions.has && actions.move(0, step) !== false;
      else if (k === 'arrowdown') done = actions.has && actions.move(0, -step) !== false;
      else if (e.shiftKey && k === 'x') actions.mirrorH();
      else if (e.shiftKey && k === 'y') actions.mirrorV();
      else if (e.shiftKey && k === 'r') actions.rotate();
      else done = false;
      if (done) e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  const panMode = state.tool === 'pan' || spaceDown;
  const firstSelected = selected[0];
  const inspectorTitle =
    selected.length > 1
      ? t.inspector.many.replace('{count}', String(selected.length))
      : (firstSelected
          ? (project.parts.find((x) => x.id === firstSelected.id)?.name.trim() ?? '')
          : '') || t.inspector.title;
  const floating =
    'pointer-events-auto rounded-lg border border-border bg-surface/95 shadow-sm backdrop-blur-sm';

  // Tool rail (D-039): working tools in `fg`, the active one accent-filled; unbuilt tools are
  // not shown. Drawing tools stay active after a shape (repeat mode); Esc or V returns to Seç.
  const railTool = (tool: EditorTool, label: string, key: string, icon: ReactNode) => {
    const active = state.tool === tool;
    return (
      <Tooltip key={tool} side="right" content={`${label} · ${key}`}>
        <IconButton
          variant={active ? 'primary' : 'ghost'}
          aria-label={label}
          aria-pressed={active}
          aria-keyshortcuts={key}
          data-testid={`editor-tool-${tool}`}
          className={cn(!active && 'text-fg')}
          onClick={() => setTool(tool)}
        >
          {icon}
        </IconButton>
      </Tooltip>
    );
  };

  const overlay = (
    <>
      <div
        role="toolbar"
        aria-label={t.tools.label}
        aria-orientation="vertical"
        className={`${floating} absolute z-10 flex flex-col gap-0.5 p-0.5`}
        style={{ top: RULER_PX + 8 + (viewSwitch ? BAND_PX : 0), left: RULER_PX + 8 }}
      >
        {railTool('select', t.tools.select, 'V', <MousePointer2 aria-hidden />)}
        {railTool('pan', t.tools.pan, 'H', <Hand aria-hidden />)}
        <span aria-hidden className="mx-2 my-0.5 h-px bg-border" />
        {railTool('rect', t.tools.rect, 'R', <Square aria-hidden />)}
        {railTool('circle', t.tools.circle, 'C', <Circle aria-hidden />)}
        {railTool('line', t.tools.line, 'L', <PenLine aria-hidden />)}
        {railTool('arc', t.tools.arc, 'A', <Spline aria-hidden />)}
      </div>
      {viewSwitch ? (
        <div
          className={`${floating} absolute z-10 p-0.5`}
          style={{ top: RULER_PX + 8, left: RULER_PX + 8 }}
          data-testid="editor-view-switch"
        >
          {viewSwitch}
        </div>
      ) : null}
      <div
        className={`${floating} absolute right-2 z-10 flex items-center gap-0.5 p-0.5`}
        style={{ top: RULER_PX + 8 }}
      >
        <div className="flex h-8 items-center gap-1.5 px-2 text-xs text-fg-muted">
          <Checkbox
            id={gridId}
            checked={state.grid}
            onCheckedChange={(v) => dispatch({ type: 'grid', on: v === true })}
          />
          <label htmlFor={gridId} className="cursor-pointer max-sm:sr-only">
            {t.view.grid}
          </label>
        </div>
        <Tooltip content={t.view.zoomOut}>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t.view.zoomOut}
            aria-keyshortcuts="-"
            onClick={() => zoomBy(1 / 1.25)}
          >
            <ZoomOut aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content={t.view.zoomIn}>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t.view.zoomIn}
            aria-keyshortcuts="+"
            onClick={() => zoomBy(1.25)}
          >
            <ZoomIn aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content={`${t.view.fit} · F`}>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t.view.fit}
            aria-keyshortcuts="F"
            onClick={fit}
            data-testid="editor-fit"
          >
            <Maximize aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
      {bend && bendView && view ? (
        <DynamicInput
          t={t.draw}
          fields={['r']}
          values={[]}
          active={0}
          live={bendView.live}
          at={toScreen(view, bend.at)}
          docked={false}
          canvas={size}
          onChange={() => undefined}
          onFocusField={() => undefined}
          onCommit={() => undefined}
          onCancel={() => undefined}
        />
      ) : null}
      {drawTool ? (
        <DynamicInput
          t={t.draw}
          fields={fields}
          values={typed.values}
          active={typed.active}
          live={draftView?.live ?? {}}
          at={view && drawCursor ? toScreen(view, drawCursor) : null}
          docked={docked}
          canvas={size}
          onChange={(i, value) =>
            setTyped((s0) => {
              const values = [...s0.values];
              values[i] = value;
              return { ...s0, values };
            })
          }
          onFocusField={(i) => setTyped((s0) => ({ ...s0, active: i }))}
          onCommit={() => {
            if (drawTool && drawCursor) {
              applyStep(enter(drawTool, draft, drawCursor, typedValues, lock));
            }
          }}
          onCancel={() => {
            setTyped(NO_TYPED);
            setDraft(null);
          }}
        />
      ) : null}
      {parts.length === 0 && !drawTool ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className={`${floating} flex max-w-sm flex-col items-start gap-3 p-4`}>
            <p className="text-sm text-fg-muted">{t.empty}</p>
            <Button size="sm" variant="outline" onClick={onToList}>
              <List aria-hidden />
              {t.toList}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );

  const canvas = (
    <div
      ref={(node) => {
        box.current = node;
        setCanvasEl(node);
      }}
      role="application"
      aria-label={t.canvasLabel.replace('{count}', String(parts.length))}
      aria-roledescription="canvas"
      tabIndex={0}
      data-testid="editor-canvas"
      data-tool={state.tool}
      data-view={view ? `${view.scale},${view.x},${view.y}` : undefined}
      data-selection={state.selection.join(',')}
      className={cn(
        'absolute inset-0 touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
        panMode ? 'cursor-grab' : drawTool ? 'cursor-crosshair' : 'cursor-default',
      )}
      onPointerDown={onPointerDown}
      // Middle button pans the board: no browser autoscroll.
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setCursor(null);
        dispatch({ type: 'hover', id: null });
      }}
    >
      {view && colors && size.w > 0 ? (
        <CanvasBoundary>
          <EditorCanvas
            width={size.w}
            height={size.h}
            view={view}
            parts={parts}
            names={names}
            selection={selection}
            hover={state.hover}
            drag={drag}
            marquee={marquee}
            snap={snapMark}
            grid={state.grid}
            colors={colors}
            draft={bendView ?? draftView}
            draftLabel={bendView ? null : draftLabel}
            handles={bendHandles.map((h) => h.at)}
            drawText={{ close: t.draw.close, open: t.draw.open }}
          />
        </CanvasBoundary>
      ) : null}
    </div>
  );

  return (
    <WorkspaceLayout
      testId="editor-workspace"
      labels={t.workspace}
      leftHeader={
        <>
          <h2 className="truncate font-semibold text-fg">{t.parts.title}</h2>
          <span className="shrink-0 text-xs text-fg-muted tabular-nums">
            {t.parts.count.replace('{count}', String(project.parts.length))}
          </span>
        </>
      }
      rightHeader={
        <h2 className="truncate font-semibold text-fg" data-testid="editor-inspector-title">
          {inspectorTitle}
        </h2>
      }
      left={
        <BoardPartList
          t={t.parts}
          project={project}
          selection={selection}
          onSelect={(id, additive) =>
            dispatch(additive ? { type: 'toggle', id } : { type: 'select', ids: [id] })
          }
        />
      }
      right={
        <EditorInspector
          t={t.inspector}
          project={project}
          selected={selected}
          actions={{
            mirrorH: actions.mirrorH,
            mirrorV: actions.mirrorV,
            rotate: actions.rotate,
            duplicate: actions.duplicate,
            remove: actions.remove,
          }}
        />
      }
      canvas={canvas}
      canvasOverlay={overlay}
      canvasFooter={
        <StatusBar
          t={t}
          cursor={cursor}
          scale={view?.scale ?? 1}
          snap={state.snap}
          onSnap={(kind, on) => dispatch({ type: 'snap', kind, on })}
          hint={
            bend
              ? t.draw.hints.bend
              : drawTool
                ? t.draw.hints[hintFor(drawTool, draft, draftView)]
                : null
          }
          snapName={draftView?.closing ? t.draw.close : snapMark ? t.snap[snapMark.kind] : null}
        />
      }
    />
  );
}
