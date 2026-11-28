'use client';

import { holdTextValues } from '../../lib/hold-text';
import {
  effectiveSpacing,
  minSheetMargin,
  partClearDistance,
  usableOffcuts,
  type LayoutSummary,
  type NestingMode,
  type NestingRotation,
  type ObjectiveCost,
  type OffcutSheet,
  type Project,
  type RunNestingParams,
  type ValidationIssue,
} from '@nittcam/core';
import type { OffcutItem } from '../../lib/offcuts-api';
import { OffcutsPanel } from './offcuts-panel';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import {
  appliedFromCache,
  NestingCache,
  optionSetKey,
  optionSetKeyForMode,
} from '../../lib/nesting-cache';
import type { NestProgressStore } from '../../lib/nesting-progress';
import type { ProjectSession } from '../../lib/project-session';
import {
  NESTING_CANCELLED,
  nestingHost,
  useNestingActivity,
  useNestingWorker,
} from '../../lib/use-nesting-worker';
import {
  LayoutView,
  RenestingContext,
  type LockRequest,
  type PlacementRef,
} from '../layout-view/layout-view';
import { NestingPanel, RunningLabel } from '../parts/nesting-panel';
import { LayoutGrid, Loader2 } from 'lucide-react';
import { focusRing } from '../page/page-header';
import { Button, cn, RadioGroup, RadioGroupItem, Switch } from '@nittcam/ui';
import { NumberField } from './number-field';
import { WorkspaceLayout } from './workspace-layout';
import { drawnParts } from '../layout-view/model';
import { copiesInHoles, rotationGainsNothing } from '../../lib/nest-gain';
import type { TableSpec } from '../../lib/preview3d/stage';

const MODES: readonly NestingMode[] = ['minWaste', 'fastest', 'minToolChanges'];
const ROTATIONS: readonly NestingRotation[] = ['free', 'step45', 'step15', 'none'];

const percent = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const mmText = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
const metres = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** B44: what the current option set gained (null = not nested with these options yet). */
interface NestGain {
  /** 45° / 15° gave the same result as 90° steps. */
  rotationNone: boolean;
  /** Copies placed in a cut-out with "iç boşluk" on; null when off or not nested yet. */
  inHoles: number | null;
}

type NestMessage = { kind: 'error' | 'info'; text: string } | null;

/**
 * Runs nesting in the worker and records the result as one command (D-019). Shared by the "Diz"
 * button of the panel and "Yeniden diz" of the layout view. T163: progress from the worker,
 * "İptal" (the worker is terminated, nothing is recorded, the old layout stays), and results kept
 * per option set (a set nested before is applied again without running the placer).
 */
function useNest(
  session: ProjectSession,
  params: RunNestingParams,
  t: Messages['cutList']['nesting'],
) {
  const worker = useNestingWorker();
  // T384: the run state lives in the page's nesting host, so a run that outlives this step (the
  // user left Dizilim) still records its result and shows as running when the step comes back.
  const activity = useNestingActivity();
  const running = activity !== null;
  const runMode = activity?.mode ?? null;
  // Progress lives in a small store read only by the bar (no re-render of the canvas per tick).
  const progress = worker.host.progress;
  const [message, setMessage] = useState<NestMessage>(null);
  // Counts new "Diz" results so the layout plays its fade/settle-in once per result (T196).
  const [nested, setNested] = useState(0);
  const [cache] = useState(() => new NestingCache());
  // Bumped when the cache changes, so the mode cards re-read their figures.
  const [cacheVersion, setCacheVersion] = useState(0);
  // The latest session: an automatic run (T261) starts after a render that may be stale.
  const latest = useRef({ session, params });
  useEffect(() => {
    latest.current = { session, params };
  });
  // T379: a mode click during a run restarts it; only the latest run may report or stop "running".
  const runId = useRef(0);
  // Bumped by a mode click: the run starts after the render that carries the new mode (the session
  // of the click's render is stale once `setNestingMode` ran).
  const [pendingRun, setPendingRun] = useState(0);

  // Stable (T281): passed to the memoised layout view as "Yeniden diz".
  const nest = useCallback(async () => {
    function record(base: Project, applied: Parameters<ProjectSession['recordApplied']>[1]) {
      const result = latest.current.session.recordApplied('runNesting', applied, base);
      if (!result.ok) {
        setMessage(
          result.error.code === 'STALE_BASE'
            ? { kind: 'error', text: t.stale }
            : { kind: 'error', text: fill(t.failed, { error: result.error.message }) },
        );
        return null;
      }
      if (!result.changed) setMessage({ kind: 'info', text: t.unchanged });
      else setNested((n) => n + 1);
      return result.project;
    }

    const { session, params } = latest.current;
    const base = session.project;
    const key = optionSetKey(base, params);
    const id = ++runId.current;
    setMessage(null);
    const hit = cache.get(key);
    if (hit) {
      record(base, appliedFromCache(base, params, hit.layout));
      return;
    }
    const token = worker.host.begin(base.nesting.mode);
    progress.set(null);
    try {
      const res = await worker.run(base, params, (done, total) => progress.set({ done, total }));
      // A newer run (mode click during this one) owns the messages and the running state.
      if (id !== runId.current) return;
      if (!res.ok) {
        if (res.error === NESTING_CANCELLED) setMessage({ kind: 'info', text: t.cancelled });
        else if (res.error !== 'terminated') {
          setMessage({ kind: 'error', text: fill(t.failed, { error: res.error }) });
        }
        return;
      }
      const after = record(base, res.applied);
      if (after) {
        cache.set(key, after.layout, after, res.cost);
        setCacheVersion((v) => v + 1);
      }
    } finally {
      worker.host.end(token);
    }
  }, [worker, cache, progress, t]);

  /**
   * T379: a mode button nests at once with that mode (one click per goal). The selected mode
   * nests again; a click during a run stops it and restarts with the clicked mode.
   */
  const nestMode = useCallback(
    (mode: NestingMode) => {
      const { session } = latest.current;
      if (worker.host.activity() !== null) worker.cancel();
      if (session.project.nesting.mode !== mode && !session.run('setNestingMode', { mode })) return;
      setPendingRun((n) => n + 1);
    },
    [worker],
  );
  useEffect(() => {
    // The run must start after the render that carries the new mode (see `pendingRun`).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pendingRun > 0) void nest();
  }, [pendingRun, nest]);
  return {
    nest,
    nestMode,
    runMode,
    cancel: worker.cancel,
    running,
    progress,
    message,
    nested,
    cache,
    cacheVersion,
  };
}

/**
 * T281 (memo boundary): the run state of the step. Only the parts that show it (the options
 * panel, the compact "Diz"/"İptal" button, the renest buttons of the layout view) read it, so a
 * run starting or stopping does not re-render the layout view with its 1500 parts.
 */
interface NestRun {
  running: boolean;
  /** T379: the mode being nested while running (its button shows the progress). */
  runMode: NestingMode | null;
  progress: NestProgressStore;
  message: NestMessage;
  nest: () => Promise<void>;
  /** T379: nest with this mode at once (sets the mode first when it differs). */
  nestMode: (mode: NestingMode) => void;
  cancel: () => void;
}
const NestRunContext = createContext<NestRun | null>(null);

/** The warnings panel under the options: a new element on every wizard render (T281). */
const SideContext = createContext<ReactNode>(null);

function useNestRun(): NestRun {
  const run = useContext(NestRunContext);
  if (!run) throw new Error('useNestRun outside LayoutStep');
  return run;
}

/** Step 3 (spec §3.6 "Dizilim"): options + "Diz" on the left, the layout view on the right. */
export function LayoutStep({
  messages,
  session,
  toolDiameter,
  contourTool,
  side,
  table = null,
}: {
  messages: Messages;
  session: ProjectSession;
  toolDiameter: number;
  /** Tool number of the outer contours (the material set's tool), for the tool-change goal. */
  contourTool?: number | undefined;
  /** Extra content under the options (the warnings panel). */
  side: ReactNode;
  /** Machine table for the 3D preview (T152); null without a machine. */
  table?: TableSpec | null;
}) {
  const nt = messages.cutList.nesting;
  const stock = useOffcutStock(session.project);
  const params: RunNestingParams = useMemo(() => {
    const base: RunNestingParams =
      contourTool === undefined ? { toolDiameter } : { toolDiameter, contourTool };
    // T168: the stock offcuts go into the command (recorded in the log, so a replay is the same).
    return stock.offcuts.length > 0 ? { ...base, offcuts: stock.offcuts } : base;
  }, [toolDiameter, contourTool, stock.offcuts]);
  const {
    nest,
    nestMode,
    runMode,
    cancel,
    running,
    progress,
    message,
    nested,
    cache,
    cacheVersion,
  } = useNest(session, params, nt);
  const project: Project = session.project;
  // T261 (D-045): entering Dizilim with parts and no layout runs the nesting once by itself (the
  // same command as "Diz", one undo step). An existing layout (or a locked part) is never
  // re-nested by entering the step. Deferred one tick so a row the cut list drops on leaving
  // (phantom row) is gone first.
  const autoNest = useRef({ nest, session });
  const autoDone = useRef(false);
  useEffect(() => {
    autoNest.current = { nest, session };
  });
  useEffect(() => {
    // T168: with "önce artık parçalar" the first run waits for the offcut stock.
    if (!stock.ready) return;
    const timer = setTimeout(() => {
      const a = autoNest.current;
      if (autoDone.current) return;
      autoDone.current = true;
      const p = a.session.project;
      const hasLayout = p.layout.sheets.some((s) => s.placements.length > 0);
      // T163: not while a redo would bring a layout back (the user just undid it; an automatic run
      // would drop the redo steps). Other redo steps (e.g. the phantom row the cut list took back
      // with undo on leaving) do not stop the first-entry nesting.
      const redoNests = a.session.redoCommand === 'runNesting';
      // T384: a run that outlived an earlier visit of the step is still busy; it brings the layout.
      const busy = nestingHost().activity() !== null;
      if (p.parts.length > 0 && !hasLayout && !redoNests && !busy) void a.nest();
    }, 0);
    return () => clearTimeout(timer);
  }, [stock.ready]);
  const issues: readonly ValidationIssue[] = session.issues;
  const run = session.run;

  // Figures of the option sets already nested, per mode (T163: results kept per option set).
  const modeResults = useMemo(() => {
    void cacheVersion;
    return Object.fromEntries(
      MODES.map((m) => [m, cache.peek(optionSetKeyForMode(project, params, m))?.summary]),
    );
  }, [cache, cacheVersion, project, params]);
  // B44: path and tool changes of the nested option sets (mode cards).
  const modeCosts = useMemo(() => {
    void cacheVersion;
    return Object.fromEntries(
      MODES.map((m) => [m, cache.peek(optionSetKeyForMode(project, params, m))?.cost]),
    ) as Record<string, ObjectiveCost | undefined>;
  }, [cache, cacheVersion, project, params]);
  // B44: feedback when an option gains nothing ("45° kazanç yok", "iç boşluğa 0 parça").
  const gain = useMemo<NestGain>(() => {
    void cacheVersion;
    const current = cache.peek(optionSetKey(project, params));
    const r = project.nesting.rotation ?? 'free';
    let rotationNone = false;
    if (current && (r === 'step45' || r === 'step15')) {
      const coarse = cache.peek(
        optionSetKey({ ...project, nesting: { ...project.nesting, rotation: 'free' } }, params),
      );
      rotationNone = coarse !== undefined && rotationGainsNothing(current.summary, coarse.summary);
    }
    let inHoles: number | null = null;
    if (current && project.nesting.partInHole === true) {
      const nested = { ...project, layout: current.layout };
      inHoles = current.layout.sheets.reduce(
        (n, _s, i) => n + copiesInHoles(drawnParts(nested, i)),
        0,
      );
    }
    return { rotationNone, inHoles };
  }, [cache, cacheVersion, project, params]);

  const nestRun = useMemo<NestRun>(
    () => ({ running, runMode, progress, message, nest, nestMode, cancel }),
    [running, runMode, progress, message, nest, nestMode, cancel],
  );

  // T281: elements and callbacks of the memoised layout view stay the same while a run starts
  // and stops (they change with the project, the options or the warnings panel only).
  const settings = useMemo(
    () => (
      <NestSettings
        messages={messages}
        project={project}
        run={run}
        toolDiameter={toolDiameter}
        modeResults={modeResults}
        modeCosts={modeCosts}
        gain={gain}
        offcutCount={stock.offcuts.length}
        projectId={session.projectId}
      />
    ),
    [
      messages,
      project,
      run,
      toolDiameter,
      modeResults,
      modeCosts,
      gain,
      stock.offcuts.length,
      session.projectId,
    ],
  );
  const hasParts = project.parts.length > 0;
  const modeNames = messages.wizard.layout.modes;
  const currentMode = project.nesting.mode;
  const compactNest = useMemo(
    () => <CompactNest t={nt} modes={modeNames} mode={currentMode} hasParts={hasParts} />,
    [nt, modeNames, currentMode, hasParts],
  );
  const onLock = useCallback((req: LockRequest) => run('lockPlacement', req), [run]);
  const onLockMany = useCallback(
    (refs: PlacementRef[], locked: boolean) => run('lockPlacements', { refs, locked }),
    [run],
  );
  const onRenest = useCallback(() => void nest(), [nest]);
  // The wizard builds a new table object on every render (autosave states); keep it by value.
  const tw = table?.width;
  const td = table?.depth;
  const tc = table?.corner;
  const tx = table?.sheetOffset.x;
  const ty = table?.sheetOffset.y;
  const preview3d = useMemo(
    () => ({
      table:
        tw === undefined ||
        td === undefined ||
        tc === undefined ||
        tx === undefined ||
        ty === undefined
          ? null
          : { width: tw, depth: td, corner: tc, sheetOffset: { x: tx, y: ty } },
    }),
    [tw, td, tc, tx, ty],
  );

  return (
    <NestRunContext.Provider value={nestRun}>
      <SideContext.Provider value={side}>
        <RenestingContext.Provider value={running}>
          {project.layout.sheets.length > 0 ? (
            <LayoutView
              t={messages.layout}
              project={project}
              toolDiameter={toolDiameter}
              issues={issues}
              onLock={onLock}
              onLockMany={onLockMany}
              onRenest={onRenest}
              appearKey={nested}
              left={settings}
              compactAction={compactNest}
              preview3d={preview3d}
            />
          ) : (
            <WorkspaceLayout
              testId="layout-workspace"
              labels={messages.layout.workspace}
              left={settings}
              compactAction={compactNest}
              canvas={
                <div
                  data-testid="layout-empty"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center"
                >
                  <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-fg-muted">
                    <LayoutGrid aria-hidden className="size-5" />
                  </span>
                  <p className="max-w-sm text-sm text-fg-muted">
                    {hasParts ? messages.wizard.layout.empty : messages.wizard.layout.noParts}
                  </p>
                </div>
              }
            />
          )}
        </RenestingContext.Provider>
      </SideContext.Provider>
    </NestRunContext.Provider>
  );
}

/**
 * Below 1024 px "Diz" stays next to the panel buttons, never scrolled away (T198); while it runs
 * the same place offers "İptal" (T163).
 */
function CompactNest({
  t,
  modes,
  mode,
  hasParts,
}: {
  t: Messages['cutList']['nesting'];
  modes: Messages['wizard']['layout']['modes'];
  mode: NestingMode;
  hasParts: boolean;
}) {
  const { running, nestMode, cancel } = useNestRun();
  // T379: no separate "Diz"; below 1024 px the selected goal stays in reach and nests again.
  // While a run goes it shows a spinner and "İptal" appears beside it, never in its place (T374).
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        onClick={() => nestMode(mode)}
        disabled={!hasParts}
        aria-busy={running || undefined}
        data-testid="layout-nest-compact"
        aria-label={fill(t.renestMode, { mode: modes[mode] })}
        className="shrink-0"
      >
        {running ? <Loader2 aria-hidden className="animate-spin" /> : <LayoutGrid aria-hidden />}
        <span className={running ? 'sr-only' : undefined}>{modes[mode]}</span>
      </Button>
      {running ? (
        <Button
          variant="outline"
          onClick={cancel}
          data-testid="layout-cancel-compact"
          className="shrink-0"
        >
          {t.cancel}
        </Button>
      ) : null}
    </div>
  );
}

/** The options panel of the step: mode buttons (T379), gap/margin, rotation and the warnings. */
function NestSettings({
  messages,
  project,
  run,
  toolDiameter,
  modeResults,
  modeCosts,
  gain,
  offcutCount,
  projectId,
}: {
  messages: Messages;
  project: Project;
  run: ProjectSession['run'];
  toolDiameter: number;
  modeResults: Record<string, LayoutSummary | undefined>;
  modeCosts: Record<string, ObjectiveCost | undefined>;
  gain: NestGain;
  /** T168: usable stock offcuts (same material and thickness, matching grain). */
  offcutCount: number;
  projectId: string | null;
}) {
  const { running, runMode, progress, message, nestMode, cancel } = useNestRun();
  const side = useContext(SideContext);
  const t = messages.wizard.layout;
  const nt = messages.cutList.nesting;
  const errors = messages.wizard.machine.errors;
  const spacing = effectiveSpacing(project, toolDiameter);
  const modeLabelId = useId();
  const rotationLabelId = useId();
  const rotationHintId = useId();
  const partInHoleHintId = useId();
  const offcutHintId = useId();
  const rotation: NestingRotation = project.nesting.rotation ?? 'free';
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-xs">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{t.options}</h2>
        <div className="flex flex-col gap-1.5">
          <span id={modeLabelId} className="text-sm font-medium text-fg">
            {t.mode}
          </span>
          <p className="text-xs text-fg-muted">{t.modeHelp}</p>
          {/* T379: one click per goal. Each mode is an action button that nests at once; the
              active result's mode is pressed, and clicking it again nests again. */}
          <div
            role="group"
            aria-labelledby={modeLabelId}
            data-testid="layout-mode"
            data-value={project.nesting.mode}
            className="flex flex-col gap-1.5"
          >
            {MODES.map((m) => {
              const selected = project.nesting.mode === m;
              const busy = running && runMode === m;
              const result = modeResults[m];
              return (
                <button
                  key={m}
                  type="button"
                  data-testid={`layout-mode-${m}`}
                  data-running={busy ? '' : undefined}
                  aria-pressed={selected}
                  aria-busy={busy || undefined}
                  aria-describedby={`${modeLabelId}-${m}`}
                  disabled={project.parts.length === 0}
                  onClick={() => nestMode(m)}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 text-left',
                    'transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-60',
                    focusRing,
                    selected
                      ? 'border-accent-border bg-accent-subtle'
                      : 'border-border bg-surface hover:bg-surface-hover',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5',
                      selected
                        ? 'bg-accent text-accent-fg'
                        : 'border border-border-strong text-fg-muted',
                    )}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <LayoutGrid />}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-fg">
                      {t.modes[m]}
                      {busy ? (
                        <span className="ml-1.5 text-xs font-normal text-fg-muted">
                          <RunningLabel t={nt} store={progress} />
                        </span>
                      ) : null}
                    </span>
                    {/* B44: only the chosen mode shows its hint (screen readers get all). */}
                    <span
                      id={`${modeLabelId}-${m}`}
                      className={selected ? 'text-xs text-fg-muted' : 'sr-only'}
                    >
                      {t.modeHints[m]}
                    </span>
                    {result && result.sheetCount > 0 ? (
                      <span
                        className="text-xs text-fg-subtle tabular-nums"
                        data-testid={`layout-mode-result-${m}`}
                      >
                        {fill(t.modeResult, {
                          sheets: result.sheetCount,
                          waste: fill(nt.percent, { value: percent.format(result.wastePercent) }),
                        })}
                        {m === 'fastest' && modeCosts[m]
                          ? ` · ${fill(t.modeResultPath, { m: metres.format((modeCosts[m]?.cutLength ?? 0) / 1000) })}`
                          : null}
                        {m === 'minToolChanges' && modeCosts[m]
                          ? ` · ${fill(t.modeResultChanges, { count: modeCosts[m]?.toolChanges ?? 0 })}`
                          : null}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {/* T380: pay and margin as one aligned group (subgrid rows: label, input, error, hint),
            equal inputs, each with its own hint; the tabs note once under the group. */}
        <div
          role="group"
          aria-label={t.spacingGroup}
          data-testid="layout-spacing"
          className="grid grid-cols-2 gap-x-3 gap-y-1.5"
        >
          <NumberField
            inRow
            label={t.gap}
            value={project.nesting.gap}
            min={-1}
            errors={errors}
            onCommit={(gap) => run('setNestingOptions', { gap })}
            testId="layout-gap"
            note={
              toolDiameter > 0
                ? {
                    // B67: short on screen (one line in the half-width column at 1440 px),
                    // the full sum on hover and for screen readers.
                    text: fill(t.gapNote, {
                      clear: mmText.format(partClearDistance(toolDiameter, spacing.gap)),
                    }),
                    detail: fill(t.gapNoteDetail, {
                      tool: mmText.format(toolDiameter),
                      gap: mmText.format(spacing.gap),
                      clear: mmText.format(partClearDistance(toolDiameter, spacing.gap)),
                    }),
                    tone: 'muted',
                    testId: 'layout-gap-note',
                  }
                : undefined
            }
          />
          <NumberField
            label={t.margin}
            value={project.nesting.margin}
            min={-1}
            errors={errors}
            onCommit={(margin) => run('setNestingOptions', { margin })}
            inRow
            note={
              // T300 (CTO #12 E1, D-085): below the tool radius the cutter leaves the sheet.
              // D-129: with tabs the effective margin (Ø + 3) is what the placer keeps.
              spacing.margin < minSheetMargin(toolDiameter) - 1e-3
                ? {
                    text: fill(t.marginWarning, {
                      tool: mmText.format(toolDiameter),
                      min: mmText.format(minSheetMargin(toolDiameter)),
                    }),
                    tone: 'warning',
                    testId: 'layout-margin-warning',
                  }
                : toolDiameter > 0
                  ? {
                      text: fill(t.marginHint, {
                        min: mmText.format(minSheetMargin(toolDiameter)),
                      }),
                      tone: 'muted',
                      testId: 'layout-margin-hint',
                    }
                  : undefined
            }
            testId="layout-margin"
          />
        </div>
        {toolDiameter > 0 && (spacing.raised.gap || spacing.raised.margin) ? (
          // D-129: tabs hold only with a 3 mm web, so with tabs the clearance and margin are lifted.
          <p className="text-xs text-fg-muted" data-testid="layout-tab-spacing-note">
            {fill(t.tabSpacingNote, {
              gap: mmText.format(spacing.gap),
              margin: mmText.format(spacing.margin),
              anchor: holdTextValues(project.stock.material).anchor ?? '3',
            })}
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span id={rotationLabelId} className="text-sm font-medium text-fg">
            {t.rotation}
          </span>
          <RadioGroup
            value={rotation}
            onValueChange={(v) => run('setNestingOptions', { rotation: v })}
            aria-labelledby={rotationLabelId}
            aria-describedby={rotationHintId}
            data-testid="layout-rotation"
            data-value={rotation}
            className="gap-1.5"
            disabled={running}
          >
            {ROTATIONS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-fg">
                <RadioGroupItem value={r} aria-label={t.rotations[r]} />
                {t.rotations[r]}
              </label>
            ))}
          </RadioGroup>
          <p id={rotationHintId} className="text-xs text-fg-muted">
            {t.rotationHint}
          </p>
          {gain.rotationNone ? (
            <p className="text-xs text-fg-muted" data-testid="layout-rotation-gain" role="status">
              {fill(t.rotationNoGain, { angle: rotation === 'step15' ? 15 : 45 })}
            </p>
          ) : null}
          <label className="mt-1 flex items-center gap-2 text-sm text-fg">
            <Switch
              checked={project.nesting.partInHole === true}
              onCheckedChange={(on) => run('setNestingOptions', { partInHole: on })}
              disabled={running}
              data-testid="layout-part-in-hole"
              aria-describedby={partInHoleHintId}
            />
            {t.partInHole}
          </label>
          <p id={partInHoleHintId} className="text-xs text-fg-muted">
            {t.partInHoleHint}
          </p>
          {gain.inHoles !== null ? (
            <p
              className="text-xs text-fg-muted"
              data-testid="layout-part-in-hole-result"
              data-count={gain.inHoles}
              role="status"
            >
              {gain.inHoles === 0
                ? t.partInHoleNone
                : fill(t.partInHoleCount, { count: gain.inHoles })}
            </p>
          ) : null}
          <label className="mt-1 flex items-center gap-2 text-sm text-fg">
            <Switch
              checked={project.stock.useOffcuts}
              onCheckedChange={(on) => run('setNestingOptions', { useOffcuts: on })}
              disabled={running}
              data-testid="layout-use-offcuts"
              aria-describedby={offcutHintId}
            />
            {t.useOffcuts}
          </label>
          <p id={offcutHintId} className="text-xs text-fg-muted">
            {t.useOffcutsHint}
            {project.stock.useOffcuts ? (
              <span data-testid="layout-offcut-count" data-count={offcutCount}>
                {' '}
                {fill(t.useOffcutsCount, { count: offcutCount })}
              </span>
            ) : null}
          </p>
        </div>
      </section>
      {/* B44: the result (and "İptal" while a run goes) stays in reach while the options scroll. */}
      <div className="lg:sticky lg:bottom-0 lg:z-10 lg:bg-bg">
        <NestingPanel
          t={nt}
          project={project}
          toolDiameter={toolDiameter}
          running={running}
          progress={progress}
          message={message}
          onCancel={cancel}
        />
      </div>
      <OffcutsPanel
        t={t.offcuts}
        project={project}
        projectId={projectId}
        toolDiameter={toolDiameter}
        disabled={running}
      />
      {side}
    </div>
  );
}

/**
 * T168: the company's available offcuts of the stock material and thickness, matched to the sheet
 * grain. Loaded only with `stock.useOffcuts`; `ready` is false while loading (a failed load =
 * no offcuts, the nesting then uses the stock sheets).
 */
function useOffcutStock(project: Project): { offcuts: OffcutSheet[]; ready: boolean } {
  const { useOffcuts, material, thickness } = project.stock;
  const key = useOffcuts ? `${material}|${thickness}` : '';
  const [loaded, setLoaded] = useState<{ key: string; rows: OffcutItem[] } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const q = new URLSearchParams({ material, thickness: String(thickness), status: 'available' });
    fetch(`/api/offcuts?${q.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<OffcutItem[]>) : []))
      .catch(() => [] as OffcutItem[])
      .then((rows) => {
        if (live) setLoaded({ key, rows });
      });
    return () => {
      live = false;
    };
  }, [key, material, thickness]);
  const stock = project.stock;
  const offcuts = useMemo(
    () => (key && loaded?.key === key ? usableOffcuts({ stock }, loaded.rows) : []),
    [key, loaded, stock],
  );
  return { offcuts, ready: !key || loaded?.key === key };
}
