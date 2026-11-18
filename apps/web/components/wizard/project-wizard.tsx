'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from 'react';
import { fill, newProject, toolDiameterFor } from '../../lib/draft-project';
import type { MachineDetail, MachineListItem } from '../../lib/machines-api';
import type { Messages } from '../../lib/messages';
import { useProjectSession, type SessionInit } from '../../lib/project-session';
import type { ProjectDetail, ProjectListItem } from '../../lib/projects-api';
import { untitledName } from '../../lib/untitled-name';
import { CutListEditor } from '../parts/cut-list-editor';
import { SimulationView, type SimMachine } from '../simulation/simulation-view';
import { ExportStep } from './export-step';
import { LayoutStep } from './layout-step';
import { MachineFields, SheetPreview } from './machine-step';
import { ProfileStatusChip, profileReasons } from './profile-status';
import { ValidationPanel } from './validation-panel';
import {
  STEPS,
  saveIndicator,
  stepBlocker,
  toStep,
  wizardStepStatuses,
  type SaveIndicator,
  type StepKey,
  type WizardProgress,
  type WizardStepStatus,
} from '../../lib/wizard-steps';
import { Callout, Panel, canvasWellClass, panelClass } from './panels';
import { focusRing } from '../page/page-header';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileOutput,
  CircleAlert,
  Cloud,
  CloudAlert,
  CloudCheck,
  Info,
  Loader2,
  Lock,
  Redo2,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import {
  Badge,
  Button,
  ErrorState,
  IconButton,
  NestingIcon,
  RouterIcon,
  SheetIcon,
  ToolpathIcon,
  Tooltip,
  notify,
} from '@nittcam/ui';
import { ariaKeyShortcuts, shortcutById } from '../../lib/shortcuts';
import { PageSkeleton } from '../feedback/page-skeleton';
import { ShellStatus, useShellTitle } from '../shell/shell-context';

const NEW_PATH = '/projeler/yeni';

function stepUrl(id: string | null, step: StepKey): string {
  return `${id ? `/projeler/${id}` : NEW_PATH}?adim=${step}`;
}

/**
 * History entries of wizard steps carry this marker (D-029, D-030: steps are `pushState` entries,
 * so browser Back goes to the previous step). Next.js keeps extra keys in its history state.
 */
const STEP_STATE = 'nittcamStep';

function isStepEntry(): boolean {
  if (typeof window === 'undefined') return false;
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null && STEP_STATE in state;
}

/**
 * The URL the last browser Back/forward landed on. Next.js copies extra history-state keys into the
 * entries it pushes, so a real navigation (e.g. "+ Yeni proje") also looks like a step entry; only
 * a `popstate` tells the two apart.
 */
let poppedHref: string | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    poppedHref = window.location.href;
  });
}

/**
 * Did the router move to `pathname` because of browser Back/forward onto a wizard step entry?
 * After a `popstate` the address bar already shows the new URL; during a link navigation the
 * render runs while it still shows the old one. Pure (no consumed mark), so a StrictMode double
 * render gives the same answer.
 */
function cameBackToStep(pathname: string): boolean {
  return (
    poppedHref !== null &&
    poppedHref === window.location.href &&
    window.location.pathname === pathname &&
    isStepEntry()
  );
}

type Loaded =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'notFound' }
  | {
      status: 'ready';
      machines: MachineListItem[];
      init: SessionInit;
      firstDetail: MachineDetail | null;
    };

async function getJson<T>(url: string): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: (await res.json()) as T };
}

/**
 * The Oluştur wizard (T023, spec §3.6): loads the company's machines and the project (or starts a
 * new one that the first autosave creates), then runs the five steps on one project session.
 */
export function ProjectWizard({
  messages,
  projectId,
  step,
}: {
  messages: Messages;
  projectId: string | null;
  step: StepKey;
}) {
  const t = messages.wizard;
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // A new project gets its id from the first save; "+ Yeni proje" afterwards starts another one.
  const pathname = usePathname();
  const [created, setCreated] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    // Back/forward onto an earlier step entry of this project (its URL still says `yeni`) is not
    // a new project; only a real navigation to `/projeler/yeni` is.
    const back = typeof window !== 'undefined' && cameBackToStep(pathname);
    if (pathname === NEW_PATH && created !== null && !back) {
      setCreated(null);
      setAttempt((a) => a + 1);
    }
  }

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const machines = await getJson<MachineListItem[]>('/api/machines');
        if (!machines.body) throw new Error(String(machines.status));
        let init: SessionInit;
        let firstDetail: MachineDetail | null = null;
        if (projectId) {
          const p = await getJson<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`);
          if (p.status === 404) {
            if (live) setLoaded({ status: 'notFound' });
            return;
          }
          if (!p.body) throw new Error(String(p.status));
          init = {
            id: p.body.id,
            revision: p.body.revision,
            name: p.body.name,
            project: p.body.project,
          };
        } else {
          const first = machines.body[0];
          if (first) {
            firstDetail = (await getJson<MachineDetail>(`/api/machines/${first.id}`)).body;
          }
          // "Adsız proje" + counter (T194a); a failed list only drops the counter.
          const names = await getJson<ProjectListItem[]>('/api/projects').then(
            (r) => (r.body ?? []).map((p) => p.name),
            () => [],
          );
          init = {
            id: null,
            revision: 0,
            name: untitledName(t.defaultName, names),
            project: newProject(firstDetail ?? undefined),
          };
        }
        if (live) setLoaded({ status: 'ready', machines: machines.body, init, firstDetail });
      } catch {
        if (live) setLoaded({ status: 'error' });
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId, attempt, t.defaultName]);

  const reload = useCallback(() => {
    setLoaded({ status: 'loading' });
    setAttempt((a) => a + 1);
  }, []);

  if (loaded.status === 'loading') {
    return <PageSkeleton label={t.loading} variant="split" testId="wizard-loading" />;
  }
  if (loaded.status !== 'ready') {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col items-start gap-4 px-4 py-8 sm:px-6">
        <ErrorState
          data-testid="wizard-error"
          className="w-full"
          title={loaded.status === 'notFound' ? t.notFound : t.loadError}
          retryLabel={t.retry}
          {...(loaded.status === 'error' ? { onRetry: reload } : {})}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link href="/projeler">{t.backToList}</Link>
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <WizardSession
      key={`${projectId ?? 'new'}-${attempt}`}
      messages={messages}
      initialStep={step}
      machines={loaded.machines}
      init={loaded.init}
      firstDetail={loaded.firstDetail}
      onReload={reload}
      onCreated={setCreated}
    />
  );
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio'
  );
}

/** Two-column layout per step (§3.6: fields panel left, preview right); wide content needs room. */
const GRID: Record<StepKey, string> = {
  makine: 'lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]',
  parcalar: 'xl:grid-cols-[17rem_minmax(0,1fr)]',
  dizilim: 'xl:grid-cols-[19rem_minmax(0,1fr)]',
  simulasyon: '2xl:grid-cols-[17rem_minmax(0,1fr)]',
  export: 'lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]',
};

/** On narrow screens the main work area comes first; warnings follow it. */
const LEFT_ORDER: Record<StepKey, string> = {
  makine: '',
  parcalar: 'order-last xl:order-none',
  dizilim: '',
  simulasyon: 'order-last 2xl:order-none',
  export: '',
};

function WizardSession({
  messages,
  initialStep,
  machines,
  init,
  firstDetail,
  onReload,
  onCreated,
}: {
  messages: Messages;
  initialStep: StepKey;
  machines: MachineListItem[];
  init: SessionInit;
  firstDetail: MachineDetail | null;
  onReload: () => void;
  onCreated: (id: string) => void;
}) {
  const t = messages.wizard;
  const router = useRouter();
  const [step, setStep] = useState<StepKey>(initialStep);
  const stepRef = useRef(step);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);

  // Machine profiles by id (the selected one is fetched when the selection changes).
  const [details, setDetails] = useState<Record<string, MachineDetail>>(() =>
    firstDetail ? { [firstDetail.id]: firstDetail } : {},
  );
  const [detailError, setDetailError] = useState(false);

  const created = useCallback(
    (id: string) => {
      window.history.replaceState(
        { [STEP_STATE]: stepRef.current },
        '',
        stepUrl(id, stepRef.current),
      );
      onCreated(id);
    },
    [onCreated],
  );

  // The session needs the profile for validation; it is read from the latest state each render.
  const [machineId, setMachineId] = useState(init.project.machine.machineId);
  const detail = details[machineId] ?? null;
  const session = useProjectSession({
    initial: init,
    machine: detail?.profile ?? null,
    onCreated: created,
  });
  const project = session.project;
  // Save failures are announced once as a toast (T105); autosave keeps retrying.
  const saveFailed = session.saveState === 'error';
  useEffect(() => {
    if (!saveFailed) return;
    notify.error(messages.feedback.saveError, {
      id: 'save-error',
      description: messages.feedback.saveErrorText,
    });
  }, [saveFailed, messages.feedback.saveError, messages.feedback.saveErrorText]);
  // Top-bar title (T103): the project name once it is saved, "Yeni proje" before.
  useShellTitle(session.projectId ? session.name : null);
  if (project.machine.machineId !== machineId) setMachineId(project.machine.machineId);

  const known = machines.some((m) => m.id === machineId);
  useEffect(() => {
    if (!known || details[machineId]) return;
    let live = true;
    fetch(`/api/machines/${encodeURIComponent(machineId)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as MachineDetail;
        if (live) setDetails((all) => ({ ...all, [d.id]: d }));
      })
      .catch(() => {
        if (live) setDetailError(true);
      });
    return () => {
      live = false;
    };
  }, [machineId, known, details]);

  const profile = detail?.profile ?? null;
  const simMachine: SimMachine | null = useMemo(() => {
    const d = details[machineId];
    return d
      ? { id: d.id, pv: { profile: d.profile, version: d.version, verification: d.state } }
      : null;
  }, [details, machineId]);
  const toolDiameter = toolDiameterFor(project, profile);

  const go = useCallback(
    (next: StepKey) => {
      setStep(next);
      focusHeading.current = true;
      if (next !== stepRef.current || !isStepEntry()) {
        window.history.pushState({ [STEP_STATE]: next }, '', stepUrl(session.projectId, next));
      }
      stepRef.current = next;
    },
    [session.projectId],
  );

  // The entry the wizard opened on is a step entry too, so Back from step 2 returns to it.
  useEffect(() => {
    if (!isStepEntry()) {
      window.history.replaceState(
        { [STEP_STATE]: stepRef.current },
        '',
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  // Browser Back/forward between steps: follow the URL's `?adim=` (no new entry).
  const projectIdRef = useRef(session.projectId);
  useEffect(() => {
    projectIdRef.current = session.projectId;
  }, [session.projectId]);
  useEffect(() => {
    function onPop() {
      if (!isStepEntry()) return;
      const next = toStep(new URLSearchParams(window.location.search).get('adim') ?? undefined);
      stepRef.current = next;
      setStep(next);
      focusHeading.current = true;
      // An entry from before the first save still says `/projeler/yeni`: point it at the project.
      const id = projectIdRef.current;
      if (id && window.location.pathname === NEW_PATH) {
        window.history.replaceState({ [STEP_STATE]: next }, '', stepUrl(id, next));
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (focusHeading.current) {
      focusHeading.current = false;
      heading.current?.focus();
    }
  }, [step]);

  // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) outside text fields, in every step.
  const { undo, redo } = session;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextField(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const index = STEPS.indexOf(step);
  const progress = { partCount: project.parts.length, sheetCount: project.layout.sheets.length };
  const validation = <ValidationPanel t={t.issues} project={project} issues={session.issues} />;

  let left: ReactNode = null;
  let right: ReactNode = null;
  let both: ReactNode = null;
  // Dizilim and Simülasyon are canvas-first workspaces that fill the viewport (T197).
  const workspace = step === 'dizilim' || step === 'simulasyon';
  if (step === 'makine') {
    left = (
      <div className="flex min-w-0 flex-col gap-4">
        {machines.length === 0 ? (
          <Callout tone="warning" role="alert" icon={<TriangleAlert aria-hidden />}>
            <p>
              {t.noMachines}{' '}
              <Link href="/makineler" className={`font-medium underline ${focusRing}`}>
                {t.machinesLink}
              </Link>
            </p>
          </Callout>
        ) : (
          <Panel>
            <MachineFields
              t={t.machine}
              materials={messages.materials}
              machinesLink={t.machinesLink}
              project={project}
              machines={machines}
              detail={detail}
              issues={session.issues}
              run={session.run}
            />
          </Panel>
        )}
        {validation}
      </div>
    );
    right = <SheetPreview t={t.machine} project={project} profile={profile} />;
  } else if (step === 'parcalar') {
    left = <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20">{validation}</aside>;
    right = (
      <CutListEditor
        t={messages.cutList}
        project={project}
        issues={session.issues}
        run={session.run}
      />
    );
  } else if (step === 'dizilim') {
    both = (
      <LayoutStep
        messages={messages}
        session={session}
        toolDiameter={toolDiameter}
        side={validation}
      />
    );
  } else if (step === 'simulasyon') {
    both = (
      <SimulationView
        left={validation}
        t={messages.simulation}
        project={project}
        machine={simMachine}
        empty={{
          noLayout: (
            <section
              data-testid="sim-empty"
              className={`${canvasWellClass} flex flex-col items-start gap-4 border-dashed p-6 sm:p-8`}
            >
              <p className="max-w-prose text-sm text-fg-muted">{t.simulation.empty}</p>
              <Button onClick={() => go('dizilim')}>
                {t.simulation.toLayout}
                <ArrowRight aria-hidden />
              </Button>
            </section>
          ),
          noMachine: (
            <Callout tone="warning" role="alert" icon={<TriangleAlert aria-hidden />}>
              <p>{detailError ? t.machinesError : t.simulation.noMachine}</p>
            </Callout>
          ),
        }}
      />
    );
  } else {
    both = (
      <ExportStep
        t={t.export}
        corners={messages.machines.form.options.corner}
        states={messages.machines.state}
        project={project}
        machine={simMachine}
        projectId={session.projectId}
        revision={session.revision}
        saved={!session.dirty}
        saveState={session.saveState}
      />
    );
  }

  const saveText =
    session.saveState === 'idle'
      ? session.projectId === null
        ? t.save.new
        : t.save.saved
      : session.saveState === 'saved'
        ? t.save.saved
        : session.saveState === 'error'
          ? t.save.retrying
          : session.saveState === 'conflict'
            ? t.save.error
            : t.save.saving;
  const indicator = saveIndicator(session.saveState, session.projectId !== null);
  const nextKey = STEPS[index + 1];

  return (
    <main
      data-workspace={workspace ? '' : undefined}
      className={`mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full min-w-0 flex-col gap-5 px-4 pt-5 sm:px-6 lg:px-8 ${workspace ? 'max-w-none lg:h-[calc(100dvh-3.5rem)] lg:gap-3 lg:overflow-hidden lg:pt-3' : 'max-w-[96rem]'}`}
    >
      {/* One header row on ≥ 1400 px (T197; narrower screens would squeeze the stepper): project name, stepper, undo/redo. */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-5 min-[1400px]:flex-nowrap min-[1400px]:items-center">
        <header className="contents">
          <NameField
            label={t.nameLabel}
            value={session.name}
            onCommit={session.rename}
            autoSelect={session.projectId === null && step === 'makine'}
          />
          <div className="order-2 flex items-center gap-1 min-[1400px]:order-3">
            {simMachine ? (
              <ProfileStatusChip
                t={t.profileStatus}
                detail={t.machine.unverified}
                reasons={profileReasons({
                  verification: simMachine.pv.verification,
                  example: simMachine.pv.profile.example,
                })}
                reasonText={t.export.reasons}
                machineId={simMachine.id}
              />
            ) : null}
            <ShellStatus>
              <Badge
                dot
                variant={
                  session.saveState === 'error' || session.saveState === 'conflict'
                    ? 'danger'
                    : session.saveState === 'saved' ||
                        (session.saveState === 'idle' && session.projectId)
                      ? 'success'
                      : 'neutral'
                }
                aria-live="polite"
                title={t.save.label}
                data-testid="save-status"
                data-state={session.saveState}
                data-revision={session.revision}
                className="max-w-full min-w-0 shrink"
              >
                <span className="truncate">{saveText}</span>
              </Badge>
            </ShellStatus>
            <Tooltip content={messages.cutList.undo}>
              <IconButton
                aria-label={messages.cutList.undo}
                variant="ghost"
                onClick={session.undo}
                disabled={!session.canUndo}
                aria-keyshortcuts={ariaKeyShortcuts(shortcutById('undo').keys, false)}
              >
                <Undo2 aria-hidden />
              </IconButton>
            </Tooltip>
            <Tooltip content={messages.cutList.redo}>
              <IconButton
                aria-label={messages.cutList.redo}
                variant="ghost"
                onClick={session.redo}
                disabled={!session.canRedo}
                aria-keyshortcuts={ariaKeyShortcuts(shortcutById('redo').keys, false)}
              >
                <Redo2 aria-hidden />
              </IconButton>
            </Tooltip>
          </div>
        </header>

        <div className="order-3 w-full min-w-0 min-[1400px]:order-2 min-[1400px]:w-auto min-[1400px]:flex-1">
          <StepIndicator
            t={t.steps}
            headingRef={heading}
            current={step}
            statuses={wizardStepStatuses(step, progress)}
            progress={progress}
            onGo={go}
          />
        </div>
      </div>

      {session.saveState === 'conflict' ? (
        <ConflictNotice
          t={t.conflict}
          name={session.name}
          projectId={session.projectId}
          project={project}
          onReload={() => {
            session.discard();
            onReload();
          }}
          onCopied={(id) => {
            session.discard();
            router.push(stepUrl(id, step));
          }}
        />
      ) : null}
      {session.restoredCount > 0 ? (
        <Callout tone="info" role="status" icon={<Info aria-hidden />}>
          <p>{fill(t.restored, { count: session.restoredCount })}</p>
        </Callout>
      ) : null}

      {step === 'parcalar' ? (
        <p className="-mt-2 max-w-prose text-sm text-fg-muted">{messages.cutList.subtitle}</p>
      ) : null}

      <div
        className={
          workspace
            ? 'min-w-0 lg:min-h-0 lg:flex-1'
            : `grid min-w-0 items-start gap-5 ${GRID[step]}`
        }
      >
        {both ?? (
          <>
            <div className={`min-w-0 ${LEFT_ORDER[step]}`}>{left}</div>
            <div className="min-w-0">{right}</div>
          </>
        )}
      </div>

      <nav
        aria-label={t.steps.label}
        data-testid="wizard-footer"
        data-wizard-footer=""
        className="sticky bottom-0 z-20 -mx-4 mt-auto border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            data-testid="wizard-back"
            disabled={index === 0}
            onClick={() => go(STEPS[index - 1] ?? 'makine')}
          >
            <ArrowLeft aria-hidden />
            {t.back}
          </Button>
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <span aria-hidden className="hidden text-fg-muted tabular-nums sm:inline">
              {fill(t.steps.counter, { n: index + 1, total: STEPS.length })}
            </span>
            <span aria-hidden className="hidden h-4 w-px bg-border sm:inline-block" />
            <AutosaveIndicator t={t.save.short} state={indicator} />
          </div>
          {nextKey ? (
            <Button
              data-testid="wizard-next"
              onClick={() => go(nextKey)}
              title={fill(t.steps.nextStep, { name: t.steps[nextKey] })}
            >
              {t.next}
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <span aria-hidden className="w-20" />
          )}
        </div>
      </nav>
    </main>
  );
}

/** Footer autosave state: icon + short word (the live announcement is the top-bar badge). */
function AutosaveIndicator({
  t,
  state,
}: {
  t: Messages['wizard']['save']['short'];
  state: SaveIndicator;
}) {
  const icon = {
    saved: <CloudCheck aria-hidden className="size-4 text-success-text" />,
    saving: <Loader2 aria-hidden className="size-4 animate-spin text-fg-muted" />,
    error: <CloudAlert aria-hidden className="size-4 text-danger-text" />,
    new: <Cloud aria-hidden className="size-4 text-fg-subtle" />,
  }[state];
  return (
    <span
      data-testid="autosave-indicator"
      data-state={state}
      className={`flex items-center gap-1.5 whitespace-nowrap ${state === 'error' ? 'font-medium text-danger-text' : 'text-fg-muted'}`}
    >
      {icon}
      {t[state]}
    </span>
  );
}

/** Domain icon of each wizard step (T194a). */
const STEP_ICONS: Record<StepKey, ComponentType<{ className?: string }>> = {
  makine: RouterIcon,
  parcalar: SheetIcon,
  dizilim: NestingIcon,
  simulasyon: ToolpathIcon,
  export: FileOutput,
};

/**
 * Step title + stepper in one panel (T195): the H1 is the active step's label, so the step
 * name is written once (no second heading under the stepper).
 */
function StepIndicator({
  t,
  headingRef,
  current,
  statuses,
  progress,
  onGo,
}: {
  t: Messages['wizard']['steps'];
  headingRef: RefObject<HTMLHeadingElement | null>;
  current: StepKey;
  statuses: readonly WizardStepStatus[];
  progress: WizardProgress;
  onGo: (step: StepKey) => void;
}) {
  const index = STEPS.indexOf(current);
  const StepIcon = STEP_ICONS[current];
  return (
    <div
      className={`${panelClass} flex flex-col gap-2 px-3 py-2.5 sm:px-4 lg:flex-row lg:items-center lg:gap-6`}
    >
      <div className="flex min-w-0 items-center gap-3 lg:shrink-0">
        <span
          aria-hidden="true"
          className="hidden size-9 shrink-0 items-center justify-center rounded-lg border border-accent-border bg-accent-subtle text-accent-text sm:flex [&_svg]:size-5"
        >
          <StepIcon />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">
            {fill(t.stepOf, { n: index + 1, total: STEPS.length })}
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            data-testid="wizard-step-title"
            data-step={current}
            className="truncate text-lg leading-tight font-semibold tracking-tight text-fg focus:outline-none sm:text-xl"
          >
            {t[current]}
          </h1>
        </div>
      </div>
      <nav aria-label={t.label} className="min-w-0 lg:flex-1">
        <ol className="flex items-center gap-1" data-testid="wizard-steps">
          {STEPS.map((s, i) => {
            const status = statuses[i] ?? 'upcoming';
            const active = status === 'current';
            const blocker = stepBlocker(s, progress);
            return (
              <li key={s} className="flex min-w-0 flex-1 items-center gap-1 last:flex-none">
                <button
                  type="button"
                  aria-current={active ? 'step' : undefined}
                  data-testid={`wizard-step-${s}`}
                  data-status={status}
                  title={blocker && !active ? t.blocked[blocker] : undefined}
                  onClick={() => onGo(s)}
                  className={`group flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-hover sm:px-2 ${focusRing}`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${
                      active
                        ? 'border-accent bg-accent text-accent-fg shadow-xs'
                        : status === 'done'
                          ? 'border-accent-border bg-accent-subtle text-accent-text'
                          : status === 'blocked'
                            ? 'border-dashed border-border-strong bg-surface text-fg-subtle'
                            : 'border-border-strong bg-surface text-fg-muted'
                    }`}
                  >
                    {status === 'done' ? (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    ) : status === 'blocked' ? (
                      <Lock className="size-3" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span
                    className={`${active ? 'font-semibold text-fg' : status === 'blocked' ? 'text-fg-subtle' : 'text-fg-muted group-hover:text-fg'} ${active ? 'sr-only' : 'sr-only whitespace-nowrap xl:not-sr-only min-[1400px]:sr-only min-[1680px]:not-sr-only'}`}
                  >
                    {t[s]}
                  </span>
                  <span className="sr-only">
                    {` (${t.status[status]}${blocker && !active ? `: ${t.blocked[blocker]}` : ''})`}
                  </span>
                </button>
                {i < STEPS.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={`h-px min-w-3 flex-1 ${i < index ? 'bg-accent-border' : 'bg-border'}`}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}

function NameField({
  label,
  value,
  onCommit,
  autoSelect = false,
}: {
  label: string;
  value: string;
  onCommit: (name: string) => void;
  /** New project on step 1: focus and select the suggested name once (T194a). */
  autoSelect?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const selectOnMount = useRef(autoSelect);
  useEffect(() => {
    if (!selectOnMount.current) return;
    selectOnMount.current = false;
    input.current?.focus();
    input.current?.select();
  }, []);
  function commit() {
    if (text === null) return;
    const name = text.trim();
    setText(null);
    if (name !== '' && name !== value) onCommit(name.slice(0, 120));
  }
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 sm:min-w-64">
      <span className="px-2 text-xs font-medium text-fg-subtle">{label}</span>
      <input
        ref={input}
        type="text"
        data-testid="project-name"
        value={text ?? value}
        maxLength={120}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') setText(null);
        }}
        className="h-10 w-full max-w-xl rounded-md border border-transparent bg-transparent px-2 text-lg font-semibold tracking-tight text-fg transition-colors duration-(--duration-fast) outline-none focus-visible:outline-solid hover:border-border focus-visible:border-border-strong focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus sm:text-xl"
      />
    </label>
  );
}

function ConflictNotice({
  t,
  name,
  projectId,
  project,
  onReload,
  onCopied,
}: {
  t: Messages['wizard']['conflict'];
  name: string;
  projectId: string | null;
  project: unknown;
  onReload: () => void;
  onCopied: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function keepCopy() {
    if (!projectId) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/copy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: fill(t.copyName, { name }).slice(0, 120), project }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onCopied(((await res.json()) as ProjectDetail).id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Callout tone="danger" role="alert" data-testid="conflict" icon={<CircleAlert aria-hidden />}>
      <h2 className="font-semibold">{t.title}</h2>
      <p>{t.body}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button size="sm" onClick={onReload}>
          {t.reload}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void keepCopy()} loading={busy}>
          {busy ? t.copying : t.keepCopy}
        </Button>
      </div>
      {failed ? <p className="font-medium">{t.copyFailed}</p> : null}
    </Callout>
  );
}
