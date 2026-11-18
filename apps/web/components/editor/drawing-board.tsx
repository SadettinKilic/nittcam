'use client';

import { boardBox, boardParts, snap, type Part, type Project } from '@nittcam/core';
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
import { boxFrom, hitPart, partsInBox } from '../../lib/editor/hit';
import {
  SNAP_TOGGLES,
  editorReducer,
  initialEditorState,
  type EditorTool,
} from '../../lib/editor/store';
import { fitBox, gridLevels, toWorld, type Box, type Pt } from '../../lib/editor/viewport';
import { CanvasBoundary } from '../feedback/canvas-boundary';
import { WorkspaceLayout } from '../wizard/workspace-layout';
import { readEditorColors, type EditorColors } from './colors';
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
/** Snap capture distance on screen, px. */
const SNAP_PX = 10;
/** Pointer movement that turns a click into a drag, px. */
const DRAG_PX = 3;

/** One pointer gesture on the canvas. */
type Gesture =
  | { kind: 'pan'; last: Pt }
  | { kind: 'pinch'; dist: number; mid: Pt }
  | { kind: 'marquee'; start: Pt; startScreen: Pt; additive: boolean; moved: boolean }
  | { kind: 'press'; id: string; start: Pt; startScreen: Pt; additive: boolean }
  | { kind: 'move'; ids: string[]; start: Pt; anchor: Pt };

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
}: {
  t: T;
  project: Project;
  run: (command: string, params: unknown) => boolean;
  onToList: () => void;
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

  const setTool = useCallback((tool: EditorTool) => dispatch({ type: 'tool', tool }), []);

  // Board keys (not while typing): V select, H pan, F fit, +/- zoom, Esc clears, Space pans.
  useEffect(() => {
    function typing(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [role="combobox"], [role="dialog"]') !== null)
      );
    }
    function onKey(e: KeyboardEvent) {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        setSpaceDown(true);
      } else if (k === 'v') setTool('select');
      else if (k === 'h') setTool('pan');
      else if (k === 'f') fit();
      else if (k === '+' || k === '=') zoomBy(1.25);
      else if (k === '-') zoomBy(1 / 1.25);
      else if (k === 'escape') dispatch({ type: 'clear' });
      else return;
    }
    function onUp(e: KeyboardEvent) {
      if (e.key === ' ') setSpaceDown(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
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

  const selected = useMemo(() => parts.filter((p) => selection.has(p.id)), [parts, selection]);

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
    const paste = (src: readonly Part[], offset: number) => {
      if (src.length === 0) return;
      const copies = src.map((p) => ({
        ...structuredClone(p),
        id: newPartId(),
        name: p.name.trim() ? t.copyName.replace('{name}', p.name.trim()) : p.name,
        draw: { x: (p.draw?.x ?? 0) + offset, y: (p.draw?.y ?? 0) - offset },
      }));
      if (run('pasteParts', { parts: copies })) {
        dispatch({ type: 'select', ids: copies.map((c) => c.id) });
      }
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
      copy: () => {
        if (!has) return;
        clipboard.current = snapshot();
        pastes.current = 0;
        notify.success(t.copied.replace('{count}', String(ids.length)));
      },
      paste: () => {
        pastes.current += 1;
        paste(clipboard.current, PASTE_OFFSET * pastes.current);
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
      if (mod && !e.altKey && k === 'c') actions.copy();
      else if (mod && !e.altKey && k === 'v') actions.paste();
      else if (mod && !e.altKey && k === 'd') actions.duplicate();
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
  const floating =
    'pointer-events-auto rounded-lg border border-border bg-surface/95 shadow-sm backdrop-blur-sm';

  const railTool = (
    tool: EditorTool | null,
    label: string,
    key: string,
    icon: ReactNode,
    soon = false,
  ) => {
    const active = tool !== null && state.tool === tool;
    const name = soon ? t.tools.soon.replace('{tool}', label) : label;
    return (
      <Tooltip key={label} side="right" content={`${name} · ${key}`}>
        <IconButton
          variant={active ? 'secondary' : 'ghost'}
          aria-label={name}
          aria-pressed={tool !== null ? active : undefined}
          aria-keyshortcuts={key}
          disabled={soon}
          data-testid={tool ? `editor-tool-${tool}` : undefined}
          className={cn(active && 'bg-accent-subtle text-accent-text')}
          onClick={tool ? () => setTool(tool) : undefined}
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
        style={{ top: RULER_PX + 8, left: RULER_PX + 8 }}
      >
        {railTool('select', t.tools.select, 'V', <MousePointer2 aria-hidden />)}
        {railTool('pan', t.tools.pan, 'H', <Hand aria-hidden />)}
        <span aria-hidden className="mx-2 my-0.5 h-px bg-border" />
        {railTool(null, t.tools.rect, 'R', <Square aria-hidden />, true)}
        {railTool(null, t.tools.circle, 'C', <Circle aria-hidden />, true)}
        {railTool(null, t.tools.line, 'L', <PenLine aria-hidden />, true)}
        {railTool(null, t.tools.arc, 'A', <Spline aria-hidden />, true)}
      </div>
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
      {parts.length === 0 ? (
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
      data-view={view ? `${view.scale},${view.x},${view.y}` : undefined}
      data-selection={state.selection.join(',')}
      className={cn(
        'absolute inset-0 touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
        panMode ? 'cursor-grab' : 'cursor-default',
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
          />
        </CanvasBoundary>
      ) : null}
    </div>
  );

  return (
    <WorkspaceLayout
      testId="editor-workspace"
      labels={t.workspace}
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
        />
      }
    />
  );
}
