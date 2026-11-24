'use client';

import { CanvasBoundary } from '../feedback/canvas-boundary';
import {
  effectiveSpacing,
  checkPlacement,
  nestingEngineOf,
  partNumber,
  placementIsValid,
  summarizeLayout,
  type PlacementCheck,
  type Project,
  type ValidationIssue,
  sheetSizeOf,
} from '@nittcam/core';
import dynamic from 'next/dynamic';
import {
  memo,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Button,
  InspectorRow,
  InspectorRows,
  Popover,
  PopoverContent,
  PopoverTrigger,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  cn,
} from '@nittcam/ui';
import {
  Box,
  Focus,
  Grid3x3,
  Info,
  Lock,
  LockOpen,
  Maximize,
  RefreshCw,
  Square,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Preview3D } from '../preview3d/preview3d';
import { useView3d } from '../../lib/preview3d/view-memory';
import type { TableSpec } from '../../lib/preview3d/stage';
import { onThemeChange } from '../../lib/canvas-theme';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import { clampScale, zoomAt } from './zoom';
import { PlateTabStrip } from '../wizard/plate-tab-strip';
import { WorkspaceLayout } from '../wizard/workspace-layout';
import { scaleBar } from '../../lib/canvas-labels';
import { nextRotation, snapToNeighbours } from '../../lib/layout-edit';
import { canvasTouchClass, isZoomedIn, useMediaQuery } from '../../lib/use-media-query';
import {
  copyKey,
  drawnParts,
  fitView,
  jobBox,
  readColors,
  sheetFigures,
  turnedPart,
  type CanvasColors,
  type DrawnPart,
  type ViewState,
} from './model';

// Memoised (B22): a "Diz" run toggles `renesting` and messages on this view; the canvas with its
// many shapes must not redraw on the main thread for that (long tasks with 1500 copies).
const LayoutCanvas = memo(dynamic(() => import('./layout-canvas'), { ssr: false }));

type Text = Messages['layout'];

/** Params of `lockPlacement` the view sends. */
export interface LockRequest {
  partId: string;
  index: number;
  x?: number;
  y?: number;
  /** New angle (T170, R key): only one of the part's allowed rotations. */
  rot?: number;
  locked: boolean;
}

/** A placed copy (multi-select lock/unlock, T170). */
export interface PlacementRef {
  partId: string;
  index: number;
}

export interface LayoutViewProps {
  t: Text;
  project: Project;
  /** Cutting tool diameter (mm) for the spacing check of a drop. */
  toolDiameter: number;
  /** Rule validation of the project (LOCKED_PLACEMENT_INVALID is shown here). */
  issues?: readonly ValidationIssue[];
  /** Runs `lockPlacement`; false when it was rejected. Without it the view is read-only. */
  onLock?: (request: LockRequest) => boolean;
  /** Runs `lockPlacements` for a multi-selection (T170, one undo step); false when rejected. */
  onLockMany?: (refs: PlacementRef[], locked: boolean) => boolean;
  /** "Yeniden diz": re-nests keeping the locked parts. Hidden when missing. */
  onRenest?: () => void;
  /** Bumped after each new "Diz" result; the parts fade/settle in (T196). */
  appearKey?: number;
  /** Settings panel shown left of the canvas in the workspace (T197). */
  left?: ReactNode;
  /** Below 1024 px: the main action kept next to the panel buttons ("Diz"), T198. */
  compactAction?: ReactNode;
  /**
   * 3D preview (T152, spec §3.8): shows the 2D/3D switch; `table` is the machine table (null =
   * no machine yet). Without it the view is 2D only (e.g. inside the simulation).
   */
  preview3d?: { table: TableSpec | null };
}

const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const pctFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const lengthFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** From this many sheets the layout view offers the all-sheets minimap (T171). */
const MINIMAP_FROM = 3;

/** Vertical room kept at fit for the one-row plate tabs + tools (top) and the legend (bottom), T244. */
const FIT_BAND = 24;

/** Thin utilisation bar along the bottom of a plate tab: accent fill, `warning` under 50 % (T196). */
function UsageBar({ used }: { used: number }) {
  const pct = Math.max(0, Math.min(100, used));
  return (
    <span
      aria-hidden="true"
      data-testid="sheet-usage"
      data-usage={Math.round(pct)}
      className="absolute inset-x-2 bottom-0.5 h-0.5 overflow-hidden rounded-full bg-border-subtle"
    >
      <span
        className={`block h-full rounded-full ${pct < 50 ? 'bg-warning' : 'bg-accent'}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/** Radix Select items cannot use an empty value; this stands for "no part". */
const NONE = '__none__';
const LOCKED_PATH = /^layout\.sheets\[(\d+)\]\.placements\[(\d+)\]$/;

/** Placement validation codes listed on Dizilim, with their `layout` text key. */
const PLACEMENT_ISSUE_TEXT = {
  LOCKED_PLACEMENT_INVALID: 'lockedIssue',
  LOCKED_PLACEMENT_GRAIN: 'lockedGrainIssue',
  PLACEMENT_GRAIN: 'placementGrainIssue',
} as const;
type PlacementIssueCode = keyof typeof PLACEMENT_ISSUE_TEXT;

/**
 * Layout view (T013, spec §3.6 step 3, §6.2 "Elle müdahale"): the sheet with its margin band and
 * waste, numbered parts, grain arrows, sheet tabs, zoom/pan, and manual placement. A drop or an
 * Enter after keyboard nudges is checked with core `checkPlacement` (the same check as the
 * `LOCKED_PLACEMENT_INVALID` rule); a valid one runs `lockPlacement` (one undo step), an invalid
 * one is refused and the part stays where it was. Without `onLock` the view only displays a
 * layout (reused by the simulation, T020).
 */
function LayoutViewImpl({
  t,
  project,
  toolDiameter,
  issues = [],
  onLock,
  onLockMany,
  onRenest,
  appearKey = 0,
  left,
  compactAction,
  preview3d,
}: LayoutViewProps) {
  const coarse = useMediaQuery('(pointer: coarse)', false);
  const selectId = useId();
  const count = project.layout.sheets.length;
  const [sheetState, setSheet] = useState(0);
  const sheet = Math.min(sheetState, Math.max(0, count - 1));
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  // T170: unsaved angle of the selected part (R key), and the further parts of a multi-selection.
  const [pendingRot, setPendingRot] = useState<number | null>(null);
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set());
  const [dragCheck, setDragCheck] = useState<{ key: string; check: PlacementCheck } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [grid, setGrid] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const width = size.w;
  const cursor = useRef<HTMLSpanElement>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [colors, setColors] = useState<CanvasColors | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // T152: 2D/3D switch. Without WebGL2 (or after a failed scene) the 2D view stays, with a note.
  // T160: the mode and the 3D camera are shared with the other wizard panels (view-memory).
  const { mode, show3d, noWebGL, camera, chooseMode, preset, fallback } = useView3d(
    preview3d !== undefined,
  );
  const pt = t.preview3d;

  const stock = useMemo(() => sheetSizeOf(project, sheet), [project, sheet]);
  const height = size.h;
  const parts = useMemo(() => drawnParts(project, sheet), [project, sheet]);
  const figures = useMemo(() => sheetFigures(parts), [parts]);
  const stored = useMemo(() => new Map(parts.map((p) => [p.key, p])), [parts]);
  // T170: the selected part drawn at its pending angle; only that one object changes, so the other
  // (memoised) shapes do not redraw.
  const shownParts = useMemo(
    () =>
      pendingRot === null || selected === null
        ? parts
        : parts.map((p) => (p.key === selected ? turnedPart(project, p, pendingRot) : p)),
    [parts, pendingRot, selected, project],
  );
  const byKey = useMemo(() => new Map(shownParts.map((p) => [p.key, p])), [shownParts]);
  const current = selected ? (byKey.get(selected) ?? null) : null;
  const anyLocked = useMemo(
    () => project.layout.sheets.some((sh) => sh.placements.some((pl) => pl.locked)),
    [project],
  );
  const summary = useMemo(() => summarizeLayout(project), [project]);
  const unplacedCount = summary.unplaced.length;
  const editable = onLock !== undefined;

  // B44 fit to job: a small job opens fitted to its parts; "Tümünü göster" shows the whole sheet.
  // The box is read at refit time only, so dragging a part never moves the view.
  const job = useMemo(() => jobBox(parts, stock), [parts, stock]);
  const jobRef = useRef(job);
  useEffect(() => {
    jobRef.current = job;
  });
  // Refit to the job when the set of parts changes (first nesting, renest, other sheet), not on a move.
  const jobKey = useMemo(
    () => `${sheet}|${parts.map((p) => p.key).join(',')}|${job ? 1 : 0}`,
    [sheet, parts, job],
  );

  // Width of the drawing = width of its box (fits 390 px screens); refit when it changes.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = { w: 0, h: 0 };
    // The canvas fills its workspace cell (T197): a new width or height refits the sheet.
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      const h = Math.floor(entries[0]?.contentRect.height ?? 0);
      if (w <= 0 || h <= 0 || (w === last.w && h === last.h)) return;
      last = { w, h };
      setColors((c) => c ?? readColors());
      setSize({ w, h });
      setView(fitView(stock, w, h, 30, FIT_BAND, jobRef.current));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stock]);
  // A theme switch re-reads the token colours, so the canvas follows light/dark live (T110).
  useEffect(() => onThemeChange(() => setColors((c) => (c ? readColors() : c))), []);

  /** Whole sheet ("Tümünü göster"). */
  const fit = useCallback(() => {
    if (width > 0 && height > 0) setView(fitView(stock, width, height, 30, FIT_BAND));
  }, [stock, width, height]);
  /** Default view: the job on a small job, else the sheet (B44). */
  const fitHome = useCallback(() => {
    if (width > 0 && height > 0)
      setView(fitView(stock, width, height, 30, FIT_BAND, jobRef.current));
  }, [stock, width, height]);
  useEffect(() => {
    fitHome();
    // Only a new set of parts refits; width/height changes are handled by the ResizeObserver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey]);

  function selectSheet(i: number) {
    setSheet(i);
    setSelected(null);
    setPending(null);
    setPendingRot(null);
    setMarked(new Set());
    setDragCheck(null);
    setMessage(null);
    fit();
  }

  const check = useCallback(
    (part: DrawnPart, x: number, y: number) =>
      checkPlacement(
        project,
        sheet,
        { partId: part.partId, index: part.index, x, y, rot: part.rot, locked: true },
        { toolDiameter, trueShape: nestingEngineOf(project) === 'trueShape' },
      ),
    [project, sheet, toolDiameter],
  );

  const reason = useCallback(
    (c: PlacementCheck): string => {
      if (c.outsideSheet) return t.drop.outsideSheet;
      if (c.inMargin)
        // D-129: the effective values checkPlacement uses (with tabs: margin Ø + 3, pay Ø + 3.1)
        return fill(t.drop.inMargin, {
          margin: mmFormat.format(effectiveSpacing(project, toolDiameter).margin),
        });
      const others = c.conflicts
        .map((r) => byKey.get(copyKey(r))?.label ?? `${r.partId}`)
        .join(', ');
      return fill(t.drop.conflict, {
        others,
        spacing: mmFormat.format(toolDiameter + effectiveSpacing(project, toolDiameter).gap),
      });
    },
    [t, project, toolDiameter, byKey],
  );

  /** Commits a move (drop or Enter). Returns false when refused. */
  // T281: the latest onLock through a ref, so a parent re-render (a new inline onLock) does not
  // hand the memoised canvas a new onDrop and redraw every shape (long tasks with 1500 copies).
  const lockRef = useRef(onLock);
  useEffect(() => {
    lockRef.current = onLock;
  }, [onLock]);
  const commit = useCallback(
    (part: DrawnPart, x: number, y: number): boolean => {
      setPending(null);
      setPendingRot(null);
      setDragCheck(null);
      const onLock = lockRef.current;
      if (!onLock) return false;
      const was = stored.get(part.key);
      const turned = was !== undefined && was.rot !== part.rot;
      if (x === part.x && y === part.y && !turned) {
        setMessage({ kind: 'ok', text: t.drop.unchanged });
        return true;
      }
      const c = check(part, x, y);
      if (!placementIsValid(c)) {
        setMessage({ kind: 'error', text: reason(c) });
        return false;
      }
      const req: LockRequest = { partId: part.partId, index: part.index, x, y, locked: true };
      if (turned) req.rot = part.rot;
      if (!onLock(req)) {
        setMessage({ kind: 'error', text: t.drop.rejected });
        return false;
      }
      setMessage({
        kind: 'ok',
        text: fill(t.drop.locked, {
          label: part.label,
          x: mmFormat.format(x),
          y: mmFormat.format(y),
        }),
      });
      return true;
    },
    [check, reason, t, stored],
  );

  const onViewChange = useCallback(
    (v: ViewState) => setView({ ...v, scale: clampScale(v.scale) }),
    [],
  );
  // Read inside onSelect without making it change on every click (the canvas is memoised).
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const onSelect = useCallback((key: string | null, additive?: boolean) => {
    // T170: Shift/Ctrl+click toggles a part in the multi-selection (the part selected before joins
    // it too); a plain click or a click on the empty sheet ends it.
    const prev = selectedRef.current;
    setMarked((m) => {
      if (!additive || key === null) return m.size === 0 ? m : new Set();
      const next = new Set(m);
      if (prev !== null && prev !== key && next.size === 0) next.add(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (prev !== key) setPendingRot(null);
    setSelected(key);
    setPending(null);
    setDragCheck(null);
  }, []);

  /** T170: snaps a dragged part next to its neighbours (tool diameter + gap) and the margins. */
  const snapRef = useRef<(part: DrawnPart, x: number, y: number) => { x: number; y: number }>(
    (_p, x, y) => ({ x, y }),
  );
  useEffect(() => {
    snapRef.current = (part, x, y) =>
      snapToNeighbours(
        part,
        x,
        y,
        parts.filter((o) => o.key !== part.key),
        {
          spacing: toolDiameter + effectiveSpacing(project, toolDiameter).gap,
          // A few screen pixels, but never more than 10 mm: a drop meant to stay free stays free.
          tolerance: view ? Math.min(6 / view.scale, 10) : 0,
        },
      );
  }, [parts, toolDiameter, project.nesting.gap, view]);

  const onDragMove = useCallback(
    (key: string, x: number, y: number, free?: boolean) => {
      const part = byKey.get(key);
      if (!part) return;
      const to = free ? { x, y } : snapRef.current(part, x, y);
      setSelected(key);
      setPending(to);
      setDragCheck({ key, check: check(part, to.x, to.y) });
      return to;
    },
    [byKey, check],
  );

  const onDrop = useCallback(
    (key: string, x: number, y: number, free?: boolean) => {
      const part = byKey.get(key);
      if (!part) return false;
      const to = free ? { x, y } : snapRef.current(part, x, y);
      return commit(part, to.x, to.y);
    },
    [byKey, commit],
  );

  /** T170 (R): turns the selected part to its next allowed angle, as a pending move. */
  function rotate() {
    if (!current) return;
    const next = nextRotation(project, current.partId, current.rot);
    if (next === null) {
      setMessage({ kind: 'error', text: fill(t.rotate.fixed, { label: current.label }) });
      return;
    }
    const base = pending ?? { x: current.x, y: current.y };
    const turned = turnedPart(project, current, next);
    setPendingRot(next);
    setPending(base);
    setDragCheck({ key: current.key, check: check(turned, base.x, base.y) });
    setMessage({ kind: 'ok', text: fill(t.rotate.turned, { label: current.label, rot: next }) });
  }

  /** T170: toggles the selected part in the multi-selection (Space). */
  function toggleMark() {
    if (!current) return;
    const key = current.key;
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** T170: locks or unlocks the multi-selection in one undo step. */
  function lockMarked(locked: boolean) {
    if (!onLockMany || marked.size === 0) return;
    const refs = [...marked].map((key) => {
      const cut = key.lastIndexOf('#');
      return { partId: key.slice(0, cut), index: Number(key.slice(cut + 1)) };
    });
    setPending(null);
    setPendingRot(null);
    setDragCheck(null);
    if (!onLockMany(refs, locked)) {
      setMessage({ kind: 'error', text: t.multi.rejected });
      return;
    }
    setMessage({
      kind: 'ok',
      text: fill(locked ? t.multi.locked : t.multi.unlocked, { n: refs.length }),
    });
  }

  function nudge(dx: number, dy: number) {
    if (!current) return;
    const base = pending ?? { x: current.x, y: current.y };
    const next = { x: base.x + dx, y: base.y + dy };
    setPending(next);
    setDragCheck({ key: current.key, check: check(current, next.x, next.y) });
    setMessage(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[e.key];
    if (move && current && editable) {
      e.preventDefault();
      nudge(move[0], move[1]);
    } else if (
      (e.key === 'r' || e.key === 'R') &&
      current &&
      editable &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      rotate();
    } else if (e.key === ' ' && current && onLockMany) {
      e.preventDefault();
      toggleMark();
    } else if (e.key === 'Enter' && current && pending) {
      e.preventDefault();
      commit(current, pending.x, pending.y);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (pending) {
        setPending(null);
        setPendingRot(null);
        setDragCheck(null);
      } else if (marked.size > 0) {
        setMarked(new Set());
      } else {
        setSelected(null);
      }
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomButton(1.25);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomButton(1 / 1.25);
    } else if (e.key === '0') {
      e.preventDefault();
      fitHome();
    }
  }

  function zoomButton(factor: number) {
    if (!view) return;
    setView(zoomAt(view, factor, width / 2, height / 2));
  }

  // Placements the rules flag (a locked copy after a part was enlarged, any copy the grain no longer
  // allows): listed and drawn red.
  const lockedIssues = issues
    .filter((i): i is typeof i & { code: PlacementIssueCode } => i.code in PLACEMENT_ISSUE_TEXT)
    .map((i) => {
      const m = LOCKED_PATH.exec(i.path);
      const s = Number(m?.[1]);
      const pl = project.layout.sheets[s]?.placements[Number(m?.[2])];
      return pl ? { sheet: s, key: copyKey(pl), code: i.code } : null;
    })
    .filter((x): x is { sheet: number; key: string; code: PlacementIssueCode } => x !== null);

  const conflicts = useMemo(() => {
    const set = new Set<string>();
    for (const li of lockedIssues) if (li.sheet === sheet) set.add(li.key);
    if (dragCheck && !placementIsValid(dragCheck.check)) {
      set.add(dragCheck.key);
      for (const r of dragCheck.check.conflicts) set.add(copyKey(r));
    }
    return set;
    // lockedIssues is derived from `issues`; recompute with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, project, sheet, dragCheck]);

  if (count === 0) return null;
  const labelOf = (key: string) => {
    const [partId, index] = [
      key.slice(0, key.lastIndexOf('#')),
      Number(key.slice(key.lastIndexOf('#') + 1)),
    ];
    const row = project.parts.findIndex((p) => p.id === partId);
    const name = project.parts[row]?.name;
    return fill(t.option, { label: partNumber(row + 1, index + 1), name: name || t.unnamed });
  };
  const pendingInvalid = dragCheck !== null && !placementIsValid(dragCheck.check);

  const bar = view ? scaleBar(view.scale) : null;
  const zoomed =
    view !== null && width > 0 && height > 0
      ? isZoomedIn(view.scale, fitView(stock, width, height, 30, FIT_BAND, job).scale)
      : false;
  const onPointer = (e: { clientX: number; clientY: number }) => {
    const el = box.current;
    const out = cursor.current;
    if (!el || !out || !view) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left - view.x) / view.scale;
    const y = stock.height - (e.clientY - r.top - view.y) / view.scale;
    out.textContent = `X ${mmFormat.format(Math.round(x))} · Y ${mmFormat.format(Math.round(y))}`;
  };

  // T244 (D-039): the inspector carries only the selected part; the per-plate summary lives once,
  // in the left panel. Messages and placement errors stay above it (safety texts never hide).
  const inspector = (
    <div className="flex flex-col gap-3 text-sm">
      <div aria-live="polite">
        {message ? (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            data-testid="layout-message"
            className={`rounded-lg border px-3 py-2.5 text-sm ${message.kind === 'error' ? 'border-danger-border bg-danger-subtle text-danger-text' : 'border-success-border bg-success-subtle text-success-text'}`}
          >
            {message.text}
          </p>
        ) : null}
      </div>

      {lockedIssues.map((li) => (
        <p
          key={`${li.key}-${li.code}`}
          role="alert"
          className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm text-danger-text"
        >
          {fill(t[PLACEMENT_ISSUE_TEXT[li.code]], { label: labelOf(li.key) })}
          {li.code === 'PLACEMENT_GRAIN' && onRenest ? (
            <RenestStaleButton label={t.renestStale} onRenest={onRenest} />
          ) : null}
        </p>
      ))}

      <div
        id="layout-info"
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-panel shadow-xs"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-fg">{t.title}</h3>
          {onRenest ? (
            <RenestIconButton t={t} onRenest={onRenest} unlockedOnly={anyLocked} />
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={selectId} className="font-medium text-fg">
            {t.select}
          </label>
          <PartSelect
            t={t}
            id={selectId}
            parts={parts}
            value={current?.key ?? null}
            onSelect={onSelect}
          />
        </div>
        {current ? (
          <PartInfo
            t={t}
            part={current}
            pending={pending}
            pendingInvalid={pendingInvalid}
            onToggleLock={
              onLock
                ? () => {
                    setPending(null);
                    setPendingRot(null);
                    setDragCheck(null);
                    onLock({
                      partId: current.partId,
                      index: current.index,
                      locked: !current.locked,
                    });
                  }
                : undefined
            }
          />
        ) : editable ? (
          <div className="flex flex-col gap-0.5 text-xs text-fg-muted" data-testid="layout-hint">
            <p>{t.hint1}</p>
            <p>{t.hint2}</p>
            <p>{t.hint3}</p>
          </div>
        ) : null}
        {onLockMany && marked.size > 0 ? (
          <div className="flex flex-col gap-2" data-testid="layout-multi">
            <p className="font-medium text-fg">{fill(t.multi.count, { n: marked.size })}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => lockMarked(true)}
                data-testid="layout-multi-lock"
              >
                <Lock aria-hidden />
                {t.multi.lock}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => lockMarked(false)}
                data-testid="layout-multi-unlock"
              >
                <LockOpen aria-hidden />
                {t.multi.unlock}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMarked(new Set())}>
                {t.multi.clear}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  // Floating canvas toolbar (T197): plate tabs top-left, grid/zoom/fit top-right, legend
  // bottom-left (popover), cursor + scale bottom-right. Under 768 px of canvas (phone, or desktop
  // with both side panels open) the plate tabs get their own full-width row above the tools
  // (T199b/B10a, T244 r1) so ≥ 3 tabs stay visible; wider canvases share one row (≥ 3 tabs fit).
  const floating =
    'pointer-events-auto rounded-lg border border-border bg-surface/95 shadow-sm backdrop-blur-sm';
  const overlay = (
    <>
      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 @container">
        {/* T249 (D-040): from 1024 px the tabs (left, scrolling) and the tools (right) share one
            row whatever the canvas width; narrower screens keep the own tab row under 768 px of
            canvas (T199b). */}
        <div className="flex flex-col items-end gap-2 @3xl:flex-row @3xl:items-start @3xl:justify-between lg:flex-row lg:items-start lg:justify-between">
          <div className="flex max-w-full min-w-0 items-start gap-2 self-stretch @3xl:self-auto lg:self-auto">
            <PlateTabStrip
              active={String(sheet)}
              className={`${floating} max-w-full min-w-0 p-0.5`}
              testId="sheet-tabs-scroll"
            >
              <TabsList
                variant="segmented"
                aria-label={t.sheetTabs}
                className="h-auto w-max flex-nowrap justify-start"
              >
                {project.layout.sheets.map((_, i) => {
                  const st = summary.sheets[i];
                  return (
                    <TabsTrigger
                      key={i}
                      value={String(i)}
                      className="relative h-8 shrink-0 gap-1 px-2 whitespace-nowrap"
                    >
                      {fill(t.sheetTab, { n: i + 1 })}
                      {st ? (
                        <span className="text-xs font-normal text-fg-subtle tabular-nums">
                          {fill(t.sheetTabWaste, { waste: pctFormat.format(st.wastePercent) })}
                        </span>
                      ) : null}
                      {st ? <UsageBar used={100 - st.wastePercent} /> : null}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </PlateTabStrip>
            {unplacedCount > 0 ? (
              // T287 (CTO #10 A): parts that are not on any sheet, visible above the canvas without
              // scrolling the side panel. Information only: "İleri" stays free.
              <p
                role="status"
                data-testid="layout-unplaced-chip"
                className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 self-center rounded-full border border-warning-border bg-warning-subtle px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-warning-text shadow-sm"
              >
                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                {fill(t.unplacedChip, { count: unplacedCount })}
              </p>
            ) : null}
          </div>
          <div
            className={`${floating} flex shrink-0 items-center gap-0.5 p-0.5`}
            data-testid="layout-tools"
          >
            {preview3d ? (
              // Compact icon switch (B19 fix): the tab row keeps its room (T249, ≥ 3 full tabs).
              // The 3D presets live in the 3D view itself, so 3D adds nothing to this row.
              <div
                role="group"
                aria-label={pt.switchLabel}
                className="flex items-center gap-px rounded-md bg-surface-subtle p-px"
                data-testid="view-switch"
              >
                {(['2d', '3d'] as const).map((m) => (
                  <Tooltip key={m} content={m === '2d' ? pt.view2dTip : pt.view3dTip}>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={m === '2d' ? pt.view2dTip : pt.view3dTip}
                      aria-pressed={mode === m}
                      data-testid={`view-${m}`}
                      onClick={() => chooseMode(m)}
                      className={cn(
                        'size-7',
                        mode === m && 'bg-surface text-fg shadow-xs hover:bg-surface',
                      )}
                    >
                      {m === '2d' ? <Square aria-hidden /> : <Box aria-hidden />}
                    </IconButton>
                  </Tooltip>
                ))}
              </div>
            ) : null}
            {show3d ? null : (
              <>
                {/* T249: the same icon toggle as the board (T243); the text is its tooltip. */}
                <Tooltip content={t.grid}>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t.grid}
                    aria-pressed={grid}
                    data-testid="layout-grid"
                    className={cn(
                      grid && 'bg-accent-subtle text-accent-text hover:text-accent-text',
                    )}
                    onClick={() => setGrid(!grid)}
                  >
                    <Grid3x3 aria-hidden />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t.zoomOut}>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t.zoomOut}
                    onClick={() => zoomButton(1 / 1.25)}
                    aria-keyshortcuts="-"
                  >
                    <ZoomOut aria-hidden />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t.zoomIn}>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t.zoomIn}
                    onClick={() => zoomButton(1.25)}
                    aria-keyshortcuts="+"
                  >
                    <ZoomIn aria-hidden />
                  </IconButton>
                </Tooltip>
                {job ? (
                  <Tooltip content={t.fitJob}>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={t.fitJob}
                      data-testid="layout-fit-job"
                      onClick={fitHome}
                      aria-keyshortcuts="0"
                    >
                      <Focus aria-hidden />
                    </IconButton>
                  </Tooltip>
                ) : null}
                <Tooltip content={t.fit}>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t.fit}
                    onClick={fit}
                    aria-keyshortcuts={job ? undefined : '0'}
                  >
                    <Maximize aria-hidden />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>
      {noWebGL && !show3d ? (
        <div
          role="status"
          data-testid="preview3d-fallback"
          className={`${floating} absolute inset-x-2 bottom-12 z-10 mx-auto flex max-w-md items-start gap-2 px-3 py-2 text-sm text-fg sm:bottom-12`}
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info-text" />
          <span>{noWebGL === 'slow' ? pt.fallbackSlow : pt.fallback}</span>
        </div>
      ) : null}
      {/* B4b: on phones the sticky panel bar may cover the canvas foot until the page scrolls. */}
      <div
        className={cn(
          'pointer-events-none absolute bottom-2 left-2 z-10 max-sm:bottom-8',
          show3d && 'hidden',
        )}
      >
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="pointer-events-auto bg-surface/95 shadow-sm"
              data-testid="layout-legend-button"
            >
              <Info aria-hidden />
              {t.legendButton}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-auto max-w-80">
            <Legend t={t} margin={project.nesting.margin} grain={stock.grain} />
          </PopoverContent>
        </Popover>
        {project.layout.sheets.length >= MINIMAP_FROM ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="pointer-events-auto ml-2 bg-surface/95 shadow-sm"
                data-testid="layout-minimap-button"
              >
                {t.minimap.button}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-auto max-w-[min(30rem,90vw)]">
              <SheetMinimap
                t={t}
                project={project}
                active={sheet}
                used={summary.sheets.map((s) => 100 - s.wastePercent)}
                onSelect={selectSheet}
              />
            </PopoverContent>
          </Popover>
        ) : null}
        {figures.parts > 0 ? (
          <p
            className={`${floating} mt-2 px-2.5 py-1 text-xs text-fg-muted tabular-nums`}
            data-testid="layout-sheet-stats"
          >
            {fill(t.sheetStats, {
              parts: figures.parts,
              used: pctFormat.format(100 - (summary.sheets[sheet]?.wastePercent ?? 100)),
              length: lengthFormat.format(figures.cutLength / 1000),
            })}
          </p>
        ) : null}
      </div>
      <div
        className={`${floating} pointer-events-none absolute right-2 bottom-2 z-10 hidden items-center gap-3 px-2.5 py-1.5 font-mono text-2xs text-fg-muted tabular-nums ${show3d ? '' : 'sm:flex'}`}
        data-testid="layout-readout"
      >
        <span ref={cursor} title={t.cursor} className="min-w-[9.5rem] text-right">
          –
        </span>
        {bar ? (
          <span className="flex items-center gap-1.5" title={t.scale}>
            <span
              aria-hidden="true"
              className="block h-1.5 border-x border-b border-fg-muted"
              style={{ width: Math.round(bar.px) }}
            />
            {bar.text}
          </span>
        ) : null}
      </div>
    </>
  );

  const canvasBox = (
    <TabsContent
      value={String(sheet)}
      data-testid="layout-panel"
      tabIndex={-1}
      className="absolute inset-0 mt-0 data-[state=active]:animate-none"
    >
      <div
        ref={box}
        tabIndex={0}
        role="application"
        aria-label={fill(t.canvasLabel, { n: sheet + 1, count: parts.length })}
        aria-describedby="layout-info"
        aria-hidden={show3d || undefined}
        inert={show3d || undefined}
        onKeyDown={onKeyDown}
        onPointerMove={onPointer}
        data-testid="layout-canvas"
        data-part-count={parts.length}
        data-scale={view?.scale}
        data-x={view?.x}
        data-y={view?.y}
        data-sheet-height={stock.height}
        data-part-color={colors?.part}
        className={`absolute inset-0 ${show3d ? 'invisible' : ''} ${canvasTouchClass(zoomed)} overflow-hidden outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus`}
      >
        {width > 0 && height > 0 && view && colors ? (
          <CanvasBoundary>
            <LayoutCanvas
              width={width}
              height={height}
              sheet={stock}
              margin={project.nesting.margin}
              parts={shownParts}
              view={view}
              colors={colors}
              grid={grid}
              selected={current?.key ?? null}
              marked={marked}
              conflicts={conflicts}
              pending={pending}
              onViewChange={onViewChange}
              onSelect={onSelect}
              onDragMove={editable ? onDragMove : noopMove}
              onDrop={editable ? onDrop : noopDrop}
              appearKey={appearKey}
              pannable={zoomed || !coarse}
            />
          </CanvasBoundary>
        ) : null}
      </div>
      {show3d && preview3d ? (
        <Preview3D
          t={pt}
          project={project}
          sheet={sheet}
          table={preview3d.table}
          command={camera}
          onPreset={preset}
          onFallback={fallback}
          partCount={parts.length}
        />
      ) : null}
    </TabsContent>
  );

  return (
    <section aria-labelledby="layout-title" className="flex min-h-0 min-w-0 flex-col lg:h-full">
      {/* Always present (the visible title sits in the inspector, a bottom sheet on phones). */}
      <h2 id="layout-title" className="sr-only">
        {t.title}
      </h2>
      <Tabs
        value={String(sheet)}
        onValueChange={(v) => selectSheet(Number(v))}
        className="flex min-h-0 min-w-0 flex-col lg:h-full"
      >
        <WorkspaceLayout
          testId="layout-workspace"
          labels={t.workspace}
          left={left}
          canvas={canvasBox}
          canvasOverlay={overlay}
          right={inspector}
          compactAction={compactAction}
        />
      </Tabs>
    </section>
  );
}

/**
 * Memoised (T281): the wizard re-renders on every autosave state and the step on every run start
 * and stop; with 1500 copies a full render of this view was most of a 50 ms main-thread task. The
 * caller keeps the props stable; the run state reaches the renest buttons through context.
 */
export const LayoutView = memo(LayoutViewImpl);

/**
 * T281: whether a "Diz" run is in progress. Read through context by the two renest buttons only,
 * so a run starting or stopping does not re-render the (memoised) layout view.
 */
export const RenestingContext = createContext(false);

/**
 * "Yeniden diz". With locked parts on the layout it reads "Kilitsizleri yeniden diz" (T170): the
 * run keeps every locked copy and re-places only the free ones.
 */
function RenestIconButton({
  t,
  onRenest,
  unlockedOnly,
}: {
  t: Text;
  onRenest: () => void;
  unlockedOnly: boolean;
}) {
  const renesting = useContext(RenestingContext);
  const label = unlockedOnly ? t.renestUnlocked : t.renest;
  return (
    <Tooltip content={label}>
      <IconButton
        size="sm"
        variant="ghost"
        data-testid="layout-renest"
        aria-label={renesting ? t.renesting : label}
        onClick={onRenest}
        disabled={renesting}
        aria-busy={renesting}
      >
        <RefreshCw aria-hidden className={renesting ? 'animate-spin' : undefined} />
      </IconButton>
    </Tooltip>
  );
}

function RenestStaleButton({ label, onRenest }: { label: string; onRenest: () => void }) {
  const renesting = useContext(RenestingContext);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onRenest}
      disabled={renesting}
      className="mt-2 flex"
    >
      <RefreshCw aria-hidden />
      {label}
    </Button>
  );
}

/**
 * The part picker of the inspector (T281): one option per part of the sheet, rendered even while
 * closed. Memoised so a re-render of the view (a run starts or stops, an autosave state changes)
 * does not rebuild hundreds of options; with 1500 copies that alone was ~25 ms per render at 3×
 * CPU throttle.
 */
const PartSelect = memo(function PartSelect({
  t,
  id,
  parts,
  value,
  onSelect,
}: {
  t: Text;
  id: string;
  parts: readonly DrawnPart[];
  value: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onSelect(v === NONE ? null : v)}>
      <SelectTrigger id={id} data-testid="layout-select" data-value={value ?? ''}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t.selectNone}</SelectItem>
        {parts.map((p) => (
          <SelectItem key={p.key} value={p.key}>
            {fill(t.option, { label: p.label, name: p.name || t.unnamed })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});

function noopMove(): undefined {
  return undefined;
}
function noopDrop() {
  return false;
}

function PartInfo({
  t,
  part,
  pending,
  pendingInvalid,
  onToggleLock,
}: {
  t: Text;
  part: DrawnPart;
  pending: { x: number; y: number } | null;
  pendingInvalid: boolean;
  onToggleLock: (() => void) | undefined;
}) {
  const i = t.info;
  // T249 (D-040): one InspectorRow per value; mono read-outs never wrap at 264 px.
  const rows: [string, string, string, boolean][] = [
    ['number', i.number, part.label, true],
    ['name', i.name, part.name || t.unnamed, false],
    [
      'size',
      i.size,
      fill(i.sizeValue, { w: mmFormat.format(part.w), h: mmFormat.format(part.h) }),
      true,
    ],
    [
      'position',
      i.position,
      fill(i.positionValue, { x: mmFormat.format(part.x), y: mmFormat.format(part.y) }),
      true,
    ],
    ['rotation', i.rotation, fill(i.rotationValue, { rot: part.rot }), true],
    ['locked', i.locked, part.locked ? i.lockedYes : i.lockedNo, false],
    [
      'grain',
      i.grain,
      part.grainAngle !== null
        ? fill(i.grainYes, { angle: mmFormat.format(part.grainAngle) })
        : i.grainNo,
      false,
    ],
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="layout-info">
      <h3 className="font-semibold text-fg">{i.title}</h3>
      <InspectorRows>
        {rows.map(([key, label, value, mono]) => (
          <InspectorRow
            key={key}
            label={label}
            mono={mono}
            {...(key === 'position' ? { title: i.positionHint } : {})}
            valueProps={{ 'data-testid': `layout-info-${key}`, title: value }}
          >
            {value}
          </InspectorRow>
        ))}
      </InspectorRows>
      {pending ? (
        <p
          data-testid="layout-pending"
          className={`font-medium ${pendingInvalid ? 'text-danger-text' : 'text-fg'}`}
        >
          {fill(i.pending, { x: mmFormat.format(pending.x), y: mmFormat.format(pending.y) })}
        </p>
      ) : null}
      {onToggleLock ? (
        <div>
          <Button variant="outline" size="sm" onClick={onToggleLock} aria-pressed={part.locked}>
            {part.locked ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
            {part.locked ? i.unlock : i.lock}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Legend({ t, margin, grain }: { t: Text; margin: number; grain: number | null }) {
  const l = t.legend;
  const swatch = 'inline-block size-3 rounded-[3px] border';
  return (
    <ul aria-label={l.title} className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted">
      <li className="flex items-center gap-1.5">
        <span className={`${swatch} border-part-stroke bg-part`} aria-hidden="true" />
        {l.part}
      </li>
      <li className="flex items-center gap-1.5">
        <span
          className={`${swatch} border-dashed border-part-locked-stroke bg-part-locked`}
          aria-hidden="true"
        />
        {l.locked}
      </li>
      <li className="flex items-center gap-1.5">
        <span className={`${swatch} border-sheet-edge bg-sheet-waste`} aria-hidden="true" />
        {l.waste}
      </li>
      <li className="flex items-center gap-1.5">
        <span className={`${swatch} border-sheet-edge bg-sheet-margin`} aria-hidden="true" />
        {fill(l.margin, { margin: mmFormat.format(margin) })}
      </li>
      <li className="flex items-center gap-1.5">
        <span className={`${swatch} border-danger bg-danger-subtle`} aria-hidden="true" />
        {l.conflict}
      </li>
      <li
        className="flex items-center gap-1.5"
        data-testid="layout-sheet-grain"
        data-grain={grain ?? 'none'}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4 text-grain"
          style={{ transform: `rotate(${-(grain ?? 0)}deg)` }}
          aria-hidden="true"
        >
          <path
            d="M3 12h18M16 7l5 5-5 5M8 7l-5 5 5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
        {l.sheetGrain}
      </li>
      <li>{l.partGrain}</li>
      <li className="flex items-center gap-1.5">
        <span
          className={`${swatch} rounded-full border-part-stroke bg-sheet-waste`}
          aria-hidden="true"
        />
        {l.hole}
      </li>
      <li className="font-mono tabular-nums">{l.number}</li>
    </ul>
  );
}

/**
 * All sheets at a glance (T171): one small thumbnail per sheet with its parts and utilisation;
 * a click opens that sheet. Shown from MINIMAP_FROM sheets on.
 */
function SheetMinimap({
  t,
  project,
  active,
  used,
  onSelect,
}: {
  t: Text;
  project: Project;
  active: number;
  used: number[];
  onSelect: (i: number) => void;
}) {
  return (
    <ul
      aria-label={t.minimap.title}
      className="grid grid-cols-3 gap-2 sm:grid-cols-4"
      data-testid="layout-minimap"
    >
      {project.layout.sheets.map((_, i) => {
        const size = sheetSizeOf(project, i);
        const ps = drawnParts(project, i);
        const pct = pctFormat.format(used[i] ?? 0);
        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={i === active ? 'true' : undefined}
              aria-label={fill(t.minimap.sheet, { n: i + 1, parts: ps.length, used: pct })}
              className={`flex w-24 flex-col items-center gap-1 rounded-md border p-1 text-2xs text-fg-muted tabular-nums hover:bg-surface-hover ${i === active ? 'border-accent' : 'border-border'}`}
            >
              <svg
                viewBox={`0 0 ${size.width} ${size.height}`}
                className="w-full"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <rect
                  width={size.width}
                  height={size.height}
                  className="fill-sheet-waste stroke-sheet-edge"
                  strokeWidth={size.width / 100}
                />
                {ps.map((p) => (
                  <rect
                    key={p.key}
                    x={p.x}
                    y={size.height - p.y - p.h}
                    width={p.w}
                    height={p.h}
                    className={p.locked ? 'fill-part-locked' : 'fill-part'}
                  />
                ))}
              </svg>
              {fill(t.minimap.caption, { n: i + 1, used: pct })}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
