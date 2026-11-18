'use client';

import { boardBox, boardParts, type Project } from '@nittcam/core';
import { Button, Checkbox, IconButton, Tooltip, cn } from '@nittcam/ui';
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
import { boxFrom, hitPart, partsInBox } from '../../lib/editor/hit';
import { editorReducer, initialEditorState, type EditorTool } from '../../lib/editor/store';
import { fitBox, toWorld, type Box, type Pt } from '../../lib/editor/viewport';
import { CanvasBoundary } from '../feedback/canvas-boundary';
import { WorkspaceLayout } from '../wizard/workspace-layout';
import { readEditorColors, type EditorColors } from './colors';
import { RULER_PX } from './editor-canvas';
import { EditorInspector } from './inspector';
import { BoardPartList } from './part-list';
import { StatusBar } from './status-bar';

const EditorCanvas = dynamic(() => import('./editor-canvas'), { ssr: false });

type T = Messages['editor'];

/** Screen area kept free of the drawing when fitting: rulers, tool rail, view toolbar. */
const FIT_INSETS = { top: RULER_PX + 56, right: 16, bottom: 16, left: RULER_PX + 64 };
/** Pointer movement that turns a click into a drag, px. */
const DRAG_PX = 3;

/** One pointer gesture on the canvas. */
type Gesture =
  | { kind: 'pan'; last: Pt }
  | { kind: 'pinch'; dist: number; mid: Pt }
  | { kind: 'marquee'; start: Pt; startScreen: Pt; additive: boolean; moved: boolean }
  | { kind: 'press'; id: string; startScreen: Pt; additive: boolean };

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
  const [spaceDown, setSpaceDown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
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

  const fit = useCallback(() => {
    if (size.w > 0 && size.h > 0) {
      dispatch({ type: 'view', view: fitBox(bounds, size.w, size.h, FIT_INSETS) });
    }
  }, [bounds, size.w, size.h]);

  // The canvas fills its workspace cell; the first size fits the board.
  useEffect(() => {
    const el = box.current;
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
  }, []);
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || size.w === 0) return;
    fitted.current = true;
    fit();
  }, [fit, size.w]);
  useEffect(() => onThemeChange(() => setColors((c) => (c ? readEditorColors() : c))), []);

  const zoomBy = useCallback(
    (factor: number, at?: Pt) => {
      dispatch({ type: 'zoom', factor, at: at ?? { x: size.w / 2, y: size.h / 2 } });
    },
    [size.w, size.h],
  );

  // Wheel / trackpad pinch zooms at the cursor (non-passive so the page does not scroll).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      dispatch({ type: 'zoom', factor: Math.exp(-e.deltaY * 0.0015), at });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

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
      gesture.current = { kind: 'press', id: hit, startScreen: s, additive: e.shiftKey };
      return;
    }
    // Empty canvas: one finger pans on touch; mouse/pen draws a selection box.
    gesture.current =
      e.pointerType === 'touch'
        ? { kind: 'pan', last: s }
        : { kind: 'marquee', start: w, startScreen: s, additive: e.shiftKey, moved: false };
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
      dispatch({ type: 'pan', dx: s.x - g.last.x, dy: s.y - g.last.y });
      g.last = s;
    } else if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2 || !pts[0] || !pts[1]) return;
      const d = dist(pts[0], pts[1]);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      dispatch({ type: 'pan', dx: mid.x - g.mid.x, dy: mid.y - g.mid.y });
      dispatch({ type: 'zoom', factor: d / Math.max(g.dist, 1), at: mid });
      gesture.current = { kind: 'pinch', dist: d, mid };
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
      ref={box}
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
            drag={null}
            marquee={marquee}
            snap={null}
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
      right={<EditorInspector t={t.inspector} project={project} selected={selected} />}
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
