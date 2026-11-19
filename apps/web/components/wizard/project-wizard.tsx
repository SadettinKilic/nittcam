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
import { findMaterialParams } from '@nittcam/core';
import { fill, newProject, toolDiameterFor } from '../../lib/draft-project';
import type { MachineDetail, MachineListItem } from '../../lib/machines-api';
import type { Messages } from '../../lib/messages';
import { useProjectSession, type SessionInit } from '../../lib/project-session';
import type { ProjectDetail, ProjectListItem } from '../../lib/projects-api';
import { untitledName } from '../../lib/untitled-name';
import { CutListEditor } from '../parts/cut-list-editor';
import { DrawingBoard } from '../editor/drawing-board';
import { SimulationView, type SimMachine } from '../simulation/simulation-view';
import { ExportStep } from './export-step';
import { LayoutStep } from './layout-step';
import { MachineFields, SheetGrain, SheetPreview } from './machine-step';
import { IssuesOkChip } from './issues-ok-chip';
import { fetchMaterials, type MaterialItem } from '../../lib/materials-api';
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
  ChevronDown,
  FileOutput,
  CircleAlert,
  Cloud,
  CloudAlert,
  CloudCheck,
  Info,
  Loader2,
  Pencil,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
  RouterIcon,
  SheetIcon,
  Tabs,
  TabsList,
  TabsTrigger,
  ToolpathIcon,
  Tooltip,
  notify,
} from '@nittcam/ui';
import { ariaKeyShortcuts, shortcutById } from '../../lib/shortcuts';
import { useMediaQuery, WORKSPACE_DESKTOP } from '../../lib/use-media-query';
import { PageSkeleton } from '../feedback/page-skeleton';
import { ShellStatus, useShellTitle } from '../shell/shell-context';

const NEW_PATH = '/projeler/yeni';

/** `?profil=son`: move the project to the machine's latest profile version on entry (T258). */
const LATEST_PARAM = 'profil';
const LATEST_VALUE = 'son';

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
          // T259: a new project starts on the library's first entry the machine can cut.
          const library = firstDetail ? ((await fetchMaterials()) ?? []) : [];
          init = {
            id: null,
            revision: 0,
            name: untitledName(t.defaultName, names),
            project: newProject(firstDetail ?? undefined, library),
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

type PartsView = 'list' | 'drawing';

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
  // Parts step view (T124, §3.6): "Liste" (cut list) or "Çizim" (drawing board), same data.
  const [partsView, setPartsViewState] = useState<PartsView>(() =>
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('gorunum') === 'cizim'
      ? 'drawing'
      : 'list',
  );
  const setPartsView = useCallback((v: PartsView) => {
    setPartsViewState(v);
    const url = new URL(window.location.href);
    if (v === 'drawing') url.searchParams.set('gorunum', 'cizim');
    else url.searchParams.delete('gorunum');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  // T240: below 640 px the wizard header is one compact row; T241: on ≥ 1024 px the
  // Liste / Çizim switch sits in the header row, below that (drawing view) in the canvas band.
  const phone = useMediaQuery('(max-width: 639px)', false);
  const wide = useMediaQuery(WORKSPACE_DESKTOP);
  const stepRef = useRef(step);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const footer = useRef<HTMLElement>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);

  // B4b: publish the sticky footer's height (incl. the safe area) so the phone panel bar of the
  // canvas workspaces can stick just above it instead of sliding under it.
  useEffect(() => {
    const el = footer.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--wizard-footer-h', `${el.getBoundingClientRect().height}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--wizard-footer-h');
    };
  }, []);

  // Machine profiles by id (the selected one is fetched when the selection changes).
  const [details, setDetails] = useState<Record<string, MachineDetail>>(() =>
    firstDetail ? { [firstDetail.id]: firstDetail } : {},
  );
  const [detailError, setDetailError] = useState(false);

  const created = useCallback(
    (id: string) => {
      // Keep the step's other query params (e.g. `?gorunum=cizim`, T124) across the first save.
      const url = new URL(stepUrl(id, stepRef.current), window.location.origin);
      new URLSearchParams(window.location.search).forEach((value, key) => {
        if (key !== 'adim') url.searchParams.set(key, value);
      });
      window.history.replaceState({ [STEP_STATE]: stepRef.current }, '', url.pathname + url.search);
      onCreated(id);
    },
    [onCreated],
  );

  // The session needs the profile for validation; it is read from the latest state each render.
  const [machineId, setMachineId] = useState(init.project.machine.machineId);
  const [sheetGrainPreview, setSheetGrainPreview] = useState<number | null>(null);
  // T121: the company material library for step 1 (empty until loaded or when it fails).
  const [library, setLibrary] = useState<readonly MaterialItem[]>([]);
  useEffect(() => {
    let live = true;
    void fetchMaterials().then((items) => {
      if (live && items) setLibrary(items);
    });
    return () => {
      live = false;
    };
  }, []);
  const detail = details[machineId] ?? null;
  const session = useProjectSession({
    initial: init,
    machine: detail?.profile ?? null,
    onCreated: created,
  });
  const project = session.project;
  // T258: back from "Kesim ayarı ekle" (`?profil=son`): the project moves to the machine's
  // latest profile version, which has the new parameter set (export uses the project's version).
  const [takeLatest, setTakeLatest] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get(LATEST_PARAM) === LATEST_VALUE,
  );
  useEffect(() => {
    if (!takeLatest || !detail) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTakeLatest(false);
    const pinned = session.project.machine;
    if (detail.id === pinned.machineId && detail.version !== pinned.profileVersion)
      session.run('setMachine', { machineId: detail.id, profileVersion: detail.version });
    const url = new URL(window.location.href);
    url.searchParams.delete(LATEST_PARAM);
    window.history.replaceState(window.history.state, '', url);
  }, [takeLatest, detail, session]);
  // Save failures are announced once as a toast (T105); autosave keeps retrying.
  const saveFailed = session.saveState === 'error';
  useEffect(() => {
    if (!saveFailed) return;
    notify.error(messages.feedback.saveError, {
      id: 'save-error',
      description: messages.feedback.saveErrorText,
    });
  }, [saveFailed, messages.feedback.saveError, messages.feedback.saveErrorText]);
  // Top-bar title (T103): the project name once it is saved, "Yeni proje" before (phones show
  // "Adsız proje" until the first save, B10a).
  useShellTitle(session.projectId ? session.name : null, t.defaultName);
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
  // D-045 / T258: a problem that blocks G-code is marked on the step that causes it, on every step.
  const params = profile !== null ? findMaterialParams(profile, project.stock) : undefined;
  const noParams = profile !== null && params === undefined;
  // T265: a set with unconfirmed starting values blocks like a missing one.
  const stepErrors: StepErrors = noParams
    ? { makine: t.steps.errors.noParams }
    : params?.unverified
      ? { makine: t.steps.errors.unverifiedParams }
      : {};
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
  let partsFullWidth = false;
  // Dizilim and Simülasyon are canvas-first workspaces that fill the viewport (T197).
  const drawing = step === 'parcalar' && partsView === 'drawing';
  const workspace = step === 'dizilim' || step === 'simulasyon' || drawing;
  // Liste / Çizim (T124). D-039: never a row of its own on the board: in the wizard header row
  // on ≥ 1024 px (T241), in the canvas toolbar band below that (T240).
  const viewSwitch = (
    <Tabs value={partsView} onValueChange={(v) => setPartsView(v as PartsView)}>
      <TabsList variant="segmented" aria-label={messages.cutList.views.label}>
        <TabsTrigger
          value="list"
          className="h-8 px-3"
          aria-controls="step-content"
          data-testid="parts-view-list"
        >
          {messages.cutList.views.list}
        </TabsTrigger>
        <TabsTrigger
          value="drawing"
          className="h-8 px-3"
          aria-controls="step-content"
          data-testid="parts-view-drawing"
        >
          {messages.cutList.views.drawing}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
  const switchInCanvas = drawing && !wide;
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
          <Panel
            title={t.machine.cardTitle}
            titleId="machine-card-title"
            data-testid="machine-card"
            action={
              session.issues.length === 0 ? (
                <IssuesOkChip label={messages.cutList.issueChip.ok} testId="machine-issue-chip" />
              ) : undefined
            }
          >
            <MachineFields
              t={t.machine}
              materials={messages.materials}
              returnTo={`${stepUrl(session.projectId, 'makine')}&${LATEST_PARAM}=${LATEST_VALUE}`}
              project={project}
              machines={machines}
              library={library}
              detail={detail}
              issues={session.issues}
              run={session.run}
            />
          </Panel>
        )}
        {/* T252: no issues = the "Sorun yok" chip in the card header instead of the card. */}
        {session.issues.length > 0 ? validation : null}
      </div>
    );
    right = (
      <SheetPreview
        t={t.machine}
        project={project}
        profile={profile}
        grainPreview={sheetGrainPreview}
        footer={
          <SheetGrain
            t={t.machine}
            project={project}
            run={session.run}
            onGrainPreview={setSheetGrainPreview}
          />
        }
      />
    );
  } else if (drawing) {
    both = (
      <DrawingBoard
        t={messages.editor}
        project={project}
        run={session.run}
        onToList={() => setPartsView('list')}
        viewSwitch={switchInCanvas ? viewSwitch : undefined}
        toolDiameter={toolDiameter}
      />
    );
  } else if (step === 'parcalar') {
    const editor = (
      <CutListEditor
        t={messages.cutList}
        project={project}
        issues={session.issues}
        run={session.run}
        onUndo={session.undo}
        issuesPanel={validation}
        issuesKey={session.projectId ?? undefined}
      />
    );
    // T246 + T253: the table always takes the full width; with issues the Uyarılar panel floats
    // from the issue chip, so the grid never moves or changes its columns while the user types.
    partsFullWidth = true;
    both = editor;
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
        footerSlot={footerSlot}
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

  const headerActions = (
    <>
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
      {/* T247: the save state shows once per screen: the top-bar dot on phones, the footer text
          from 640 px (the badge stays in the DOM for its data attributes). */}
      <ShellStatus>
        <Badge
          dot
          variant={
            session.saveState === 'error' || session.saveState === 'conflict'
              ? 'danger'
              : session.saveState === 'saved' || (session.saveState === 'idle' && session.projectId)
                ? 'success'
                : 'neutral'
          }
          aria-live="polite"
          title={`${t.save.label}: ${saveText}`}
          data-testid="save-status"
          data-state={session.saveState}
          data-revision={session.revision}
          className="max-w-full min-w-0 shrink sm:hidden"
        >
          <span className="truncate max-[399px]:sr-only">{saveText}</span>
        </Badge>
      </ShellStatus>
      <Tooltip content={messages.cutList.undo}>
        <IconButton
          aria-label={messages.cutList.undo}
          data-testid="wizard-undo"
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
          data-testid="wizard-redo"
          variant="ghost"
          onClick={session.redo}
          disabled={!session.canRedo}
          aria-keyshortcuts={ariaKeyShortcuts(shortcutById('redo').keys, false)}
        >
          <Redo2 aria-hidden />
        </IconButton>
      </Tooltip>
    </>
  );

  return (
    <main
      data-workspace={workspace ? '' : undefined}
      className={`mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full min-w-0 flex-col gap-3 px-4 pt-1 sm:gap-5 sm:px-6 sm:pt-5 ${workspace ? 'max-w-none max-sm:gap-2 lg:h-[calc(100dvh-3.5rem)] lg:gap-2 lg:overflow-hidden lg:pt-2' : 'max-w-[96rem] lg:px-8'}`}
    >
      {phone ? (
        <>
          <header
            data-testid="wizard-compact-header"
            className="flex h-14 min-w-0 items-center gap-1"
          >
            <CompactStepper
              t={t.steps}
              headingRef={heading}
              current={step}
              statuses={wizardStepStatuses(step, progress)}
              progress={progress}
              errors={stepErrors}
              onGo={go}
            />
            <div className="flex shrink-0 items-center gap-0.5">{headerActions}</div>
          </header>
          {/* The name lives in the top-bar title; on step 1 it stays editable here. */}
          {step === 'makine' ? (
            <NameField
              label={t.nameLabel}
              value={session.name}
              onCommit={session.rename}
              autoSelect={session.projectId === null}
            />
          ) : null}
        </>
      ) : (
        <>
          {/* One header row on ≥ 1400 px (T197; narrower screens would squeeze the stepper): project name, stepper, undo/redo. */}
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-5 min-[1400px]:flex-nowrap min-[1400px]:items-center">
            <header className="contents">
              <NameField
                label={t.nameLabel}
                value={session.name}
                onCommit={session.rename}
                autoSelect={session.projectId === null && step === 'makine'}
              />
              <div className="order-2 flex items-center gap-1 min-[1400px]:order-3 min-[1400px]:shrink-0">
                {headerActions}
              </div>
            </header>

            <div className="order-3 flex w-full min-w-0 items-center gap-3 min-[1400px]:order-2 min-[1400px]:w-auto min-[1400px]:flex-1 min-[1400px]:max-[1679px]:min-w-min">
              {step === 'parcalar' && wide ? (
                <div className="shrink-0" data-testid="wizard-view-switch">
                  {viewSwitch}
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                <StepIndicator
                  t={t.steps}
                  headingRef={heading}
                  current={step}
                  statuses={wizardStepStatuses(step, progress)}
                  progress={progress}
                  errors={stepErrors}
                  onGo={go}
                />
              </div>
            </div>
          </div>
        </>
      )}

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

      {step === 'parcalar' && !drawing && !wide ? (
        <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 lg:-mt-1">
          {viewSwitch}
        </div>
      ) : null}

      <div
        id="step-content"
        className={
          workspace
            ? 'min-w-0 lg:min-h-0 lg:flex-1'
            : // T246: the Parçalar step with no issues has no Uyarılar panel, so the table takes
              // the full width. Every other step keeps its grid (Dışa aktar has two columns).
              `grid min-w-0 items-start gap-5 ${partsFullWidth ? '' : GRID[step]}`
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
        ref={footer}
        aria-label={t.steps.label}
        data-testid="wizard-footer"
        data-wizard-footer=""
        className={`sticky bottom-0 z-20 -mx-4 mt-auto border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:-mx-6 sm:px-6 ${workspace ? 'lg:py-2' : 'lg:-mx-8 lg:px-8'}`}
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
            // T250 (D-040): the last step's main action ("İndir") is portalled in here.
            <div
              ref={setFooterSlot}
              data-testid="wizard-footer-action"
              className="flex min-w-20 shrink items-center justify-end gap-3"
            />
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
      role="status"
      // T247: phones keep the top-bar dot instead (one save state per screen).
      className={`flex items-center gap-1.5 whitespace-nowrap max-sm:hidden ${state === 'error' ? 'font-medium text-danger-text' : 'text-fg-muted'}`}
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
  errors,
  onGo,
}: {
  t: Messages['wizard']['steps'];
  headingRef: RefObject<HTMLHeadingElement | null>;
  current: StepKey;
  statuses: readonly WizardStepStatus[];
  progress: WizardProgress;
  errors: StepErrors;
  onGo: (step: StepKey) => void;
}) {
  const index = STEPS.indexOf(current);
  const StepIcon = STEP_ICONS[current];
  return (
    <div
      className={`${panelClass} flex flex-col gap-2 px-3 py-2.5 sm:px-4 lg:flex-row lg:items-center lg:gap-6 lg:py-1.5`}
    >
      {/* B4b: on the tightest one-row widths (1400–1479 px) the step icon and "Adım n / 5" yield. */}
      <div className="flex min-w-0 items-center gap-3 lg:shrink-0">
        <span
          aria-hidden="true"
          className="hidden size-9 shrink-0 items-center justify-center rounded-lg border border-accent-border bg-accent-subtle text-accent-text sm:max-[1399px]:flex min-[1480px]:flex [&_svg]:size-5"
        >
          <StepIcon />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-2xs font-medium tracking-wide text-fg-subtle uppercase min-[1400px]:max-[1479px]:sr-only">
            {fill(t.stepOf, { n: index + 1, total: STEPS.length })}
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            data-testid="wizard-step-title"
            data-step={current}
            className="truncate text-lg leading-tight font-semibold tracking-tight text-fg focus:outline-none sm:max-[1399px]:text-xl min-[1480px]:text-xl"
          >
            {t[current]}
          </h1>
        </div>
      </div>
      <nav
        aria-label={t.label}
        className="min-w-0 lg:flex-1 min-[1400px]:max-[1679px]:min-w-[22.75rem]"
      >
        <ol className="flex items-center gap-1" data-testid="wizard-steps">
          {STEPS.map((s, i) => {
            const status = statuses[i] ?? 'upcoming';
            const active = status === 'current';
            const blocker = stepBlocker(s, progress);
            return (
              <li
                key={s}
                className="flex min-w-10 flex-1 items-center gap-1 last:flex-none sm:min-w-15"
              >
                <button
                  type="button"
                  aria-current={active ? 'step' : undefined}
                  data-testid={`wizard-step-${s}`}
                  data-status={status}
                  data-error={errors[s] ? '' : undefined}
                  title={
                    errors[s]
                      ? `${t[s]}: ${errors[s]}`
                      : blocker && !active
                        ? `${t[s]}: ${t.blocked[blocker]}`
                        : t[s]
                  }
                  onClick={() => onGo(s)}
                  className={`group flex min-h-10 min-w-8 items-center gap-2 rounded-lg px-0.5 py-1 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-hover sm:min-w-11 sm:px-2 ${focusRing}`}
                >
                  <StepDot status={status} n={i + 1} error={Boolean(errors[s])} />
                  {active ? null : (
                    <span
                      aria-hidden="true"
                      className={`${status === 'blocked' ? 'text-fg-subtle' : 'text-fg-muted group-hover:text-fg'} hidden min-w-0 truncate whitespace-nowrap xl:max-[1399px]:block min-[1680px]:block`}
                    >
                      {t[s]}
                    </span>
                  )}
                  <span className="sr-only">{t[s]}</span>
                  <span className="sr-only">
                    {` (${t.status[status]}${blocker && !active ? `: ${t.blocked[blocker]}` : ''})`}
                    {errors[s] ? ` (${t.error}: ${errors[s]})` : ''}
                  </span>
                </button>
                {i < STEPS.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={`h-px min-w-1 flex-1 sm:min-w-3 ${i < index ? 'bg-accent-border' : 'bg-border'}`}
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

/** Problems that block G-code, per step that causes them (D-045, T258): shown as an error dot. */
type StepErrors = Partial<Record<StepKey, string>>;

/**
 * The round step marker: number, check (done) or lock (blocked); accent when current. A step
 * with a blocking problem gets a small danger dot on its corner (T258).
 */
function StepDot({
  status,
  n,
  error = false,
}: {
  status: WizardStepStatus;
  n: number;
  error?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${
        status === 'current'
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
        n
      )}
      {error ? (
        <span
          data-testid="step-error-dot"
          className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface bg-danger"
        />
      ) : null}
    </span>
  );
}

/**
 * Phone wizard header (T240, D-039): one row ≤ 56 px. The step title with "2 / 5" and a
 * 5-segment progress line; a tap opens the step list as a popover (same statuses and lock
 * rules as the desktop stepper).
 */
function CompactStepper({
  t,
  headingRef,
  current,
  statuses,
  progress,
  errors,
  onGo,
}: {
  t: Messages['wizard']['steps'];
  headingRef: RefObject<HTMLHeadingElement | null>;
  current: StepKey;
  statuses: readonly WizardStepStatus[];
  progress: WizardProgress;
  errors: StepErrors;
  onGo: (step: StepKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = useRef(false);
  const index = STEPS.indexOf(current);
  const count = fill(t.counter, { n: index + 1, total: STEPS.length });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            data-testid="wizard-step-title"
            data-step={current}
            className="truncate text-base leading-tight font-semibold tracking-tight text-fg focus:outline-none"
          >
            {t[current]}
          </h1>
          <span
            aria-hidden="true"
            data-testid="wizard-step-counter"
            className="shrink-0 font-mono text-xs text-fg-muted tabular-nums"
          >
            {count}
          </span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
        </div>
        <div aria-hidden="true" className="flex max-w-56 gap-1" data-testid="wizard-progress">
          {STEPS.map((s, i) => (
            <span
              key={s}
              data-status={statuses[i]}
              className={`h-1 flex-1 rounded-full ${
                i === index ? 'bg-accent' : i < index ? 'bg-accent-border' : 'bg-border'
              }`}
            />
          ))}
        </div>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${t.label}: ${fill(t.stepOf, { n: index + 1, total: STEPS.length })}`}
            data-testid="wizard-steps-trigger"
            className={`absolute inset-0 rounded-lg transition-colors duration-(--duration-fast) hover:bg-surface-hover/40 ${focusRing}`}
          />
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="start"
        className="w-[min(18rem,calc(100vw-2rem))] p-1.5"
        data-testid="wizard-steps-popover"
        aria-label={t.label}
        onCloseAutoFocus={(e) => {
          // A chosen step moves focus to its heading (go), not back to the trigger.
          if (chosen.current) {
            e.preventDefault();
            chosen.current = false;
          }
        }}
      >
        <nav aria-label={t.label}>
          <ol className="flex flex-col gap-0.5" data-testid="wizard-steps">
            {STEPS.map((s, i) => {
              const status = statuses[i] ?? 'upcoming';
              const active = status === 'current';
              const blocker = stepBlocker(s, progress);
              return (
                <li key={s}>
                  <button
                    type="button"
                    aria-current={active ? 'step' : undefined}
                    data-testid={`wizard-step-${s}`}
                    data-status={status}
                    data-error={errors[s] ? '' : undefined}
                    onClick={() => {
                      chosen.current = true;
                      setOpen(false);
                      onGo(s);
                    }}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-(--duration-fast) hover:bg-surface-hover ${active ? 'bg-accent-subtle/60' : ''} ${focusRing}`}
                  >
                    <StepDot status={status} n={i + 1} error={Boolean(errors[s])} />
                    <span className="flex min-w-0 flex-col">
                      <span
                        className={`truncate ${active ? 'font-semibold text-fg' : status === 'blocked' ? 'text-fg-subtle' : 'text-fg'}`}
                      >
                        {t[s]}
                      </span>
                      {errors[s] ? (
                        <span className="text-xs text-danger-text">{errors[s]}</span>
                      ) : blocker && !active ? (
                        <span className="text-xs text-fg-subtle">{t.blocked[blocker]}</span>
                      ) : null}
                    </span>
                    <span className="sr-only">{` (${t.status[status]})`}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </PopoverContent>
    </Popover>
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
    // B4b: in the one-row header (≥ 1400 px) the name yields first, down to 10rem (ellipsis + title).
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 sm:max-[1399px]:min-w-64 min-[1400px]:min-w-40 min-[1400px]:flex-[0_1_20rem]">
      {/* T247: from 1280 px the caption goes; the name is the title (the label stays for AT). */}
      <span className="px-2 text-xs font-medium text-fg-subtle min-[1280px]:sr-only">{label}</span>
      <span className="group/name relative w-full max-w-xl">
        <input
          ref={input}
          type="text"
          data-testid="project-name"
          title={text ?? value}
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
          className="peer h-10 w-full rounded-md border text-ellipsis border-transparent bg-transparent pr-8 pl-2 text-lg font-semibold tracking-tight text-fg transition-colors duration-(--duration-fast) outline-none focus-visible:outline-solid hover:border-border focus-visible:border-border-strong focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus sm:text-xl"
        />
        <Pencil
          aria-hidden
          data-testid="project-name-pencil"
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-subtle opacity-0 transition-opacity duration-(--duration-fast) group-hover/name:opacity-100 peer-focus:opacity-0"
        />
      </span>
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
