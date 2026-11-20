'use client';

import type {
  LayoutSummary,
  NestingMode,
  NestingRotation,
  Project,
  RunNestingParams,
  ValidationIssue,
} from '@nittcam/core';
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
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import {
  appliedFromCache,
  NestingCache,
  optionSetKey,
  optionSetKeyForMode,
} from '../../lib/nesting-cache';
import { createNestProgressStore, type NestProgressStore } from '../../lib/nesting-progress';
import type { ProjectSession } from '../../lib/project-session';
import { NESTING_CANCELLED, useNestingWorker } from '../../lib/use-nesting-worker';
import { LayoutView, RenestingContext, type LockRequest } from '../layout-view/layout-view';
import { NestingPanel } from '../parts/nesting-panel';
import { LayoutGrid } from 'lucide-react';
import { Button, cn, RadioGroup, RadioGroupItem } from '@nittcam/ui';
import { NumberField } from './number-field';
import { WorkspaceLayout } from './workspace-layout';
import type { TableSpec } from '../../lib/preview3d/stage';

const MODES: readonly NestingMode[] = ['minWaste', 'fastest', 'minToolChanges'];
const ROTATIONS: readonly NestingRotation[] = ['free', 'none'];

const percent = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

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
  const [running, setRunning] = useState(false);
  // Progress lives in a small store read only by the bar (no re-render of the canvas per tick).
  const [progress] = useState(createNestProgressStore);
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
    setMessage(null);
    const hit = cache.get(key);
    if (hit) {
      record(base, appliedFromCache(base, params, hit.layout));
      return;
    }
    setRunning(true);
    progress.set(null);
    try {
      const res = await worker.run(base, params, (done, total) => progress.set({ done, total }));
      if (!res.ok) {
        if (res.error === NESTING_CANCELLED) setMessage({ kind: 'info', text: t.cancelled });
        else if (res.error !== 'terminated') {
          setMessage({ kind: 'error', text: fill(t.failed, { error: res.error }) });
        }
        return;
      }
      const after = record(base, res.applied);
      if (after) {
        cache.set(key, after.layout, after);
        setCacheVersion((v) => v + 1);
      }
    } finally {
      setRunning(false);
      progress.set(null);
    }
  }, [worker, cache, progress, t]);
  return {
    nest,
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
  progress: NestProgressStore;
  message: NestMessage;
  nest: () => Promise<void>;
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
  const params: RunNestingParams = useMemo(
    () => (contourTool === undefined ? { toolDiameter } : { toolDiameter, contourTool }),
    [toolDiameter, contourTool],
  );
  const { nest, cancel, running, progress, message, nested, cache, cacheVersion } = useNest(
    session,
    params,
    nt,
  );
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
      if (p.parts.length > 0 && !hasLayout && !redoNests) void a.nest();
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const issues: readonly ValidationIssue[] = session.issues;
  const run = session.run;

  // Figures of the option sets already nested, per mode (T163: results kept per option set).
  const modeResults = useMemo(() => {
    void cacheVersion;
    return Object.fromEntries(
      MODES.map((m) => [m, cache.peek(optionSetKeyForMode(project, params, m))?.summary]),
    );
  }, [cache, cacheVersion, project, params]);

  const nestRun = useMemo<NestRun>(
    () => ({ running, progress, message, nest, cancel }),
    [running, progress, message, nest, cancel],
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
      />
    ),
    [messages, project, run, toolDiameter, modeResults],
  );
  const hasParts = project.parts.length > 0;
  const compactNest = useMemo(() => <CompactNest t={nt} hasParts={hasParts} />, [nt, hasParts]);
  const onLock = useCallback((req: LockRequest) => run('lockPlacement', req), [run]);
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
function CompactNest({ t, hasParts }: { t: Messages['cutList']['nesting']; hasParts: boolean }) {
  const { running, nest, cancel } = useNestRun();
  return running ? (
    <Button
      variant="outline"
      onClick={cancel}
      data-testid="layout-cancel-compact"
      className="shrink-0"
    >
      {t.cancel}
    </Button>
  ) : (
    <Button
      onClick={() => void nest()}
      disabled={!hasParts}
      data-testid="layout-nest-compact"
      className="shrink-0"
    >
      <LayoutGrid aria-hidden />
      {t.run}
    </Button>
  );
}

/** The options panel of the step: mode cards, gap/margin, rotation, "Diz" and the warnings. */
function NestSettings({
  messages,
  project,
  run,
  toolDiameter,
  modeResults,
}: {
  messages: Messages;
  project: Project;
  run: ProjectSession['run'];
  toolDiameter: number;
  modeResults: Record<string, LayoutSummary | undefined>;
}) {
  const { running, progress, message, nest, cancel } = useNestRun();
  const side = useContext(SideContext);
  const t = messages.wizard.layout;
  const nt = messages.cutList.nesting;
  const errors = messages.wizard.machine.errors;
  const modeLabelId = useId();
  const rotationLabelId = useId();
  const rotationHintId = useId();
  const rotation: NestingRotation = project.nesting.rotation ?? 'free';
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-xs">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{t.options}</h2>
        <div className="flex flex-col gap-1.5">
          <span id={modeLabelId} className="text-sm font-medium text-fg">
            {t.mode}
          </span>
          <RadioGroup
            value={project.nesting.mode}
            onValueChange={(v) => run('setNestingMode', { mode: v })}
            aria-labelledby={modeLabelId}
            data-testid="layout-mode"
            data-value={project.nesting.mode}
            className="gap-1.5"
            disabled={running}
          >
            {MODES.map((m) => {
              const selected = project.nesting.mode === m;
              const result = modeResults[m];
              return (
                <label
                  key={m}
                  data-testid={`layout-mode-${m}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2',
                    'transition-colors duration-(--duration-fast)',
                    selected
                      ? 'border-accent-border bg-accent-subtle'
                      : 'border-border bg-surface hover:bg-surface-hover',
                  )}
                >
                  <RadioGroupItem
                    value={m}
                    aria-label={t.modes[m]}
                    aria-describedby={`${modeLabelId}-${m}`}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-fg">{t.modes[m]}</span>
                    <span id={`${modeLabelId}-${m}`} className="text-xs text-fg-muted">
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
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <NumberField
            label={t.gap}
            value={project.nesting.gap}
            min={-1}
            errors={errors}
            onCommit={(gap) => run('setNestingOptions', { gap })}
          />
          <NumberField
            label={t.margin}
            value={project.nesting.margin}
            min={-1}
            errors={errors}
            onCommit={(margin) => run('setNestingOptions', { margin })}
          />
        </div>
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
        </div>
      </section>
      <NestingPanel
        t={nt}
        project={project}
        toolDiameter={toolDiameter}
        running={running}
        progress={progress}
        message={message}
        onRun={() => void nest()}
        onCancel={cancel}
      />
      {side}
    </div>
  );
}
