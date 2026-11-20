'use client';

import { CanvasBoundary } from '../feedback/canvas-boundary';
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  cn,
} from '@nittcam/ui';
import { Preview3D } from '../preview3d/preview3d';
import type { CameraCommand } from '../preview3d/scene';
import type { ViewPreset } from '../../lib/preview3d/camera';
import { hasWebGL2 } from '../../lib/preview3d/capability';
import type { TableSpec } from '../../lib/preview3d/stage';
import type { Messages } from '../../lib/messages';
import { PlateTabStrip } from '../wizard/plate-tab-strip';
import { WorkspaceLayout } from '../wizard/workspace-layout';
import { canvasTouchClass, isZoomedIn, useMediaQuery } from '../../lib/use-media-query';
import {
  Box,
  Info,
  Maximize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { onThemeChange } from '../../lib/canvas-theme';
import {
  clampSimTime,
  nextStepTime,
  playbackRate,
  positionAt,
  materialHasGrain,
  materialKindOf,
  prevStepTime,
  simPlayheadAt,
  timeForLine,
  type PostProfileVersion,
  type Project,
  type SimMachineFrame,
  type SimSheet,
  sheetSizeOf,
  unverifiedTemplateNames,
} from '@nittcam/core';
import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { fill } from '../../lib/draft-project';
import type { SimulationMeta, SimulationResponse } from '../../lib/simulation-messages';
import { useSimulationWorker } from '../../lib/use-simulation-worker';
import { SPEEDS, createSimPlayer, useSimPlayer } from '../../lib/sim-player';
import { drawnParts, type ViewState } from '../layout-view/model';
import { clampScale, zoomAt } from '../layout-view/zoom';
import { GcodePanel } from './gcode-panel';
import {
  depthRamp,
  formatClock,
  formatCoord,
  formatDuration,
  formatInt,
  formatMm,
  readSimColors,
  simBounds,
  toolDiameterOf,
  withPendingRevision,
  type Bounds,
  type SimColors,
  type SimText,
} from './model';
import { SummaryCard } from './summary-card';
import { findings, Violations } from './violations';
import { ZStrip } from './z-strip';

const SimulationCanvas = dynamic(() => import('./simulation-canvas'), { ssr: false });

/** Scrubber resolution: tenths of a second. */
const SCRUB_UNITS = 10;

/** `prefers-reduced-motion: reduce` as React state (false on the server). */
function subscribeMotion(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

/** Is the key event aimed at a control that handles it itself? */
function ownsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  // Space and Enter activate a focused button; arrows and Home/End do nothing there.
  if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) {
    return key === ' ' || key === 'Enter';
  }
  return false;
}
interface Run {
  project: Project;
  machineKey: string;
  meta: SimulationMeta;
  response: SimulationResponse;
}

/** What the program header says about the project (T262): the values the export writes. */
export interface SimHeader {
  projectName: string;
  /** The saved revision. */
  revision: number;
  /** False while changes wait for the autosave: the download will carry a later revision. */
  saved: boolean;
}

/** The selected machine's profile version, as the wizard loaded it. */
export interface SimMachine {
  id: string;
  pv: PostProfileVersion;
}

/** 3D view of the playback (T156, T157, spec §3.8): texts and the machine table. */
export interface Sim3D {
  t: Messages['layout']['preview3d'];
  table: TableSpec | null;
}

/**
 * Önizleme / simülasyon step (T020, spec §6.5, §3.6 step 4; wizard since T023). Runs the export
 * pipeline + reader for the wizard's project on its selected machine in a Web Worker and plays
 * the read program back on the sheet.
 */
export function SimulationView({
  t,
  project,
  machine,
  header,
  empty,
  left,
  notice,
  onOpenPart,
  view3d,
}: {
  t: SimText;
  /** Offers the 3D view of the playback (T156); absent = 2D only. */
  view3d?: Sim3D | undefined;
  project: Project;
  machine: SimMachine | null;
  header: SimHeader;
  /** Extra content for the settings panel (the wizard's warnings), T197. */
  left?: ReactNode;
  /** T269: the "Son sürüme geç" box when the machine has a newer profile version. */
  notice?: ReactNode;
  /** T270: opens a part on the drawing board (a blocked cut-out links there). */
  onOpenPart?: (partId: string, hole?: number) => void;
  /** Shown instead of the simulation when there is no layout or no machine (wizard texts). */
  empty: { noLayout: React.ReactNode; noMachine: React.ReactNode };
}) {
  const runSimulation = useSimulationWorker();
  const [run, setRun] = useState<Run | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);

  const machineKey = machine ? `${machine.id}@${machine.pv.version}` : null;
  const hasLayout = project.layout.sheets.length > 0;

  const { projectName, revision, saved } = header;
  useEffect(() => {
    if (!hasLayout || !machine || !machineKey) return;
    let live = true;
    const meta: SimulationMeta = { projectName, revision };
    void runSimulation(project, machine.pv, meta).then((response) => {
      if (live) setRun({ project, machineKey, meta, response });
    });
    return () => {
      live = false;
    };
  }, [project, hasLayout, machine, machineKey, runSimulation, projectName, revision]);

  // A run for an older name or revision stays on screen until the new one arrives (the
  // program is the same; only the header differs), so playback is not interrupted by an autosave.
  const fresh = run && run.project === project && run.machineKey === machineKey ? run : null;
  const response = fresh?.response ?? null;
  const result = response?.ok ? response.result : null;
  const sheets = result?.ok ? result.sheets : [];
  const sheet = Math.min(sheetIndex, Math.max(0, sheets.length - 1));
  const generated = sheets[sheet] ?? null;
  // T262: the revision is only known once the changes are saved; until then the header says so.
  const pending = !saved || (fresh !== null && fresh.meta.revision !== revision);
  const runRevision = fresh?.meta.revision ?? revision;
  const sim = useMemo(
    () =>
      generated && pending
        ? {
            ...generated,
            files: withPendingRevision(generated.files, runRevision, t.gcode.revisionPending),
          }
        : generated,
    [generated, pending, runRevision, t.gcode.revisionPending],
  );

  const all = useMemo(() => (result ? findings(result) : []), [result]);
  const errorCount = all.filter((f) => f.severity === 'error').length;
  const warnings = useMemo(() => all.filter((f) => f.severity === 'warning'), [all]);

  let body: React.ReactNode;
  let player: React.ReactNode = null;
  if (!hasLayout) {
    body = empty.noLayout;
  } else if (!machine) {
    body = empty.noMachine;
  } else if (!response) {
    body = (
      <div
        role="status"
        data-testid="sim-loading"
        className="flex items-center gap-3 rounded-xl border border-border bg-surface-subtle p-6 text-sm text-fg-muted"
      >
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-border-strong border-t-accent"
        />
        {t.loading}
      </div>
    );
  } else if (!response.ok) {
    body = (
      <p
        role="alert"
        className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm text-danger-text"
      >
        {response.error === 'unknownPost'
          ? fill(t.unknownPost, { post: response.detail })
          : fill(t.failed, { error: response.detail })}
      </p>
    );
  } else if (!response.result.ok || !result?.summary) {
    body = (
      <Violations t={t} result={response.result} parts={project.parts} onOpenPart={onOpenPart} />
    );
  } else if (sim) {
    player = (
      <>
        <SummaryCard
          t={t}
          summary={result.summary}
          program={result.export.tools}
          templateNames={unverifiedTemplateNames(project.parts)}
          checksOk={errorCount === 0}
          errorCount={errorCount}
          warnings={warnings}
        />
      </>
    );
  }

  const profile = machine?.pv.profile;

  const side = (
    <div className="flex min-w-0 flex-col gap-3">
      <p
        role="note"
        data-testid="sim-banner"
        className="flex items-start gap-2 rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-xs text-info-text"
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong className="font-semibold">{t.banner}</strong> <span>{t.bannerDetail}</span>
        </span>
      </p>
      {notice}
      {hasLayout && machine && profile ? (
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-panel py-3 shadow-xs">
          <p className="text-sm text-fg" data-testid="sim-machine-name">
            <span className="font-medium">{t.machine.label}: </span>
            {fill(t.machine.option, { name: profile.identity.name, version: machine.pv.version })}
          </p>
          <p className="text-xs text-fg-muted">
            {fill(t.machine.envelope, {
              x: formatMm(profile.workEnvelope.x),
              y: formatMm(profile.workEnvelope.y),
              w: formatMm(profile.table.width),
              d: formatMm(profile.table.depth),
              post: `${profile.post.id} ${profile.post.version}`,
            })}
          </p>
        </div>
      ) : null}

      {player}
      {left}
    </div>
  );

  if (player && sim && result) {
    const tabs =
      sheets.length > 1 ? (
        <TabsList
          variant="segmented"
          aria-label={t.sheetTabs}
          className="h-auto w-max flex-nowrap justify-start"
        >
          {sheets.map((s, i) => (
            <TabsTrigger key={s.sheet} value={String(i)} className="h-8 shrink-0 gap-1.5 px-2.5">
              {fill(t.sheetTab, { n: s.sheet + 1 })}
              <span className="text-xs font-normal text-fg-subtle tabular-nums">
                {fill(t.sheetTabTime, { time: formatDuration(t, s.duration) })}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      ) : null;
    return (
      <Tabs
        value={String(sheet)}
        onValueChange={(v) => setSheetIndex(Number(v))}
        className="flex min-h-0 min-w-0 flex-col lg:h-full"
      >
        <TabsContent
          value={String(sheet)}
          tabIndex={-1}
          className="mt-0 flex min-h-0 min-w-0 flex-col data-[state=active]:animate-none lg:h-full"
        >
          <Player
            key={`${machineKey}-${sim.sheet}`}
            t={t}
            sim={sim}
            project={project}
            machine={sim.machine ?? result.machine}
            left={side}
            tabs={tabs}
            view3d={view3d}
          />
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
      {body}
      {side}
    </div>
  );
}

/**
 * Keeps the sheet at least partly on screen: at least `keep` pixels of it (or all of it when it
 * is smaller) stay inside the canvas on both axes, whatever the zoom or pan.
 */
export function clampView(
  v: ViewState,
  sheet: { width: number; height: number },
  width: number,
  height: number,
): ViewState {
  const scale = clampScale(v.scale);
  const w = sheet.width * scale;
  const h = sheet.height * scale;
  const keepX = Math.min(48, w, width / 2);
  const keepY = Math.min(48, h, height / 2);
  // Sheet on screen: x in [v.x, v.x + w], y in [v.y, v.y + h] (canvas y 0..H is the sheet).
  const x = Math.min(width - keepX, Math.max(keepX - w, v.x));
  const y = Math.min(height - keepY, Math.max(keepY - h, v.y));
  return { scale, x, y };
}

/** Canvas band (px) kept free at fit: plate tabs float over the top, the grain label sits bottom-right. */
interface FitInsets {
  top: number;
  bottom: number;
}

/** Scale and pan that show `b` (sheet frame, mm) centred in the canvas, clear of the overlays. */
function fitBounds(
  b: Bounds,
  sheetHeight: number,
  width: number,
  height: number,
  insets: FitInsets = { top: 0, bottom: 0 },
): ViewState {
  const pad = 8;
  // Reserve the overlay bands only while the sheet keeps >= 75 % of its unreserved fit scale:
  // both bands first, then the grain label's alone, else none (short phone canvases). A
  // width-limited fit has vertical slack, so the bands then cost nothing (T199b).
  const fitScale = (r: FitInsets) =>
    Math.max(
      0.0001,
      Math.min((width - 2 * pad) / b.width, (height - r.top - r.bottom - 2 * pad) / b.height),
    );
  const full = fitScale({ top: 0, bottom: 0 });
  const reserve = [insets, { top: 0, bottom: insets.bottom }, { top: 0, bottom: 0 }].find(
    (r) => fitScale(r) >= full * 0.75,
  ) ?? { top: 0, bottom: 0 };
  const usable = height - reserve.top - reserve.bottom;
  const scale = fitScale(reserve);
  const top = sheetHeight - b.y - b.height;
  return {
    scale,
    x: (width - b.width * scale) / 2 - b.x * scale,
    y: reserve.top + (usable - b.height * scale) / 2 - top * scale,
  };
}

/** The playback of one sheet: canvas, controls, Z strip, readout, legend and G-code panel. */
function Player({
  t,
  sim,
  project,
  machine,
  left,
  tabs,
  view3d,
}: {
  t: SimText;
  view3d?: Sim3D | undefined;
  sim: SimSheet;
  project: Project;
  machine: SimMachineFrame | null;
  /** Settings panel of the workspace (summary, machine, warnings). */
  left: ReactNode;
  /** Plate tabs floating top-left on the canvas (more than one sheet). */
  tabs: ReactNode;
}) {
  const reduced = useReducedMotion();
  // T157: one player store per sheet; the 2D canvas and the 3D view both follow it.
  const [player] = useState(() => createSimPlayer(sim.steps, sim.duration));
  useLayoutEffect(() => player.load(sim.steps, sim.duration), [player, sim.steps, sim.duration]);
  const { time, playing, speed, line } = useSimPlayer(player);
  const { setPlaying, setSpeed } = player;
  const timeRef = useMemo(
    () => ({
      get current() {
        return player.get().time;
      },
    }),
    [player],
  );
  const [size, setSize] = useState({ w: 0, h: 0 });
  const width = size.w;
  const [view, setView] = useState<ViewState | null>(null);
  const [colors, setColors] = useState<SimColors | null>(null);
  const coarse = useMediaQuery('(pointer: coarse)', false);
  const box = useRef<HTMLDivElement>(null);
  const duration = sim.duration;
  const stock = useMemo(() => sheetSizeOf(project, sim.sheet), [project, sim.sheet]);
  // T259: no grain chip or legend line when the sheet has no grain (or the material has none).
  const sheetGrain = materialHasGrain(materialKindOf(project.stock.material)) ? stock.grain : null;
  const bounds = useMemo(() => simBounds(stock, machine), [stock, machine]);
  // Fit keeps the sheet clear of the floating plate tabs (top) and the grain label (bottom).
  const hasTabs = Boolean(tabs);
  const narrow = useMediaQuery('(max-width: 639px)', false);
  // Own-row tabs on phones push the zoom toolbar to a second row (T199b).
  const insets = useMemo<FitInsets>(
    () => ({ top: hasTabs ? (narrow ? 88 : 44) : 0, bottom: 36 }),
    [hasTabs, narrow],
  );
  const height = size.h;
  const parts = useMemo(() => drawnParts(project, sim.sheet), [project, sim.sheet]);

  // T156: 2D / 3D switch of the playback; both views follow the same player.
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [noWebGL, setNoWebGL] = useState(false);
  const [camera, setCamera] = useState<CameraCommand>({
    preset: 'iso',
    from: 'top',
    nonce: 0,
    animate: true,
  });
  const show3d = view3d !== undefined && mode === '3d';
  function chooseMode(next: '2d' | '3d') {
    if (next === '3d' && !hasWebGL2()) {
      setNoWebGL(true);
      setMode('2d');
      return;
    }
    if (next === '3d' && mode !== '3d')
      setCamera((c) => ({ preset: 'iso', from: 'top', nonce: c.nonce + 1, animate: true }));
    setMode(next);
  }
  const preset3d = (p: ViewPreset) =>
    setCamera((c) => ({ preset: p, nonce: c.nonce + 1, animate: true }));

  const setTime = useCallback(
    (v: number) => {
      player.setTime(clampSimTime(duration, v));
    },
    [duration, player],
  );

  // T268: refit only when the fit inputs change in value. An autosave or a machine refetch gives
  // new `stock` / `machine` objects with the same numbers; refitting then threw away a zoom the
  // user had just made (CI flake in t020 "zoom: + four times").
  const fitKey = JSON.stringify([bounds, stock.height, insets]);
  const fitArgs = useRef({ bounds, sheetHeight: stock.height, insets });
  useEffect(() => {
    fitArgs.current = { bounds, sheetHeight: stock.height, insets };
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = { w: 0, h: 0 };
    // The canvas fills its workspace cell (T197); a new width or height refits.
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      const h = Math.floor(entries[0]?.contentRect.height ?? 0);
      if (w <= 0 || h <= 0 || (w === last.w && h === last.h)) return;
      last = { w, h };
      const f = fitArgs.current;
      setColors((c) => c ?? readSimColors());
      setSize({ w, h });
      setView(fitBounds(f.bounds, f.sheetHeight, w, h, f.insets));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitKey]);
  // A theme switch re-reads the token colours, so the canvas follows light/dark live (T110).
  useEffect(() => onThemeChange(() => setColors((c) => (c ? readSimColors() : c))), []);

  const fit = useCallback(() => {
    if (width > 0 && height > 0) setView(fitBounds(bounds, stock.height, width, height, insets));
  }, [bounds, stock.height, width, height, insets]);
  // Zoomed past the fit: one finger pans the view; at the fit it scrolls the page on touch (T198).
  const zoomed =
    view !== null &&
    width > 0 &&
    height > 0 &&
    isZoomedIn(view.scale, fitBounds(bounds, stock.height, width, height, insets).scale);

  // Playback: one animation frame per redraw; the time advances by real time × speed.
  const active = playing && !reduced;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const rate = playbackRate(speed, duration);
    const tick = (now: number) => {
      // The frame timestamp can predate the effect start: never step backwards.
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      const next = Math.min(duration, timeRef.current + dt * rate);
      player.setTime(next);
      if (next >= duration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [active, speed, duration, player, setPlaying, timeRef]);

  const togglePlay = useCallback(() => {
    if (reduced) return;
    if (!playing && timeRef.current >= duration) setTime(0);
    setPlaying(!player.get().playing);
  }, [reduced, playing, duration, setTime, player, setPlaying, timeRef]);
  const stepNext = useCallback(() => {
    setPlaying(false);
    setTime(nextStepTime(sim.steps, timeRef.current, duration));
  }, [sim.steps, duration, setTime, setPlaying, timeRef]);
  const stepPrev = useCallback(() => {
    setPlaying(false);
    setTime(prevStepTime(sim.steps, timeRef.current));
  }, [sim.steps, setTime, setPlaying, timeRef]);
  const toStart = useCallback(() => {
    setPlaying(false);
    setTime(0);
  }, [setTime, setPlaying]);
  const toEnd = useCallback(() => {
    setPlaying(false);
    setTime(duration);
  }, [duration, setTime, setPlaying]);
  const seekLine = useCallback(
    (file: number, line: number) => {
      setPlaying(false);
      setTime(timeForLine(sim.steps, file, line, duration));
    },
    [sim.steps, duration, setTime, setPlaying],
  );
  const seekTime = useCallback(
    (v: number) => {
      setPlaying(false);
      setTime(v);
    },
    [setTime, setPlaying],
  );

  // Keyboard: Space play/pause (a step under reduced motion), ←/→ step, Home/End.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || ownsKey(e.target, e.key)) return;
      if (e.key === ' ') {
        if (reduced) stepNext();
        else togglePlay();
      } else if (e.key === 'ArrowRight') stepNext();
      else if (e.key === 'ArrowLeft') stepPrev();
      else if (e.key === 'Home') toStart();
      else if (e.key === 'End') toEnd();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reduced, togglePlay, stepNext, stepPrev, toStart, toEnd]);

  const ph = simPlayheadAt(sim.steps, time);
  const pos = positionAt(sim, time);
  const stepIndex = ph.active >= 0 ? ph.active : ph.done - 1;
  const step = sim.steps[stepIndex];
  const diameter = step ? toolDiameterOf(sim, step.tool) : null;
  const ramp = colors ? depthRamp(colors.depthTop, colors.depthBottom, 6) : [];
  const clock = fill(t.controls.clock, { now: formatClock(time), total: formatClock(duration) });
  const panelHeight = Math.max(280, height + 120);

  function zoomButton(factor: number) {
    if (!view || width <= 0) return;
    // Zoom around the centre of the canvas, then keep the sheet in view.
    setView(clampView(zoomAt(view, factor, width / 2, height / 2), stock, width, height));
  }

  const floating =
    'pointer-events-auto rounded-lg border border-border bg-surface/95 shadow-sm backdrop-blur-sm';
  const overlay = (
    <>
      {/* Below 640 px the plate tabs get their own full-width row, the same as Dizilim (T199b). */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-col items-end gap-2 sm:flex-row sm:items-start sm:justify-between">
        {tabs ? (
          <PlateTabStrip
            active={String(sim.sheet)}
            className={`${floating} max-w-full min-w-0 p-0.5 max-sm:self-stretch`}
            testId="sim-tabs-scroll"
          >
            {tabs}
          </PlateTabStrip>
        ) : (
          <span />
        )}
        <div className={`${floating} flex shrink-0 items-center gap-0.5 p-0.5`}>
          {view3d ? (
            <div
              role="group"
              aria-label={view3d.t.switchLabel}
              className="flex items-center gap-px rounded-md bg-surface-subtle p-px"
              data-testid="sim-view-switch"
            >
              {(['2d', '3d'] as const).map((m) => (
                <Tooltip key={m} content={m === '2d' ? view3d.t.view2dTip : view3d.t.view3dTip}>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={m === '2d' ? view3d.t.view2dTip : view3d.t.view3dTip}
                    aria-pressed={mode === m}
                    data-testid={`sim-view-${m}`}
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
              <Tooltip content={t.controls.zoomOut}>
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label={t.controls.zoomOut}
                  onClick={() => zoomButton(1 / 1.25)}
                >
                  <ZoomOut aria-hidden />
                </IconButton>
              </Tooltip>
              <Tooltip content={t.controls.zoomIn}>
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label={t.controls.zoomIn}
                  onClick={() => zoomButton(1.25)}
                >
                  <ZoomIn aria-hidden />
                </IconButton>
              </Tooltip>
              <Tooltip content={t.controls.fit}>
                <IconButton size="sm" variant="ghost" aria-label={t.controls.fit} onClick={fit}>
                  <Maximize aria-hidden />
                </IconButton>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      {noWebGL && !show3d && view3d ? (
        <div
          role="status"
          data-testid="preview3d-fallback"
          className={`${floating} absolute inset-x-2 bottom-12 z-10 mx-auto flex max-w-md items-start gap-2 px-3 py-2 text-sm text-fg`}
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info-text" />
          <span>{view3d.t.fallback}</span>
        </div>
      ) : null}
      <div className={cn('pointer-events-none absolute bottom-2 left-2 z-10', show3d && 'hidden')}>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="pointer-events-auto bg-surface/95 shadow-sm"
              data-testid="sim-legend-button"
            >
              <Info aria-hidden />
              {t.legendButton}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-auto max-w-96">
            <div className="flex flex-col gap-3">
              <Legend t={t} ramp={ramp} zBottom={sim.zBottom} grain={sheetGrain} />
              <p className="text-xs text-fg-subtle">{t.controls.shortcuts}</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );

  return (
    <WorkspaceLayout
      testId="sim-workspace"
      labels={t.workspace}
      left={left}
      canvas={
        <div
          ref={box}
          tabIndex={0}
          role="application"
          aria-label={fill(t.canvasLabel, { n: sim.sheet + 1, moves: sim.steps.length })}
          aria-keyshortcuts="Space ArrowLeft ArrowRight Home End"
          data-testid="sim-canvas"
          data-time={time}
          data-duration={duration}
          data-steps={sim.steps.length}
          data-done={ph.done}
          data-contours={sim.contours.length}
          data-playing={active}
          data-scale={view?.scale}
          data-x={view?.x}
          data-y={view?.y}
          data-sheet-width={stock.width}
          data-sheet-height={stock.height}
          data-part-color={colors?.part}
          className={`absolute inset-0 ${canvasTouchClass(zoomed)} overflow-hidden outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus`}
        >
          {/* T259: no grain chip on a sheet without grain. */}
          {sheetGrain !== null && !show3d ? (
            <span
              data-testid="sim-grain"
              data-grain={stock.grain ?? 'none'}
              className="pointer-events-none absolute right-2 bottom-2 z-10 flex items-center gap-1.5 rounded-md border border-border bg-surface/90 px-2 py-1 text-xs text-fg shadow-xs backdrop-blur-sm"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                style={{ transform: `rotate(${-(stock.grain ?? 0)}deg)` }}
                aria-hidden="true"
              >
                <path
                  d="M3 12h18M16 7l5 5-5 5M8 7l-5 5 5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              <span className="hidden sm:inline">{t.legend.grain}</span>
              <span className="sr-only sm:hidden">{t.legend.grain}</span>
            </span>
          ) : null}
          {show3d && view3d ? (
            <Preview3D
              t={view3d.t}
              project={project}
              sheet={sim.sheet}
              table={view3d.table}
              command={camera}
              onPreset={preset3d}
              onFallback={() => {
                setNoWebGL(true);
                setMode('2d');
              }}
              partCount={parts.length}
              toolpath={{
                sim,
                time,
                tool: { x: pos.x, y: pos.y, z: pos.z, diameter: diameter ?? 6 },
              }}
            >
              {/* §3.8: the air-cut warning also in 3D. */}
              <p
                role="note"
                data-testid="sim-banner-3d"
                className="pointer-events-none absolute top-14 right-2 z-10 flex max-w-64 items-start gap-1.5 rounded-lg border border-info-border bg-info-subtle/95 px-2.5 py-1.5 text-xs text-info-text shadow-sm max-sm:top-24"
              >
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span className="font-semibold">{t.banner}</span>
              </p>
            </Preview3D>
          ) : width > 0 && view && colors ? (
            <CanvasBoundary>
              <SimulationCanvas
                width={width}
                height={height}
                sim={sim}
                sheet={stock}
                margin={project.nesting.margin}
                parts={parts}
                machine={machine}
                view={view}
                colors={colors}
                time={time}
                onViewChange={(v) => setView(clampView(v, stock, width, height))}
                clampPan={(x, y, scale) => clampView({ x, y, scale }, stock, width, height)}
                pannable={zoomed || !coarse}
              />
            </CanvasBoundary>
          ) : null}
        </div>
      }
      canvasOverlay={overlay}
      canvasFooter={
        <>
          {colors && width > 0 ? (
            <ZStrip t={t} sim={sim} width={width} time={time} colors={colors} onSeek={seekTime} />
          ) : null}

          <div
            role="group"
            aria-label={t.controls.label}
            className="flex flex-col gap-2 px-2 py-2 sm:px-3"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex items-center gap-1">
                <Tooltip content={t.controls.start}>
                  <IconButton
                    variant="ghost"
                    onClick={toStart}
                    aria-label={t.controls.start}
                    aria-keyshortcuts="Home"
                  >
                    <SkipBack aria-hidden />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t.controls.prev}>
                  <IconButton
                    variant="ghost"
                    onClick={stepPrev}
                    aria-label={t.controls.prev}
                    aria-keyshortcuts="ArrowLeft"
                  >
                    <StepBack aria-hidden />
                  </IconButton>
                </Tooltip>
                {/* T245: idle = solid accent "Oynat"; playing = secondary "Duraklat". Under reduced
                    motion it stays enabled and steps once, like Space (no animation). */}
                <Button
                  variant={active ? 'secondary' : 'primary'}
                  onClick={reduced ? stepNext : togglePlay}
                  aria-keyshortcuts="Space"
                  data-testid="sim-play"
                  className="min-w-28"
                >
                  {active ? <Pause aria-hidden /> : <Play aria-hidden />}
                  {active ? t.controls.pause : t.controls.play}
                </Button>
                <Tooltip content={t.controls.next}>
                  <IconButton
                    variant="ghost"
                    onClick={stepNext}
                    aria-label={t.controls.next}
                    aria-keyshortcuts="ArrowRight"
                  >
                    <StepForward aria-hidden />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t.controls.end}>
                  <IconButton
                    variant="ghost"
                    onClick={toEnd}
                    aria-label={t.controls.end}
                    aria-keyshortcuts="End"
                  >
                    <SkipForward aria-hidden />
                  </IconButton>
                </Tooltip>
              </div>
              <div className="flex min-w-48 flex-1 items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={Math.ceil(duration * SCRUB_UNITS)}
                  step={1}
                  value={Math.round(time * SCRUB_UNITS)}
                  onChange={(e) => seekTime(Number(e.target.value) / SCRUB_UNITS)}
                  aria-label={t.controls.scrubber}
                  aria-valuetext={clock}
                  data-testid="sim-scrubber"
                  className="h-10 min-w-0 flex-1 cursor-pointer accent-(--color-accent)"
                />
                <span
                  className="shrink-0 font-mono text-sm text-fg tabular-nums"
                  data-testid="sim-clock"
                >
                  {clock}
                </span>
              </div>
              <div role="group" aria-label={t.controls.speed} className="flex items-center gap-2">
                <span className="text-xs text-fg-muted">{t.controls.speed}</span>
                <div className="flex items-center gap-0.5 rounded-lg bg-surface-hover p-0.5">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={speed === s}
                      disabled={reduced}
                      onClick={() => setSpeed(s)}
                      className={`h-8 min-w-9 rounded-md px-2 text-xs font-medium tabular-nums transition-colors duration-(--duration-fast) outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50 ${speed === s ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
                    >
                      {s === 'max' ? t.controls.speedMax : `${s}×`}
                    </button>
                  ))}
                </div>
                {reduced ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={t.controls.reducedMotionInfo}
                        data-testid="sim-reduced-info"
                        className="text-info-text"
                      >
                        <Info aria-hidden />
                      </IconButton>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 text-sm">
                      <p data-testid="sim-reduced-note">{t.controls.reducedMotion}</p>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            </div>
            <div
              className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle pt-3 font-mono text-xs text-fg-muted"
              aria-live="off"
            >
              <span data-testid="sim-step">
                {fill(t.controls.step, { n: ph.done, total: sim.steps.length })}
              </span>
              {line ? <span>{fill(t.readout.line, { line: line.line })}</span> : null}
              <span className="tabular-nums" data-testid="sim-position">
                {step
                  ? fill(t.readout.position, {
                      x: formatCoord(pos.x),
                      y: formatCoord(pos.y),
                      z: formatCoord(pos.z),
                    })
                  : t.readout.idle}
              </span>
              {step ? (
                <span>
                  {step.tool !== null && diameter !== null
                    ? fill(t.readout.tool, { tool: step.tool, d: formatMm(diameter) })
                    : t.readout.toolUnknown}
                </span>
              ) : null}
              {step ? (
                <span>
                  {step.kind === 'cut'
                    ? fill(t.readout.feed, { feed: formatInt(step.feed ?? 0) })
                    : t.readout.rapid}
                </span>
              ) : null}
            </div>
          </div>
        </>
      }
      right={
        <GcodePanel t={t} files={sim.files} current={line} height={panelHeight} onSeek={seekLine} />
      }
    />
  );
}

function Legend({
  t,
  ramp,
  zBottom,
  grain,
}: {
  t: SimText;
  ramp: readonly string[];
  zBottom: number;
  grain: number | null;
}) {
  const l = t.legend;
  const swatch = 'inline-block size-3.5 rounded-sm border';
  const line = 'inline-block h-0 w-6 border-t-2';
  return (
    <div className="flex flex-col gap-2 text-xs text-fg-muted">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg">{l.cut}</span>
        <span>{l.depthTop}</span>
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-32 rounded-full border border-border"
          style={{
            background: ramp.length ? `linear-gradient(to right, ${ramp.join(', ')})` : undefined,
          }}
        />
        <span>{fill(l.depthBottom, { z: formatMm(zBottom) })}</span>
      </div>
      <ul aria-label={l.title} className="flex flex-wrap gap-x-4 gap-y-1">
        <li className="flex items-center gap-1.5">
          <span className={`${line} border-dashed border-sim-rapid`} aria-hidden="true" />
          {l.rapid}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block size-3.5 rounded-full border-2 border-sim-tool bg-sim-tool/25"
            aria-hidden="true"
          />
          {l.tool}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-flex size-4 items-center justify-center rounded-full bg-sim-badge text-[9px] font-bold text-sim-badge-fg"
            aria-hidden="true"
          >
            1
          </span>
          {l.order}
        </li>
        <li>{l.arrows}</li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-full border border-sim-badge bg-sim-tab"
            aria-hidden="true"
          />
          {l.tabMarker}
        </li>
        <li className="flex items-center gap-1.5">
          <span className={`${swatch} border-sim-part-stroke bg-sim-part`} aria-hidden="true" />
          {l.part}
        </li>
        <li className="flex items-center gap-1.5">
          <span className={`${swatch} border-sheet-edge bg-sheet-waste`} aria-hidden="true" />
          {l.waste}
        </li>
        <li className="flex items-center gap-1.5">
          <span className={`${line} border-dashed border-sim-table`} aria-hidden="true" />
          {l.table}
        </li>
        <li className="flex items-center gap-1.5">
          <span className={`${line} border-dotted border-sim-envelope`} aria-hidden="true" />
          {l.envelope}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-sim-zero" aria-hidden="true" />
          {l.zero}
        </li>
        {grain === null || grain === undefined ? null : (
          <li className="flex items-center gap-1.5" data-grain={grain}>
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
            {l.grain}
          </li>
        )}
      </ul>
    </div>
  );
}
