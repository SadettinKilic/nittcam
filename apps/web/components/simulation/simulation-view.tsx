'use client';

import {
  clampSimTime,
  lineAt,
  nextStepTime,
  playbackRate,
  positionAt,
  prevStepTime,
  simPlayheadAt,
  timeForLine,
  type PostProfileVersion,
  type Project,
  type SimMachineFrame,
  type SimSheet,
} from '@nittcam/core';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { fill } from '../../lib/draft-project';
import { useStoredDraft } from '../../lib/draft-store';
import type { MachineDetail, MachineListItem } from '../../lib/machines-api';
import type { SimulationResponse } from '../../lib/simulation-messages';
import { useSimulationWorker } from '../../lib/use-simulation-worker';
import { canvasHeight, drawnParts, type ViewState } from '../layout-view/model';
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
  type Bounds,
  type SimColors,
  type SimText,
} from './model';
import { SummaryCard } from './summary-card';
import { findings, Violations } from './violations';
import { ZStrip } from './z-strip';

const SimulationCanvas = dynamic(() => import('./simulation-canvas'), { ssr: false });

const SPEEDS = [1, 2, 5, 10, 'max'] as const;
type Speed = (typeof SPEEDS)[number];

const playBtn =
  'inline-flex min-w-28 items-center justify-center gap-1.5 rounded-lg border border-accent bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

const MACHINE_KEY = 'nittcam.simulation.machine';
/** Scrubber resolution: tenths of a second. */
const SCRUB_UNITS = 10;

const btn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-bg px-3 py-2 text-sm font-medium hover:bg-sidebar focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

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

function readStoredMachine(): string | null {
  try {
    return window.localStorage.getItem(MACHINE_KEY);
  } catch {
    return null;
  }
}
function storeMachine(id: string): void {
  try {
    window.localStorage.setItem(MACHINE_KEY, id);
  } catch {
    // Remembering the choice is a convenience only.
  }
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

type MachinesState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; list: MachineListItem[] };

interface Run {
  project: Project;
  machineKey: string;
  response: SimulationResponse;
}

/**
 * Simulation screen (T020, spec §6.5, §3.6 step 4). Reads the draft project of the parts step,
 * lets the user pick a machine of the company, runs the export pipeline + reader in a Web Worker
 * and plays the read program back on the sheet.
 */
export function SimulationView({ t }: { t: SimText }) {
  const project = useStoredDraft();
  const runSimulation = useSimulationWorker();
  const [machines, setMachines] = useState<MachinesState>({ status: 'loading' });
  const [chosen, setChosen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; pv: PostProfileVersion } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);

  useEffect(() => {
    let live = true;
    fetch('/api/machines')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const list = (await res.json()) as MachineListItem[];
        if (live) setMachines({ status: 'ready', list });
      })
      .catch(() => {
        if (live) setMachines({ status: 'error' });
      });
    return () => {
      live = false;
    };
  }, []);

  const list = useMemo(() => (machines.status === 'ready' ? machines.list : []), [machines]);
  const machineId = useMemo(() => {
    if (list.length === 0) return null;
    const want = chosen ?? readStoredMachine();
    return list.some((m) => m.id === want) ? want : (list[0]?.id ?? null);
  }, [list, chosen]);

  useEffect(() => {
    if (!machineId) return;
    let live = true;
    fetch(`/api/machines/${encodeURIComponent(machineId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as MachineDetail;
        if (live) {
          setDetail({
            id: d.id,
            pv: { profile: d.profile, version: d.version, verification: d.state },
          });
        }
      })
      .catch(() => {
        if (live) setMachines({ status: 'error' });
      });
    return () => {
      live = false;
    };
  }, [machineId]);

  const current = detail && detail.id === machineId ? detail : null;
  const machineKey = current ? `${current.id}@${current.pv.version}` : null;
  const hasLayout = project !== null && project.layout.sheets.length > 0;

  useEffect(() => {
    if (!project || !hasLayout || !current || !machineKey) return;
    let live = true;
    void runSimulation(project, current.pv).then((response) => {
      if (live) setRun({ project, machineKey, response });
    });
    return () => {
      live = false;
    };
  }, [project, hasLayout, current, machineKey, runSimulation]);

  const fresh = run && run.project === project && run.machineKey === machineKey ? run : null;
  const response = fresh?.response ?? null;
  const result = response?.ok ? response.result : null;
  const sheets = result?.ok ? result.sheets : [];
  const sheet = Math.min(sheetIndex, Math.max(0, sheets.length - 1));
  const sim = sheets[sheet] ?? null;

  const all = useMemo(() => (result ? findings(result) : []), [result]);
  const errorCount = all.filter((f) => f.severity === 'error').length;
  const warnings = useMemo(() => all.filter((f) => f.severity === 'warning'), [all]);

  let body: React.ReactNode;
  if (project === null || !hasLayout) {
    body = (
      <section
        data-testid="sim-empty"
        className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border p-6"
      >
        <h2 className="text-xl font-semibold">{t.empty.title}</h2>
        <p className="text-fg-muted">{t.empty.body}</p>
        <Link
          href="/projeler/yeni/parcalar"
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t.empty.action}
        </Link>
      </section>
    );
  } else if (machines.status === 'error') {
    body = (
      <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">
        {t.machine.error}
      </p>
    );
  } else if (machines.status === 'ready' && list.length === 0) {
    body = (
      <p className="rounded-lg bg-sidebar p-3 text-sm">
        {t.machine.none}{' '}
        <Link href="/makineler" className="font-medium text-accent underline">
          {t.machine.link}
        </Link>
      </p>
    );
  } else if (!response) {
    body = (
      <div
        role="status"
        data-testid="sim-loading"
        className="flex items-center gap-3 rounded-card border border-border p-6 text-fg-muted"
      >
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-border border-t-accent"
        />
        {t.loading}
      </div>
    );
  } else if (!response.ok) {
    body = (
      <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">
        {response.error === 'unknownPost'
          ? fill(t.unknownPost, { post: response.detail })
          : fill(t.failed, { error: response.detail })}
      </p>
    );
  } else if (!response.result.ok || !result?.summary) {
    body = <Violations t={t} result={response.result} />;
  } else {
    body = (
      <>
        <SummaryCard
          t={t}
          summary={result.summary}
          checksOk={errorCount === 0}
          errorCount={errorCount}
          warnings={warnings}
        />
        {sheets.length > 1 ? (
          <div role="tablist" aria-label={t.sheetTabs} className="flex flex-wrap gap-1">
            {sheets.map((s, i) => {
              const active = i === sheet;
              return (
                <button
                  key={s.sheet}
                  type="button"
                  role="tab"
                  id={`sim-tab-${i}`}
                  aria-selected={active}
                  aria-controls="sim-panel"
                  onClick={() => setSheetIndex(i)}
                  className={`rounded-lg border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-bg hover:bg-sidebar'}`}
                >
                  {fill(t.sheetTab, { n: s.sheet + 1 })}
                  <span className="ml-1 text-xs opacity-80">
                    {fill(t.sheetTabTime, { time: formatDuration(t, s.duration) })}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {sim ? (
          <Player
            key={`${machineKey}-${sim.sheet}`}
            t={t}
            sim={sim}
            project={project}
            machine={result.machine}
          />
        ) : null}
      </>
    );
  }

  const profile = current?.pv.profile;
  const unverified =
    current !== null && (current.pv.verification !== 'verified' || current.pv.profile.example);

  return (
    <main className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <Link
          href="/projeler/yeni/parcalar"
          className="w-fit text-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t.back}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-fg-muted">{t.subtitle}</p>
      </header>

      <p
        role="note"
        data-testid="sim-banner"
        className="sticky top-0 z-10 flex flex-col gap-0.5 rounded-lg border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-warn shadow-sm sm:flex-row sm:items-baseline sm:gap-2"
      >
        <strong className="font-semibold">⚠ {t.banner}</strong>
        <span className="hidden sm:inline">{t.bannerDetail}</span>
      </p>

      {hasLayout ? (
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
            <span className="font-medium">{t.machine.label}</span>
            <select
              data-testid="sim-machine"
              value={machineId ?? ''}
              disabled={list.length === 0}
              onChange={(e) => {
                setChosen(e.target.value);
                storeMachine(e.target.value);
                setSheetIndex(0);
              }}
              className="w-full max-w-md rounded-md border border-border bg-bg px-2 py-1.5"
            >
              {machines.status === 'loading' ? <option value="">{t.machine.loading}</option> : null}
              {list.map((m) => (
                <option key={m.id} value={m.id}>
                  {fill(t.machine.option, { name: m.name, version: m.version })}
                </option>
              ))}
            </select>
          </label>
          {profile ? (
            <p className="text-xs text-fg-muted">
              {fill(t.machine.envelope, {
                x: formatMm(profile.workEnvelope.x),
                y: formatMm(profile.workEnvelope.y),
                w: formatMm(profile.table.width),
                d: formatMm(profile.table.depth),
                post: `${profile.post.id} ${profile.post.version}`,
              })}
            </p>
          ) : null}
          {unverified ? <p className="text-xs text-warn">{t.machine.unverified}</p> : null}
        </div>
      ) : null}

      {body}
    </main>
  );
}

/** Scale and pan that show `b` (sheet frame, mm) centred in the canvas. */
function fitBounds(b: Bounds, sheetHeight: number, width: number, height: number): ViewState {
  const pad = 8;
  const scale = Math.max(
    0.0001,
    Math.min((width - 2 * pad) / b.width, (height - 2 * pad) / b.height),
  );
  const top = sheetHeight - b.y - b.height;
  return {
    scale,
    x: (width - b.width * scale) / 2 - b.x * scale,
    y: (height - b.height * scale) / 2 - top * scale,
  };
}

/** The playback of one sheet: canvas, controls, Z strip, readout, legend and G-code panel. */
function Player({
  t,
  sim,
  project,
  machine,
}: {
  t: SimText;
  sim: SimSheet;
  project: Project;
  machine: SimMachineFrame | null;
}) {
  const reduced = useReducedMotion();
  const [time, setTimeState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(5);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<ViewState | null>(null);
  const [colors, setColors] = useState<SimColors | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const duration = sim.duration;
  const stock = project.stock.sheet;
  const bounds = useMemo(() => simBounds(stock, machine), [stock, machine]);
  const height = width > 0 ? canvasHeight(bounds, width) : 0;
  const parts = useMemo(() => drawnParts(project, sim.sheet), [project, sim.sheet]);

  const setTime = useCallback(
    (v: number) => {
      const c = clampSimTime(duration, v);
      timeRef.current = c;
      setTimeState(c);
    },
    [duration],
  );

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w <= 0 || w === last) return;
      last = w;
      setColors((c) => c ?? readSimColors());
      setWidth(w);
      setView(fitBounds(bounds, stock.height, w, canvasHeight(bounds, w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [bounds, stock.height]);

  const fit = useCallback(() => {
    if (width > 0) setView(fitBounds(bounds, stock.height, width, canvasHeight(bounds, width)));
  }, [bounds, stock.height, width]);

  // Playback: one animation frame per redraw; the time advances by real time × speed.
  const active = playing && !reduced;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const rate = playbackRate(speed, duration);
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const next = Math.min(duration, timeRef.current + dt * rate);
      timeRef.current = next;
      setTimeState(next);
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
  }, [active, speed, duration]);

  const togglePlay = useCallback(() => {
    if (reduced) return;
    if (!playing && timeRef.current >= duration) setTime(0);
    setPlaying((p) => !p);
  }, [reduced, playing, duration, setTime]);
  const stepNext = useCallback(() => {
    setPlaying(false);
    setTime(nextStepTime(sim.steps, timeRef.current, duration));
  }, [sim.steps, duration, setTime]);
  const stepPrev = useCallback(() => {
    setPlaying(false);
    setTime(prevStepTime(sim.steps, timeRef.current));
  }, [sim.steps, setTime]);
  const toStart = useCallback(() => {
    setPlaying(false);
    setTime(0);
  }, [setTime]);
  const toEnd = useCallback(() => {
    setPlaying(false);
    setTime(duration);
  }, [duration, setTime]);
  const seekLine = useCallback(
    (file: number, line: number) => {
      setPlaying(false);
      setTime(timeForLine(sim.steps, file, line, duration));
    },
    [sim.steps, duration, setTime],
  );
  const seekTime = useCallback(
    (v: number) => {
      setPlaying(false);
      setTime(v);
    },
    [setTime],
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
  const line = lineAt(sim.steps, time);
  const stepIndex = ph.active >= 0 ? ph.active : ph.done - 1;
  const step = sim.steps[stepIndex];
  const diameter = step ? toolDiameterOf(sim, step.tool) : null;
  const ramp = colors ? depthRamp(colors.depthTop, colors.depthBottom, 6) : [];
  const clock = fill(t.controls.clock, { now: formatClock(time), total: formatClock(duration) });
  const panelHeight = Math.max(280, height + 56 + 12);

  function zoomButton(factor: number) {
    if (!view || width <= 0) return;
    setView(zoomAt(view, factor, width / 2, height / 2));
  }

  return (
    <div
      id="sim-panel"
      role="tabpanel"
      className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn} onClick={() => zoomButton(1.25)}>
            <span aria-hidden="true">+</span> {t.controls.zoomIn}
          </button>
          <button type="button" className={btn} onClick={() => zoomButton(1 / 1.25)}>
            <span aria-hidden="true">−</span> {t.controls.zoomOut}
          </button>
          <button type="button" className={btn} onClick={fit}>
            {t.controls.fit}
          </button>
        </div>

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
          className="relative w-full min-w-0 touch-none overflow-hidden rounded-lg border border-border bg-sidebar focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{ height: height || undefined, minHeight: 220 }}
        >
          {width > 0 && view && colors ? (
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
              onViewChange={(v) => setView({ ...v, scale: clampScale(v.scale) })}
              grainLabel={t.legend.grain}
            />
          ) : null}
        </div>

        {colors && width > 0 ? (
          <ZStrip t={t} sim={sim} width={width} time={time} colors={colors} onSeek={seekTime} />
        ) : null}

        <div
          role="group"
          aria-label={t.controls.label}
          className="flex flex-col gap-3 rounded-lg border border-border p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btn}
              onClick={toStart}
              aria-label={t.controls.start}
              aria-keyshortcuts="Home"
              title={t.controls.start}
            >
              <span aria-hidden="true">⏮</span>
            </button>
            <button
              type="button"
              className={btn}
              onClick={stepPrev}
              aria-label={t.controls.prev}
              aria-keyshortcuts="ArrowLeft"
              title={t.controls.prev}
            >
              <span aria-hidden="true">◀</span>
            </button>
            <button
              type="button"
              className={playBtn}
              onClick={togglePlay}
              disabled={reduced}
              aria-keyshortcuts="Space"
              data-testid="sim-play"
            >
              <span aria-hidden="true">{active ? '❚❚' : '▶'}</span>
              {active ? t.controls.pause : t.controls.play}
            </button>
            <button
              type="button"
              className={btn}
              onClick={stepNext}
              aria-label={t.controls.next}
              aria-keyshortcuts="ArrowRight"
              title={t.controls.next}
            >
              <span aria-hidden="true">▶</span>
            </button>
            <button
              type="button"
              className={btn}
              onClick={toEnd}
              aria-label={t.controls.end}
              aria-keyshortcuts="End"
              title={t.controls.end}
            >
              <span aria-hidden="true">⏭</span>
            </button>
            <div
              role="group"
              aria-label={t.controls.speed}
              className="ml-auto flex items-center gap-1"
            >
              <span className="text-xs text-fg-muted">{t.controls.speed}</span>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={speed === s}
                  disabled={reduced}
                  onClick={() => setSpeed(s)}
                  className={`rounded-md border px-2 py-1 text-xs font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${speed === s ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-bg hover:bg-sidebar'}`}
                >
                  {s === 'max' ? t.controls.speedMax : `${s}×`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
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
              className="min-w-0 flex-1 accent-accent"
            />
            <span className="shrink-0 text-sm tabular-nums" data-testid="sim-clock">
              {clock}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-live="off">
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
          {reduced ? (
            <p className="text-xs text-info" data-testid="sim-reduced-note">
              {t.controls.reducedMotion}
            </p>
          ) : null}
          <p className="text-xs text-fg-muted">{t.controls.shortcuts}</p>
        </div>

        <Legend t={t} ramp={ramp} zBottom={sim.zBottom} grain={stock.grain} />
      </div>

      <GcodePanel t={t} files={sim.files} current={line} height={panelHeight} onSeek={seekLine} />
    </div>
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
  grain: 0 | 90;
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
          className="inline-block h-3 w-32 rounded-sm border border-border"
          style={{
            background: ramp.length ? `linear-gradient(to right, ${ramp.join(', ')})` : undefined,
          }}
        />
        <span>{fill(l.depthBottom, { z: formatMm(zBottom) })}</span>
        <span>· {l.tabs}</span>
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
        <li className="flex items-center gap-1.5" data-grain={grain}>
          <svg
            viewBox="0 0 24 24"
            className="size-4 text-fg"
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
          {l.grain}
        </li>
      </ul>
    </div>
  );
}
