'use client';

import { CanvasBoundary } from '../feedback/canvas-boundary';
import {
  checkPlacement,
  placementIsValid,
  summarizeLayout,
  type PlacementCheck,
  type Project,
  type ValidationIssue,
} from '@nittcam/core';
import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  Button,
  Checkbox,
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
} from '@nittcam/ui';
import { Lock, LockOpen, Maximize, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import { onThemeChange } from '../../lib/canvas-theme';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import { clampScale, zoomAt } from './zoom';
import {
  canvasHeight,
  copyKey,
  drawnParts,
  fitView,
  readColors,
  type CanvasColors,
  type DrawnPart,
  type ViewState,
} from './model';

const LayoutCanvas = dynamic(() => import('./layout-canvas'), { ssr: false });

type Text = Messages['layout'];

/** Params of `lockPlacement` the view sends. */
export interface LockRequest {
  partId: string;
  index: number;
  x?: number;
  y?: number;
  locked: boolean;
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
  /** "Yeniden diz": re-nests keeping the locked parts. Hidden when missing. */
  onRenest?: () => void;
  renesting?: boolean;
  /** Bumped after each new "Diz" result; the parts fade/settle in (T196). */
  appearKey?: number;
}

const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const pctFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

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
const m2Format = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Radix Select items cannot use an empty value; this stands for "no part". */
const NONE = '__none__';
const LOCKED_PATH = /^layout\.sheets\[(\d+)\]\.placements\[(\d+)\]$/;

/**
 * Layout view (T013, spec §3.6 step 3, §6.2 "Elle müdahale"): the sheet with its margin band and
 * waste, numbered parts, grain arrows, sheet tabs, zoom/pan, and manual placement. A drop or an
 * Enter after keyboard nudges is checked with core `checkPlacement` (the same check as the
 * `LOCKED_PLACEMENT_INVALID` rule); a valid one runs `lockPlacement` (one undo step), an invalid
 * one is refused and the part stays where it was. Without `onLock` the view only displays a
 * layout (reused by the simulation, T020).
 */
export function LayoutView({
  t,
  project,
  toolDiameter,
  issues = [],
  onLock,
  onRenest,
  renesting = false,
  appearKey = 0,
}: LayoutViewProps) {
  const gridId = useId();
  const selectId = useId();
  const count = project.layout.sheets.length;
  const [sheetState, setSheet] = useState(0);
  const sheet = Math.min(sheetState, Math.max(0, count - 1));
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [dragCheck, setDragCheck] = useState<{ key: string; check: PlacementCheck } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [grid, setGrid] = useState(false);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<ViewState | null>(null);
  const [colors, setColors] = useState<CanvasColors | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const stock = project.stock.sheet;
  const height = width > 0 ? canvasHeight(stock, width) : 0;
  const parts = useMemo(() => drawnParts(project, sheet), [project, sheet]);
  const byKey = useMemo(() => new Map(parts.map((p) => [p.key, p])), [parts]);
  const current = selected ? (byKey.get(selected) ?? null) : null;
  const summary = useMemo(() => summarizeLayout(project), [project]);
  const editable = onLock !== undefined;

  // Width of the drawing = width of its box (fits 390 px screens); refit when it changes.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      // Height changes follow from the width; only a new width refits.
      if (w <= 0 || w === last) return;
      last = w;
      setColors((c) => c ?? readColors());
      setWidth(w);
      setView(fitView(stock, w, canvasHeight(stock, w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stock]);
  // A theme switch re-reads the token colours, so the canvas follows light/dark live (T110).
  useEffect(() => onThemeChange(() => setColors((c) => (c ? readColors() : c))), []);

  const fit = useCallback(() => {
    if (width > 0) setView(fitView(stock, width, canvasHeight(stock, width)));
  }, [stock, width]);

  function selectSheet(i: number) {
    setSheet(i);
    setSelected(null);
    setPending(null);
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
        { toolDiameter },
      ),
    [project, sheet, toolDiameter],
  );

  const reason = useCallback(
    (c: PlacementCheck): string => {
      if (c.outsideSheet) return t.drop.outsideSheet;
      if (c.inMargin)
        return fill(t.drop.inMargin, { margin: mmFormat.format(project.nesting.margin) });
      const others = c.conflicts
        .map((r) => byKey.get(copyKey(r))?.label ?? `${r.partId}`)
        .join(', ');
      return fill(t.drop.conflict, {
        others,
        spacing: mmFormat.format(toolDiameter + project.nesting.gap),
      });
    },
    [t, project.nesting, toolDiameter, byKey],
  );

  /** Commits a move (drop or Enter). Returns false when refused. */
  const commit = useCallback(
    (part: DrawnPart, x: number, y: number): boolean => {
      setPending(null);
      setDragCheck(null);
      if (!onLock) return false;
      if (x === part.x && y === part.y) {
        setMessage({ kind: 'ok', text: t.drop.unchanged });
        return true;
      }
      const c = check(part, x, y);
      if (!placementIsValid(c)) {
        setMessage({ kind: 'error', text: reason(c) });
        return false;
      }
      if (!onLock({ partId: part.partId, index: part.index, x, y, locked: true })) {
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
    [onLock, check, reason, t],
  );

  const onSelect = useCallback((key: string | null) => {
    setSelected(key);
    setPending(null);
    setDragCheck(null);
  }, []);

  const onDragMove = useCallback(
    (key: string, x: number, y: number) => {
      const part = byKey.get(key);
      if (!part) return;
      setSelected(key);
      setPending({ x, y });
      setDragCheck({ key, check: check(part, x, y) });
    },
    [byKey, check],
  );

  const onDrop = useCallback(
    (key: string, x: number, y: number) => {
      const part = byKey.get(key);
      return part ? commit(part, x, y) : false;
    },
    [byKey, commit],
  );

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
    } else if (e.key === 'Enter' && current && pending) {
      e.preventDefault();
      commit(current, pending.x, pending.y);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (pending) {
        setPending(null);
        setDragCheck(null);
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
      fit();
    }
  }

  function zoomButton(factor: number) {
    if (!view) return;
    setView(zoomAt(view, factor, width / 2, height / 2));
  }

  // Locked placements the rule flags (e.g. after a part was enlarged): listed and drawn red.
  const lockedIssues = issues
    .filter((i) => i.code === 'LOCKED_PLACEMENT_INVALID')
    .map((i) => {
      const m = LOCKED_PATH.exec(i.path);
      const s = Number(m?.[1]);
      const pl = project.layout.sheets[s]?.placements[Number(m?.[2])];
      return pl ? { sheet: s, key: copyKey(pl) } : null;
    })
    .filter((x): x is { sheet: number; key: string } => x !== null);

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
  const stats = summary.sheets[sheet];
  const labelOf = (key: string) => {
    const [partId, index] = [
      key.slice(0, key.lastIndexOf('#')),
      Number(key.slice(key.lastIndexOf('#') + 1)),
    ];
    const row = project.parts.findIndex((p) => p.id === partId);
    return `${row + 1}.${index + 1}`;
  };
  const pendingInvalid = dragCheck !== null && !placementIsValid(dragCheck.check);

  return (
    <section aria-labelledby="layout-title" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="layout-title" className="text-base font-semibold tracking-tight text-fg">
            {t.title}
          </h2>
          {editable ? <p className="text-sm text-fg-muted">{t.help}</p> : null}
        </div>
        {onRenest ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRenest}
            disabled={renesting}
            aria-busy={renesting}
          >
            <RefreshCw aria-hidden className={renesting ? 'animate-spin' : undefined} />
            {renesting ? t.renesting : t.renest}
          </Button>
        ) : null}
      </div>

      <Tabs
        value={String(sheet)}
        onValueChange={(v) => selectSheet(Number(v))}
        className="flex min-w-0 flex-col gap-3"
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="-mx-1 min-w-0 overflow-x-auto px-1 pb-1 sm:pb-0"
            data-testid="sheet-tabs-scroll"
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
                    className="relative h-8 shrink-0 gap-1.5 px-2.5 whitespace-nowrap"
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
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 sm:justify-end">
            <div className="mr-2 flex min-h-10 items-center gap-2 text-sm text-fg-muted">
              <Checkbox id={gridId} checked={grid} onCheckedChange={(v) => setGrid(v === true)} />
              <label htmlFor={gridId} className="cursor-pointer">
                {t.grid}
              </label>
            </div>
            <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 shadow-xs">
              <Tooltip content={t.zoomOut}>
                <IconButton
                  size="sm"
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
                  aria-label={t.zoomIn}
                  onClick={() => zoomButton(1.25)}
                  aria-keyshortcuts="+"
                >
                  <ZoomIn aria-hidden />
                </IconButton>
              </Tooltip>
              <Tooltip content={t.fit}>
                <IconButton size="sm" aria-label={t.fit} onClick={fit} aria-keyshortcuts="0">
                  <Maximize aria-hidden />
                </IconButton>
              </Tooltip>
            </div>
          </div>
        </div>

        <TabsContent
          value={String(sheet)}
          data-testid="layout-panel"
          tabIndex={-1}
          className="mt-0 flex min-w-0 flex-col gap-3 data-[state=active]:animate-none"
        >
          <div
            ref={box}
            tabIndex={0}
            role="application"
            aria-label={fill(t.canvasLabel, { n: sheet + 1, count: parts.length })}
            aria-describedby="layout-info"
            onKeyDown={onKeyDown}
            data-testid="layout-canvas"
            data-part-count={parts.length}
            data-scale={view?.scale}
            data-x={view?.x}
            data-y={view?.y}
            data-sheet-height={stock.height}
            data-part-color={colors?.part}
            className="relative w-full min-w-0 touch-none overflow-hidden rounded-xl border border-border bg-canvas outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            style={{ height: height || undefined, minHeight: 220 }}
          >
            {width > 0 && view && colors ? (
              <CanvasBoundary>
                <LayoutCanvas
                  width={width}
                  height={height}
                  sheet={stock}
                  margin={project.nesting.margin}
                  parts={parts}
                  view={view}
                  colors={colors}
                  grid={grid}
                  selected={current?.key ?? null}
                  conflicts={conflicts}
                  pending={pending}
                  onViewChange={(v) => setView({ ...v, scale: clampScale(v.scale) })}
                  onSelect={onSelect}
                  onDragMove={editable ? onDragMove : noopMove}
                  onDrop={editable ? onDrop : noopDrop}
                  appearKey={appearKey}
                />
              </CanvasBoundary>
            ) : null}
          </div>

          <Legend t={t} margin={project.nesting.margin} grain={stock.grain} />

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
              key={li.key}
              role="alert"
              className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm text-danger-text"
            >
              {fill(t.lockedIssue, { label: labelOf(li.key) })}
            </p>
          ))}

          <div
            id="layout-info"
            className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm shadow-xs"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={selectId} className="font-medium text-fg">
                {t.select}
              </label>
              <Select
                value={current?.key ?? NONE}
                onValueChange={(v) => onSelect(v === NONE ? null : v)}
              >
                <SelectTrigger
                  id={selectId}
                  data-testid="layout-select"
                  data-value={current?.key ?? ''}
                  className="max-w-md"
                >
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
            ) : null}
          </div>

          <div
            className="flex flex-col gap-0.5 rounded-xl border border-border-subtle bg-surface-subtle px-4 py-3 text-sm text-fg tabular-nums"
            data-testid="layout-summary"
          >
            {stats ? (
              <p>
                {fill(t.summary, {
                  n: sheet + 1,
                  count: stats.placed,
                  parts: m2Format.format(stats.partArea / 1e6),
                  waste: m2Format.format(stats.wasteArea / 1e6),
                  percent: pctFormat.format(stats.wastePercent),
                })}
              </p>
            ) : null}
            <p className="text-fg-muted">
              {fill(t.total, {
                sheets: summary.sheetCount,
                percent: pctFormat.format(summary.wastePercent),
                use: pctFormat.format(summary.utilisationPercent),
              })}
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function noopMove() {}
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
  const rows: [string, string, string][] = [
    ['number', i.number, part.label],
    ['name', i.name, part.name || t.unnamed],
    ['size', i.size, fill(i.sizeValue, { w: mmFormat.format(part.w), h: mmFormat.format(part.h) })],
    [
      'position',
      i.position,
      fill(i.positionValue, { x: mmFormat.format(part.x), y: mmFormat.format(part.y) }),
    ],
    ['rotation', i.rotation, fill(i.rotationValue, { rot: part.rot })],
    ['locked', i.locked, part.locked ? i.lockedYes : i.lockedNo],
    ['grain', i.grain, part.grainLock ? i.grainYes : i.grainNo],
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="layout-info">
      <h3 className="font-semibold text-fg">{i.title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([key, label, value]) => (
          <div key={key} className="contents">
            <dt className="text-fg-muted">{label}</dt>
            <dd data-testid={`layout-info-${key}`} className="tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
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

function Legend({ t, margin, grain }: { t: Text; margin: number; grain: 0 | 90 }) {
  const l = t.legend;
  const swatch = 'inline-block size-3 rounded-[3px] border';
  return (
    <ul aria-label={l.title} className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted">
      <li className="flex items-center gap-1.5">
        <span className={`${swatch} border-part-stroke bg-part`} aria-hidden="true" />
        {l.part}
      </li>
      <li className="flex items-center gap-1.5">
        <span className={`${swatch} border-part-locked-stroke bg-part-locked`} aria-hidden="true" />
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
      <li className="flex items-center gap-1.5" data-testid="layout-sheet-grain" data-grain={grain}>
        <svg
          viewBox="0 0 24 24"
          className="size-4 text-grain"
          style={{ transform: `rotate(${-grain}deg)` }}
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
    </ul>
  );
}
