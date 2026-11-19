'use client';

import {
  boardBox,
  boardParts,
  arcOf,
  checkInnerContour,
  bulgeFromSagitta,
  circleOutline,
  nextPartName,
  segmentMidpoint,
  snap,
  tidy,
  type Part,
  type Project,
  type SnapKind,
} from '@nittcam/core';
import { Button, IconButton, Tooltip, cn, notify } from '@nittcam/ui';
import {
  Circle,
  CircleDot,
  Grid3x3,
  Hand,
  List,
  Maximize,
  MousePointer2,
  PenLine,
  Ruler,
  Spline,
  Square,
  SquareDashed,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Messages } from '../../lib/messages';
import { onThemeChange } from '../../lib/canvas-theme';
import { fill, newPartId } from '../../lib/draft-project';
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
import { claimPageGroup, claimPageKeys } from '../../lib/shortcuts';
import { EditorTour } from './editor-tour';
import { useMediaQuery } from '../../lib/use-media-query';
import { boxFrom, hitPart, partsInBox } from '../../lib/editor/hit';
import { addHoleParams, liveDiameter, type HoleDraft } from '../../lib/editor/hole-tool';
import { dimOwner, segmentLabels } from '../../lib/editor/dims';
import { innerHost, shapeVertices } from '../../lib/editor/inner-host';
import { InnerPrompt } from './inner-prompt';
import { miniBarRailClear } from '../../lib/editor/mini-bar';
import {
  SNAP_TOGGLES,
  editorReducer,
  initialEditorState,
  type EditorTool,
} from '../../lib/editor/store';
import {
  fitBox,
  fitTarget,
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
import { RULER_PX, type EditorFocus, type SnapGlyph } from './editor-canvas';
import { BoardActionBar, EditorInspector } from './inspector';
import type { SubSelection } from './properties';
import { boardSummary } from '../../lib/editor/summary';
import { BoardPartList } from './part-list';
import { StatusBar } from './status-bar';

const EditorCanvas = dynamic(() => import('./editor-canvas'), { ssr: false });

type T = Messages['editor'];

/**
 * Fit (T243): the parts' box (or the sheet without parts) with 48 px padding inside the area
 * right of the left ruler + tool rail and below the top ruler.
 */
const FIT_INSETS = { top: RULER_PX, right: 0, bottom: 0, left: RULER_PX + 24 };
const FIT_PADDING = 48;
/** Offset of a pasted / duplicated copy, mm (right and down). */
const PASTE_OFFSET = 20;
/** Height of the top toolbar band (view switch, zoom) plus its gap: the rail starts below it. */
const BAND_PX = 48;
/** Phone mini-toolbar over the selection (5 × 32 px buttons, separator, padding). */
const MINI_BAR = { w: 186, h: 38 };
/** Left edge of the floating tool rail inside the canvas, px. */
const RAIL_LEFT = RULER_PX + 8;
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
      // An open Select's listbox too: its Esc closes the list, not the board selection (T130).
      target.closest(
        'input, textarea, select, [role="combobox"], [role="listbox"], [role="dialog"]',
      ) !== null)
  );
}

/** Plain keys the board owns while open (global shortcuts skip them). */
const BOARD_KEYS = ['v', 'h', 'r', 'c', 'l', 'a', 'o', 'd', 'f', '+', '=', '-'] as const;

/** One pointer gesture on the canvas. */
type Gesture =
  | { kind: 'pan'; last: Pt }
  | { kind: 'pinch'; dist: number; mid: Pt }
  | { kind: 'marquee'; start: Pt; startScreen: Pt; additive: boolean; moved: boolean }
  /** `corner`: the press started on a corner node of the selected part (a click picks it). */
  | { kind: 'press'; id: string; start: Pt; startScreen: Pt; additive: boolean; corner?: number }
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
  toolDiameter,
  holeTool,
  initialSelection,
  onSelectionChange,
}: {
  t: T;
  project: Project;
  run: (command: string, params: unknown) => boolean;
  onToList: () => void;
  /** Cutting tool diameter of the selected machine, mm (inner-corner rule, dogbone; T131). */
  toolDiameter?: number;
  /** Tool of a newly drawn hole (T138): the stock material set's tool, else the cutting tool. */
  holeTool?: { number: number; diameter: number };
  /** Liste / Çizim switch placed in the canvas toolbar band (below 1024 px, T240). */
  viewSwitch?: ReactNode;
  /** Selected part ids when the board opens (shared with the cut list, T135). */
  initialSelection?: readonly string[];
  /** Reports every selection change (Liste ↔ Çizim keep one selection, T135). */
  onSelectionChange?: (ids: string[]) => void;
}) {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState, (s) => {
    const have = new Set(project.parts.map((p) => p.id));
    return { ...s, selection: (initialSelection ?? []).filter((id) => have.has(id)) };
  });
  const reportSelection = useRef(onSelectionChange);
  reportSelection.current = onSelectionChange;
  useEffect(() => reportSelection.current?.(state.selection), [state.selection]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Tool rail's rendered size: the phone mini-toolbar is kept clear of it (B10a).
  const [railEl, setRailEl] = useState<HTMLDivElement | null>(null);
  const [railSize, setRailSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!railEl) return;
    const measure = () => {
      const w = railEl.offsetWidth;
      const h = railEl.offsetHeight;
      setRailSize((r) => (r.w === w && r.h === h ? r : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(railEl);
    return () => ro.disconnect();
  }, [railEl]);
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
  // Fixed-grain parts show the layout canvas's grain arrow (T254); rotate / mirror turn the
  // stored angle (D-038), so the glyph follows them.
  const grains = useMemo(
    () =>
      new Map(
        project.parts.filter((p) => p.grain.mode === 'fixed').map((p) => [p.id, p.grain.angle]),
      ),
    [project.parts],
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
  // Dimension tool (T133): the first picked point; the second click adds the dimension.
  const dimTool = state.tool === 'dim';
  const [dimA, setDimA] = useState<Pt | null>(null);
  const docked = useMediaQuery('(max-width: 639px)', false);
  // Hole tool (T138): first click sets the centre on a part, the diameter follows the cursor,
  // the second click adds the hole (one `addHole`).
  const holeOn = state.tool === 'hole';
  const [holeDraft, setHoleDraft] = useState<HoleDraft | null>(null);
  const holeToolDia = holeTool?.diameter ?? toolDiameter ?? 0;
  const holeD = holeDraft && drawAt ? liveDiameter(holeDraft.c, drawAt, holeToolDia) : null;
  const holeView: DraftView | null =
    holeDraft && holeD !== null
      ? {
          vertices: circleOutline(holeD / 2).map((v) => ({
            ...v,
            x: v.x + holeDraft.c.x - holeD / 2,
            y: v.y + holeDraft.c.y - holeD / 2,
          })),
          closed: true,
          rubber: null,
          nodes: [],
          closing: false,
          open: false,
          centre: holeDraft.c,
          live: {},
        }
      : null;
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
  const summary = useMemo(
    () => boardSummary(parts, new Map(project.parts.map((p) => [p.id, p.qty]))),
    [parts, project.parts],
  );

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

  // Properties panel (T130): a segment or vertex of the single selected part. It is dropped when
  // the selection changes; an index past the outline (after an edit or undo) shows nothing.
  const single = selected.length === 1 ? selected[0] : undefined;
  const [sub, setSub] = useState<SubSelection>(null);
  const singleId = single?.id ?? null;
  const [subOwner, setSubOwner] = useState<string | null>(singleId);
  if (subOwner !== singleId) {
    setSubOwner(singleId);
    setSub(null);
  }
  const subShown = sub && single && sub.index < single.outline.length ? sub : null;
  /** Corner nodes of the selected part (square handles; a click picks the vertex). */
  const vertexHandles = useMemo(
    () =>
      state.tool === 'select' && single && !drag
        ? single.outline.map((v) => ({ x: v.x, y: v.y }))
        : [],
    [state.tool, single, drag],
  );
  const focusMark = useMemo((): EditorFocus | null => {
    if (!subShown || !single) return null;
    const vs = single.outline;
    const a = vs[subShown.index];
    if (!a) return null;
    if (subShown.kind === 'vertex') return { kind: 'vertex', at: { x: a.x, y: a.y } };
    const b = vs[(subShown.index + 1) % vs.length] ?? a;
    return { kind: 'segment', p0: { x: a.x, y: a.y }, p1: { x: b.x, y: b.y }, bulge: a.bulge };
  }, [subShown, single]);

  // Selected ids that disappear (removed, undone) leave the selection.
  const ids = useMemo(() => project.parts.map((p) => p.id), [project.parts]);
  useEffect(() => dispatch({ type: 'prune', ids }), [ids]);

  // The project's stock sheet as a reference outline (T243, D-039): view only.
  const stock = project.stock.sheet;
  const sheetBox = useMemo(
    () => ({ minX: 0, minY: 0, maxX: stock.width, maxY: stock.height }),
    [stock.width, stock.height],
  );
  const touched = useRef(false);
  // Stable for the memoised part list rows (T137).
  const selectFromList = useCallback(
    (id: string, additive: boolean) =>
      dispatch(additive ? { type: 'toggle', id } : { type: 'select', ids: [id] }),
    [],
  );
  const fit = useCallback(() => {
    touched.current = false;
    if (size.w > 0 && size.h > 0) {
      const top = FIT_INSETS.top + (viewSwitch ? BAND_PX : 0);
      dispatch({
        type: 'view',
        view: fitBox(
          fitTarget(bounds, state.sheet ? sheetBox : null) ?? sheetBox,
          size.w,
          size.h,
          { ...FIT_INSETS, top },
          FIT_PADDING,
        ),
      });
    }
  }, [bounds, sheetBox, state.sheet, size.w, size.h, viewSwitch]);
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
  }, [size.w, size.h, hasParts, state.sheet]);
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
    setHoleDraft(null);
    setTyped(NO_TYPED);
    setSnapMark(null);
    setDimA(null);
    setDraft((d) =>
      d?.kind === 'path' && (tool === 'line' || tool === 'arc') ? { ...d, pending: null } : null,
    );
  }, []);

  // A closed shape drawn inside a part (T134): ask "iç kesim olarak ekle?" first.
  const [innerAsk, setInnerAsk] = useState<{ shape: DrawnShape; host: string } | null>(null);

  /** Finished shape: inside a part → ask (cut-out or part); elsewhere → a new part (T127). */
  function commitShape(shape: DrawnShape) {
    const host = innerHost(parts, shapeVertices(shape));
    if (host) setInnerAsk({ shape, host });
    else addShapePart(shape);
  }

  /** Adds the shape as that part's inner contour; a refused one says why (T134). */
  function addShapeInner(shape: DrawnShape, host: string) {
    const part = parts.find((p) => p.id === host);
    if (!part) return;
    const vertices = shapeVertices(shape);
    const err = checkInnerContour(part.outline, part.inners, vertices, toolDiameter ?? 0);
    if (err) {
      notify.error(fill(t.inner.errors[err], { d: formatMm(toolDiameter ?? 0) }));
      return;
    }
    if (run('addInnerContour', { id: host, vertices, toolDiameter: toolDiameter ?? 0 })) {
      dispatch({ type: 'select', ids: [host] });
    }
  }

  /** Adds a finished shape as a part with the next free name and selects it (T127). */
  function addShapePart(shape: DrawnShape) {
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

  // Hole tool: Esc drops the centre in progress, a second Esc returns to Seç.
  useEffect(() => {
    if (!holeOn) return;
    function onKey(e: KeyboardEvent) {
      if (typing(e.target) || e.key !== 'Escape') return;
      if (holeDraft) setHoleDraft(null);
      else setTool('select');
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
      else if (k === 'o' && !e.shiftKey) setTool('hole');
      else if (k === 'd' && !e.shiftKey) setTool('dim');
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
    // T136: "?" on the board opens the board's own shortcut sheet.
    const releaseGroup = claimPageGroup('board');
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      release();
      releaseGroup();
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
    if (holeOn) {
      const { point } = drawPoint(w, e.altKey);
      setDrawAt(point);
      if (!holeDraft) {
        const id = hitPart(parts, point, 0);
        if (id) setHoleDraft({ partId: id, c: point });
        else notify.error(t.holeRefused);
        return;
      }
      const params = addHoleParams(
        project,
        holeDraft,
        liveDiameter(holeDraft.c, point, holeToolDia),
        holeTool?.number ?? 1,
      );
      if (!params || !run('addHole', params)) notify.error(t.holeRefused);
      setHoleDraft(null);
      return;
    }
    if (dimTool) {
      placeDim(drawPoint(w, e.altKey).point);
      return;
    }
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
    // A corner node picks that vertex for the properties panel (T130).
    const corner = vertexHandles.findIndex((h) => dist(toScreen(view, h), s) <= reach);
    const handle = bendHandles.find((h) => dist(toScreen(view, h.at), s) <= reach);
    if (handle) {
      gesture.current = { kind: 'bend', ...handle };
      setBend({ id: handle.id, index: handle.index, bulge: handle.bulge, at: w });
      return;
    }
    const hit = hitPart(parts, w, 4 / view.scale);
    if (hit && (corner < 0 || hit !== single?.id || e.shiftKey)) {
      gesture.current = { kind: 'press', id: hit, start: w, startScreen: s, additive: e.shiftKey };
      return;
    }
    if (corner >= 0 && single) {
      gesture.current = {
        kind: 'press',
        id: single.id,
        start: w,
        startScreen: s,
        additive: false,
        corner,
      };
      return;
    }
    // Empty canvas: one finger pans on touch; mouse/pen draws a selection box.
    gesture.current =
      e.pointerType === 'touch'
        ? { kind: 'pan', last: s }
        : { kind: 'marquee', start: w, startScreen: s, additive: e.shiftKey, moved: false };
  }

  /**
   * Dimension tool (T133): the first click picks a, the second adds the dimension a–b to the part
   * whose box holds both points (the selected one first) and selects it. Esc drops the first point.
   */
  function placeDim(point: Pt) {
    if (!dimA) {
      setDimA(point);
      return;
    }
    setDimA(null);
    if (Math.hypot(point.x - dimA.x, point.y - dimA.y) < 1e-3) return;
    const owner = dimOwner(parts, dimA, point, singleId);
    if (!owner) {
      notify.info(t.dim.noPart);
      return;
    }
    const a = { x: tidy(dimA.x), y: tidy(dimA.y) };
    const b = { x: tidy(point.x), y: tidy(point.y) };
    if (run('addDimension', { id: owner, dimId: newPartId().replace(/^p-/, 'd-'), a, b })) {
      dispatch({ type: 'select', ids: [owner] });
    }
  }

  // Dimension tool keys: Esc drops the first point, a second Esc returns to Seç.
  useEffect(() => {
    if (!dimTool) return;
    function onKey(e: KeyboardEvent) {
      if (typing(e.target) || e.key !== 'Escape') return;
      if (dimA) setDimA(null);
      else setTool('select');
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dimTool, dimA, setTool]);

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
    if (((drawTool || dimTool) && (!g || g.kind === 'draw')) || (holeOn && !g)) {
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
      } else {
        // A click on the segment middle (no bend) picks the segment for the properties panel.
        setSub({ kind: 'segment', index: g.index });
      }
      return;
    }
    if (g.kind === 'press' && g.corner !== undefined) {
      setSub({ kind: 'vertex', index: g.corner });
    } else if (g.kind === 'press') {
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
          // An open Select's listbox too: its Esc closes the list, not the board selection (T130).
          target.closest(
            'input, textarea, select, [role="combobox"], [role="listbox"], [role="dialog"]',
          ) !== null)
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

  // Phones (T242): the selection's actions float above it in the canvas, so mirror / rotate /
  // duplicate / delete do not need the "Özellikler" sheet. Kept inside the canvas.
  const editActions = {
    mirrorH: actions.mirrorH,
    mirrorV: actions.mirrorV,
    rotate: actions.rotate,
    duplicate: actions.duplicate,
    remove: actions.remove,
  };
  let miniBar: ReactNode = null;
  if (docked && view && state.tool === 'select' && selected.length > 0 && !drag && size.w > 0) {
    const sb = selected.reduce(
      (a, x) => ({
        minX: Math.min(a.minX, x.box.minX),
        minY: Math.min(a.minY, x.box.minY),
        maxX: Math.max(a.maxX, x.box.maxX),
        maxY: Math.max(a.maxY, x.box.maxY),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const tl = toScreen(view, { x: sb.minX, y: sb.maxY });
    const br = toScreen(view, { x: sb.maxX, y: sb.minY });
    const w = MINI_BAR.w;
    const h = MINI_BAR.h;
    const minTop = RULER_PX + 8 + (viewSwitch ? BAND_PX : 0);
    const maxTop = size.h - h - 8;
    let top = tl.y - h - 8;
    if (top < minTop) top = br.y + 8;
    top = Math.min(Math.max(top, minTop), Math.max(minTop, maxTop));
    const maxLeft = size.w - w - 4;
    let left = Math.min(Math.max((tl.x + br.x) / 2 - w / 2, RULER_PX + 4), maxLeft);
    // Never cover the tool rail (its tools stay tappable): shift right of it, else below it.
    const rail = miniBarRailClear(
      { left, top, w, h },
      { left: RAIL_LEFT, top: minTop, w: railSize.w, h: railSize.h },
      { maxLeft, maxTop },
    );
    left = rail.left;
    top = rail.top;
    miniBar = (
      <div
        className={`${floating} absolute z-20 p-0.5`}
        style={{ top, left: Math.max(4, left) }}
        data-testid="editor-mini-toolbar"
      >
        <BoardActionBar
          t={t.inspector}
          label={t.actionsBar}
          actions={editActions}
          testId="editor-mini"
        />
      </div>
    );
  }

  const overlay = (
    <>
      <EditorTour t={t.tour} onClose={() => canvasEl?.focus({ preventScroll: true })} />
      <div
        role="toolbar"
        aria-label={t.tools.label}
        aria-orientation="vertical"
        className={`${floating} absolute z-10 flex flex-col gap-0.5 p-0.5`}
        style={{ top: RULER_PX + 8 + (viewSwitch ? BAND_PX : 0), left: RAIL_LEFT }}
        ref={setRailEl}
        data-testid="editor-tool-rail"
      >
        {railTool('select', t.tools.select, 'V', <MousePointer2 aria-hidden />)}
        {railTool('pan', t.tools.pan, 'H', <Hand aria-hidden />)}
        <span aria-hidden className="mx-2 my-0.5 h-px bg-border" />
        {railTool('rect', t.tools.rect, 'R', <Square aria-hidden />)}
        {railTool('circle', t.tools.circle, 'C', <Circle aria-hidden />)}
        {railTool('line', t.tools.line, 'L', <PenLine aria-hidden />)}
        {railTool('arc', t.tools.arc, 'A', <Spline aria-hidden />)}
        {railTool('hole', t.tools.hole, 'O', <CircleDot aria-hidden />)}
        <span aria-hidden className="mx-2 my-0.5 h-px bg-border" />
        {railTool('dim', t.tools.dim, 'D', <Ruler aria-hidden />)}
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
        {/* T243: grid and sheet are icon toggles like zoom / fit, at every width. */}
        <Tooltip content={t.view.grid}>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t.view.grid}
            aria-pressed={state.grid}
            data-testid="editor-grid"
            className={cn(state.grid && 'bg-accent-subtle text-accent-text hover:text-accent-text')}
            onClick={() => dispatch({ type: 'grid', on: !state.grid })}
          >
            <Grid3x3 aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content={t.view.sheet}>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t.view.sheet}
            aria-pressed={state.sheet}
            data-testid="editor-sheet"
            className={cn(
              state.sheet && 'bg-accent-subtle text-accent-text hover:text-accent-text',
            )}
            onClick={() => dispatch({ type: 'sheet', on: !state.sheet })}
          >
            <SquareDashed aria-hidden />
          </IconButton>
        </Tooltip>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
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
      {miniBar}
      <InnerPrompt
        t={t.inner}
        partName={
          innerAsk
            ? project.parts.find((p) => p.id === innerAsk.host)?.name.trim() || t.parts.unnamed
            : null
        }
        onInner={() => {
          if (innerAsk) addShapeInner(innerAsk.shape, innerAsk.host);
        }}
        onPart={() => {
          if (innerAsk) addShapePart(innerAsk.shape);
        }}
        onCancel={() => setInnerAsk(null)}
      />
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
        // T254: the focus ring is an overlay above the Konva stage, so all four sides show
        // (an inset box-shadow on this element is painted under the canvas). An inset outline,
        // not a ring, so it stays visible in forced-colors mode.
        'absolute inset-0 touch-none overflow-hidden outline-none select-none',
        'focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:z-10 focus-visible:after:outline-solid focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus',
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
            sheet={
              state.sheet
                ? {
                    w: stock.width,
                    h: stock.height,
                    label: t.view.sheetLabel
                      .replace('{w}', formatMm(stock.width))
                      .replace('{h}', formatMm(stock.height)),
                  }
                : null
            }
            colors={colors}
            draft={bendView ?? holeView ?? draftView}
            draftLabel={bendView ? null : holeD !== null ? `Ø ${formatMm(holeD)}` : draftLabel}
            handles={bendHandles.map((h) => h.at)}
            corners={vertexHandles}
            grains={grains}
            focus={focusMark}
            segmentLabels={
              state.tool === 'select' && single && view && !drag && !bend
                ? segmentLabels(
                    single.outline,
                    single.inners,
                    view.scale,
                    subShown?.kind === 'segment' ? subShown.index : null,
                  )
                : null
            }
            dimPreview={dimTool && dimA && drawAt ? { a: dimA, b: drawAt } : null}
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
          onSelect={selectFromList}
        />
      }
      right={
        <EditorInspector
          t={t.inspector}
          project={project}
          selected={selected}
          summary={summary}
          actions={editActions}
          run={run}
          sub={subShown}
          onSub={setSub}
          toolRadius={toolDiameter ? toolDiameter / 2 : 0}
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
              : holeOn
                ? t.holeHint
                : drawTool
                  ? t.draw.hints[hintFor(drawTool, draft, draftView)]
                  : dimTool
                    ? dimA
                      ? t.dim.hintSecond
                      : t.dim.hintFirst
                    : // T136: the hint bar speaks for every tool, not only the drawing ones.
                      state.tool === 'pan'
                      ? t.draw.hints.pan
                      : t.draw.hints.select
          }
          snapName={draftView?.closing ? t.draw.close : snapMark ? t.snap[snapMark.kind] : null}
        />
      }
    />
  );
}
