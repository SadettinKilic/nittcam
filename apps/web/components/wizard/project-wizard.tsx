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
import { findMaterialParams, findTool } from '@nittcam/core';
import { fill, newProject, toolDiameterFor } from '../../lib/draft-project';
import { pickableMachines, type MachineDetail, type MachineListItem } from '../../lib/machines-api';
import type { Messages } from '../../lib/messages';
import { useProjectSession, type SessionInit } from '../../lib/project-session';
import { nextFailing, saveBannerKind } from '../../lib/save-banner';
import { useOnline } from '../../lib/use-online';
import { SaveBanner } from './save-banner';
import { TemplateUpdatePrompt } from '../editor/template-update';
import type { ProjectDetail, ProjectListItem } from '../../lib/projects-api';
import { isUntitledName, untitledName } from '../../lib/untitled-name';
import { CutListEditor } from '../parts/cut-list-editor';
import { splitOffProject, type SplitTarget } from '../../lib/split-project';
import { ProjectLinksBar } from './project-links';
import { DrawingBoard } from '../editor/drawing-board';
import { SimulationView, type SimMachine } from '../simulation/simulation-view';
import { ExportStep } from './export-step';
import { LayoutStep } from './layout-step';
import { runLeaveTransition } from '../../lib/preview3d/leave';
import { tableSpecOf } from '../../lib/preview3d/stage';
import { MachineFields, SheetGrain, SheetPreview } from './machine-step';
import { IssuesOkChip } from './issues-ok-chip';
import { fetchMaterials, type MaterialItem } from '../../lib/materials-api';
import { ProfileStatusChip, profileReasons } from './profile-status';
import { ProfileVersionNotice, versionGap } from './profile-version-notice';
import { InnerIssuesContext, unsecuredInners } from '../editor/inner-issues';
import { HoleIssuesContext, holeErrors } from '../editor/hole-issues';
import { ValidationPanel } from './validation-panel';
import { CuttingSettings } from '../simulation/cutting-settings';
import {
  STEPS,
  saveIndicator,
  stepBlocker,
  toStep,
  wizardStepStatuses,
  partsViewKey,
  resumeStep,
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
  RotateCcw,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
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
import { setSidebarWorkspace } from '../../lib/sidebar-state';
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
  | { status: 'deleted'; name: string }
  | {
      status: 'ready';
      machines: MachineListItem[];
      init: SessionInit;
      firstDetail: MachineDetail | null;
      /** Where a saved project opened without `?adim=` resumes (T290); null = the URL's step. */
      step: StepKey | null;
    };

/**
 * A deleted project's direct link (T178): nothing opens; "Geri yükle" restores it in place,
 * "Silinenler" goes to the list of deleted projects.
 */
function DeletedProject({
  t,
  id,
  name,
  backLabel,
  onRestored,
}: {
  t: Messages['wizard']['deletedProject'];
  id: string;
  name: string;
  backLabel: string;
  onRestored: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function restore() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deleted: false }),
      });
      if (!res.ok) throw new Error(String(res.status));
      notify.success(fill(t.restored, { name }));
      onRestored();
    } catch {
      notify.error(t.restoreFailed);
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col items-start gap-4 px-4 py-8 sm:px-6">
      <EmptyState
        data-testid="wizard-deleted"
        className="w-full"
        icon={<Trash2 />}
        title={name ? fill(t.title, { name }) : t.titleNoName}
        description={t.text}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button data-testid="wizard-restore" loading={busy} onClick={() => void restore()}>
              <RotateCcw aria-hidden />
              {t.restore}
            </Button>
            <Button asChild variant="outline">
              <Link href="/projeler?sekme=silinenler">{t.deletedList}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/projeler">{backLabel}</Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}

async function getJson<T>(
  url: string,
): Promise<{ status: number; body: T | null; error?: unknown }> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return { status: res.status, body: null, error: await res.json().catch(() => null) };
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
  /** The URL's `?adim=`; null = none (a saved project then opens where work stopped, T290). */
  step: StepKey | null;
}) {
  const t = messages.wizard;
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  // The URL's step when the wizard mounts (keyed by project); later steps are the session's own.
  const urlStepRef = useRef(step);
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
        // null = the URL's step (or step 1); set only when a saved project resumes (T290).
        let open: StepKey | null = null;
        if (projectId) {
          const p = await getJson<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`);
          if (p.status === 404) {
            if (live) setLoaded({ status: 'notFound' });
            return;
          }
          // T178: a deleted project's link opens nothing; the page offers "Geri yükle".
          if (p.status === 410) {
            const name = (p.error as { name?: unknown } | null)?.name;
            if (live) setLoaded({ status: 'deleted', name: typeof name === 'string' ? name : '' });
            return;
          }
          if (!p.body) throw new Error(String(p.status));
          init = {
            id: p.body.id,
            revision: p.body.revision,
            name: p.body.name,
            project: p.body.project,
          };
          if (urlStepRef.current === null) {
            open = resumeStep({
              partCount: p.body.project.parts.length,
              sheetCount: p.body.project.layout?.sheets.length ?? 0,
              exported: p.body.exported === true,
            });
          }
        } else {
          const first = pickableMachines(machines.body)[0];
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
        // T289: archived machines cannot be picked; a project bound to one still shows it.
        const pickable = pickableMachines(machines.body, init.project.machine.machineId);
        if (live) setLoaded({ status: 'ready', machines: pickable, init, firstDetail, step: open });
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
  if (loaded.status === 'deleted' && projectId) {
    return (
      <DeletedProject
        t={t.deletedProject}
        id={projectId}
        name={loaded.name}
        backLabel={t.backToList}
        onRestored={reload}
      />
    );
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
      initialStep={loaded.step ?? step ?? 'makine'}
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
  // One part selection for both views of the Parçalar step (T135): Liste ↔ Çizim keep it.
  const [partsSelection, setPartsSelection] = useState<string[]>([]);
  // T292: bumped after a split so the "Ayrı plaka projeleri" line reloads.
  const [linksVersion, setLinksVersion] = useState(0);
  // T290: `?gorunum=cizim` wins; without it a saved project reopens in the view it was left in.
  const [partsView, setPartsViewState] = useState<PartsView>(() => {
    if (typeof window === 'undefined') return 'list';
    if (new URLSearchParams(window.location.search).get('gorunum') === 'cizim') return 'drawing';
    if (!init.id) return 'list';
    try {
      return window.localStorage.getItem(partsViewKey(init.id)) === 'drawing' ? 'drawing' : 'list';
    } catch {
      return 'list';
    }
  });
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
  // T263: the workspace steps (board, Dizilim, Simülasyon) open with the sidebar rail below 1440.
  const railStep =
    step === 'dizilim' || step === 'simulasyon' || (step === 'parcalar' && partsView === 'drawing');
  useEffect(() => {
    setSidebarWorkspace(railStep);
  }, [railStep]);
  useEffect(() => () => setSidebarWorkspace(false), []);
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
      // T264: a save that lands after the user left the wizard (e.g. for the machine form) must
      // not rewrite that page's address.
      if (window.location.pathname === NEW_PATH) {
        // Keep the step's other query params (e.g. `?gorunum=cizim`, T124) across the first save.
        const url = new URL(stepUrl(id, stepRef.current), window.location.origin);
        new URLSearchParams(window.location.search).forEach((value, key) => {
          if (key !== 'adim') url.searchParams.set(key, value);
        });
        const next = url.pathname + url.search;
        window.history.replaceState({ [STEP_STATE]: stepRef.current }, '', next);
      }
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
  // `details` holds each machine's latest version; `detail` is the selected machine's latest.
  const detail = details[machineId] ?? null;
  // T269: everything the wizard previews (validation, step 1 values, Dizilim tool, Simülasyon)
  // uses the profile version the project is bound to, the same one the export uses. Older
  // versions are fetched by `machineId@version`; the latest one is reused from `details`.
  const [versions, setVersions] = useState<Record<string, MachineDetail>>({});
  const [pinnedVersion, setPinnedVersion] = useState(init.project.machine.profileVersion);
  const pinnedKey = `${machineId}@${pinnedVersion}`;
  const pinned: MachineDetail | null =
    detail && detail.version === pinnedVersion ? detail : (versions[pinnedKey] ?? null);
  const session = useProjectSession({
    initial: init,
    machine: pinned?.profile ?? null,
    onCreated: created,
  });
  // T290: remember the Parçalar view per saved project.
  useEffect(() => {
    if (!session.projectId) return;
    try {
      window.localStorage.setItem(partsViewKey(session.projectId), partsView);
    } catch {
      // Remembering the view is a convenience only.
    }
  }, [partsView, session.projectId]);
  const project = session.project;
  if (project.machine.profileVersion !== pinnedVersion) {
    setPinnedVersion(project.machine.profileVersion);
  }
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
  // T187: offline or a failed save shows a banner with the unsent queue and Tekrar dene (it
  // replaces the T105 toast); autosave keeps retrying and sends at once when the network is back.
  const online = useOnline();
  const [failing, setFailing] = useState(false);
  const failingNow = nextFailing(session.saveState, failing);
  if (failingNow !== failing) setFailing(failingNow);
  const bannerKind = saveBannerKind(session.saveState, online, session.dirty, failingNow);
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

  // T269: the project's (older) version, once the latest is known to differ.
  const needsPinned =
    known && detail !== null && detail.version !== pinnedVersion && !versions[pinnedKey];
  useEffect(() => {
    if (!needsPinned) return;
    let live = true;
    fetch(`/api/machines/${encodeURIComponent(machineId)}?version=${pinnedVersion}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as MachineDetail;
        if (live) setVersions((all) => ({ ...all, [`${d.id}@${d.version}`]: d }));
      })
      .catch(() => {
        if (live) setDetailError(true);
      });
    return () => {
      live = false;
    };
  }, [needsPinned, machineId, pinnedVersion]);

  const profile = pinned?.profile ?? null;
  // D-045 / T258: a problem that blocks G-code is marked on the step that causes it, on every step.
  const params = profile !== null ? findMaterialParams(profile, project.stock) : undefined;
  const noParams = profile !== null && params === undefined;
  // T265: a set with unconfirmed starting values blocks like a missing one.
  const machineError = noParams
    ? t.steps.errors.noParams
    : params?.unverified
      ? t.steps.errors.unverifiedParams
      : undefined;
  // T270: a cut-out whose slug has no room for 2 tabs is caught on Parçalar, where it is drawn.
  const slugError = session.issues.some((i) => i.code === 'INNER_SLUG_UNSECURED')
    ? t.steps.errors.slugUnsecured
    : undefined;
  // T275: a hole the machine cannot drill (or that does not fit its part) likewise.
  const holeError = session.issues.some(
    (i) => i.severity === 'error' && /^parts\[\d+\]\.holes\[\d+\]/.test(i.path),
  )
    ? t.steps.errors.holeInvalid
    : undefined;
  // T277: an engraved line that leaves its part likewise.
  const lineError = session.issues.some((i) => i.code === 'LINE_OUTSIDE_PART')
    ? t.steps.errors.lineOutside
    : undefined;
  const partsError = slugError ?? holeError ?? lineError;
  const stepErrors: StepErrors = {
    ...(machineError ? { makine: machineError } : {}),
    ...(partsError ? { parcalar: partsError } : {}),
  };
  const simMachine: SimMachine | null = useMemo(
    () =>
      pinned
        ? {
            id: pinned.id,
            pv: { profile: pinned.profile, version: pinned.version, verification: pinned.state },
          }
        : null,
    [pinned],
  );
  // T269: the "Son sürüme geç" box on step 1, Simülasyon and Dışa aktar.
  const gap = known ? versionGap(project.machine, detail) : null;
  const versionNotice =
    gap !== null ? (
      <ProfileVersionNotice
        t={t.machine}
        machineId={project.machine.machineId}
        version={project.machine.profileVersion}
        latest={gap}
        run={session.run}
      />
    ) : null;
  const toolDiameter = toolDiameterFor(project, profile);
  // T138: a drawn hole takes the stock material set's tool (else the first tool, else T1).
  const holeToolNo =
    (profile && findMaterialParams(profile, project.stock)?.tool) ?? profile?.tools[0]?.number ?? 1;

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
  const innerIssues = useMemo(
    () => unsecuredInners(project, session.issues),
    [project, session.issues],
  );
  const profileTools = profile?.tools;
  // T275: "Çizimde aç" on a hole error also brings that hole's rows into view.
  const [holeFocus, setHoleFocus] = useState<{ partId: string; hole: number } | null>(null);
  // T287: the part row "Parçalara git" focuses when the cut list opens.
  const [rowFocus, setRowFocus] = useState<string | null>(null);
  const holeIssues = useMemo(
    () => ({
      byPart: holeErrors(project, session.issues),
      tools: profileTools
        ? profileTools.map((x) => ({ number: x.number, diameter: x.diameter }))
        : null,
      focus: holeFocus,
    }),
    [project, session.issues, profileTools, holeFocus],
  );
  // T270: "Çizimde aç" on a blocked cut-out opens Parçalar → Çizim with that part selected.
  const openPart = useCallback(
    (partId: string, hole?: number) => {
      setPartsSelection([partId]);
      setHoleFocus(hole !== undefined ? { partId, hole } : null);
      setPartsViewState('drawing');
      setStep('parcalar');
      focusHeading.current = true;
      // One history entry for the step and the view (Back returns to the step it came from).
      window.history.pushState(
        { [STEP_STATE]: 'parcalar' },
        '',
        `${stepUrl(session.projectId, 'parcalar')}&gorunum=cizim`,
      );
      stepRef.current = 'parcalar';
    },
    [session.projectId],
  );

  // Only the opening it was asked for: the grid reports it once it has focused the row.
  const clearRowFocus = useCallback(() => setRowFocus(null), []);
  // T287: "Parçalara git" on a blocking part issue opens Parçalar → Liste on that part's row.
  const openRow = useCallback(
    (partId: string) => {
      setPartsSelection([partId]);
      setRowFocus(partId);
      setPartsViewState('list');
      setStep('parcalar');
      window.history.pushState(
        { [STEP_STATE]: 'parcalar' },
        '',
        stepUrl(session.projectId, 'parcalar'),
      );
      stepRef.current = 'parcalar';
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

  // T264: "Kesim ayarı ekle" leaves only after the project is saved, so the way back always names
  // this project (also when clicked before the first autosave of a new project finished).
  const settle = session.settle;
  const resolveFixReturn = useCallback(async () => {
    const id = await settle();
    return `${stepUrl(id, 'makine')}&${LATEST_PARAM}=${LATEST_VALUE}`;
  }, [settle]);

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
              resolveReturnTo={resolveFixReturn}
              project={project}
              machines={machines}
              library={library}
              detail={pinned}
              latest={detail}
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
        view3d={{ t: messages.layout.preview3d, table: tableSpecOf(profile) }}
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
      <InnerIssuesContext.Provider value={innerIssues}>
        <HoleIssuesContext.Provider value={holeIssues}>
          <DrawingBoard
            t={messages.editor}
            project={project}
            run={session.run}
            onToList={() => setPartsView('list')}
            viewSwitch={switchInCanvas ? viewSwitch : undefined}
            toolDiameter={toolDiameter}
            holeTool={{
              number: holeToolNo,
              diameter: (profile && findTool(profile, holeToolNo)?.diameter) ?? toolDiameter,
            }}
            initialSelection={partsSelection}
            onSelectionChange={setPartsSelection}
            dxfText={messages.dxfImport}
          />
        </HoleIssuesContext.Provider>
      </InnerIssuesContext.Provider>
    );
  } else if (step === 'parcalar') {
    const sourceId = session.projectId;
    /**
     * T292: the cabinet's other-thickness parts become a new project on the same machine and
     * profile version, linked to this one; the toast opens it.
     */
    const split = async (rows: unknown[], target: SplitTarget) => {
      const s = messages.cutList.cabinet.split;
      const out = sourceId
        ? splitOffProject(project, rows, target, new Date().toISOString())
        : null;
      if (!sourceId || !out) {
        notify.error(s.failed);
        return;
      }
      const id = crypto.randomUUID();
      const name = fill(s.projectName, {
        name: session.name,
        t: new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(target.thickness),
      }).slice(0, 120);
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id,
            name,
            project: out.project,
            commands: out.commands,
            sourceProjectId: sourceId,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setLinksVersion((v) => v + 1);
        const count = out.project.parts.reduce((sum, p) => sum + p.qty, 0);
        notify.success(fill(s.created, { name, count }), {
          id: 'cabinet-split',
          duration: 10_000,
          action: { label: s.open, onClick: () => router.push(`/projeler/${id}?adim=parcalar`) },
        });
      } catch {
        notify.error(s.failed);
      }
    };
    const editor = (
      <CutListEditor
        t={messages.cutList}
        project={project}
        issues={session.issues}
        run={session.run}
        onUndo={session.undo}
        issuesPanel={validation}
        issuesKey={session.projectId ?? undefined}
        initialSelection={partsSelection}
        onSelectionChange={setPartsSelection}
        dxfText={messages.dxfImport}
        holeTool={holeToolNo}
        focusPart={rowFocus}
        onFocusedPart={clearRowFocus}
        splitOff={
          sourceId
            ? {
                materials: messages.materials,
                onSplit: (rows, target) => void split(rows, target),
              }
            : undefined
        }
      />
    );
    // T246 + T253: the table always takes the full width; with issues the Uyarılar panel floats
    // from the issue chip, so the grid never moves or changes its columns while the user types.
    partsFullWidth = true;
    // One wrapper whether or not the project is saved yet: switching the tree on the first save
    // would remount the editor and drop its view state (sort, groups, active cell, drag).
    both = (
      <div className="flex min-w-0 flex-col gap-3">
        {sourceId ? (
          <ProjectLinksBar t={t.links} projectId={sourceId} version={linksVersion} />
        ) : null}
        {editor}
      </div>
    );
  } else if (step === 'dizilim') {
    both = (
      <LayoutStep
        messages={messages}
        session={session}
        toolDiameter={toolDiameter}
        contourTool={(profile && findMaterialParams(profile, project.stock)?.tool) ?? undefined}
        side={validation}
        table={tableSpecOf(profile)}
      />
    );
  } else if (step === 'simulasyon') {
    both = (
      <SimulationView
        left={validation}
        settings={
          <CuttingSettings
            t={messages.simulation.cutting}
            errors={t.machine.errors}
            mm={t.machine.units.mm}
            project={project}
            machine={profile}
            run={session.run}
          />
        }
        t={messages.simulation}
        project={project}
        machine={simMachine}
        view3d={{ t: messages.layout.preview3d, table: tableSpecOf(profile) }}
        notice={versionNotice}
        onOpenPart={openPart}
        onOpenRow={openRow}
        header={{
          projectName: session.name,
          revision: session.revision,
          saved: session.projectId !== null && !session.dirty,
        }}
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
        notice={versionNotice}
        onOpenPart={openPart}
        onOpenRow={openRow}
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
          data-history=""
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
          data-history=""
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
      {/* T149: a newer version of a template this project uses asks before updating. */}
      <TemplateUpdatePrompt
        t={messages.editor.inspector.template}
        project={project}
        run={session.run}
      />
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
              defaultBase={t.defaultName}
              autoSelect={session.projectId === null}
            />
          ) : null}
        </>
      ) : (
        <div className="@container" data-testid="wizard-head-row">
          {/* One header row when the content is as wide as at 1400 px with the sidebar open (T197); a
              container query (T263), so the 1280 px workspace with the icon rail gets the 1440 px row. */}
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3 @min-[1112px]:flex-nowrap @min-[1112px]:items-center">
            <header className="contents">
              <NameField
                label={t.nameLabel}
                value={session.name}
                onCommit={session.rename}
                defaultBase={t.defaultName}
                autoSelect={session.projectId === null && step === 'makine'}
              />
              <div className="order-2 flex items-center gap-1 @min-[1112px]:order-3 @min-[1112px]:shrink-0">
                {headerActions}
              </div>
            </header>

            <div className="order-3 flex w-full min-w-0 items-center gap-3 @min-[1112px]:order-2 @min-[1112px]:w-auto @min-[1112px]:flex-1 @min-[1112px]:@max-[1391px]:min-w-min">
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
        </div>
      )}

      {bannerKind ? (
        <SaveBanner
          t={t.saveBanner}
          kind={bannerKind}
          unsent={session.unsentCount}
          saving={session.saveState === 'saving'}
          onRetry={() => void session.retry()}
        />
      ) : null}
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
              onClick={() => {
                // T155: with the 3D view open the camera first eases to the top view (§3.6).
                const wait = runLeaveTransition();
                if (wait > 0) window.setTimeout(() => go(nextKey), wait);
                else go(nextKey);
              }}
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
          className="hidden size-9 shrink-0 items-center justify-center rounded-lg border border-accent-border bg-accent-subtle text-accent-text sm:@max-[1111px]:flex @min-[1192px]:flex [&_svg]:size-5"
        >
          <StepIcon />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-2xs font-medium tracking-wide text-fg-subtle uppercase @min-[1112px]:@max-[1191px]:sr-only">
            {fill(t.stepOf, { n: index + 1, total: STEPS.length })}
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            data-testid="wizard-step-title"
            data-step={current}
            className="truncate text-lg leading-tight font-semibold tracking-tight text-fg focus:outline-none sm:@max-[1111px]:text-xl @min-[1192px]:text-xl"
          >
            {t[current]}
          </h1>
        </div>
      </div>
      <nav
        aria-label={t.label}
        className="min-w-0 lg:flex-1 @min-[1112px]:@max-[1391px]:min-w-[22.75rem]"
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
                      className={`${status === 'blocked' ? 'text-fg-subtle' : 'text-fg-muted group-hover:text-fg'} hidden min-w-0 truncate whitespace-nowrap xl:@max-[1111px]:block @min-[1392px]:block`}
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
  defaultBase,
}: {
  label: string;
  value: string;
  /** The "Adsız proje" base: while the name is still a default one, typing replaces it (T283). */
  defaultBase: string;
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
  // T283: an untouched default name is selected whole on focus and on every click, so the first
  // typed character replaces it. A user-set name keeps the normal caret behaviour.
  const isDefault = text === null && isUntitledName(defaultBase, value);
  function commit() {
    if (text === null) return;
    const name = text.trim();
    setText(null);
    if (name !== '' && name !== value) onCommit(name.slice(0, 120));
  }
  return (
    // B4b: in the one-row header (≥ 1400 px) the name yields first, down to 10rem (ellipsis + title).
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 sm:@max-[1111px]:min-w-64 @min-[1112px]:min-w-40 @min-[1112px]:flex-[0_1_20rem]">
      {/* T247: from 1280 px the caption goes; the name is the title (the label stays for AT). */}
      <span className="px-2 text-xs font-medium text-fg-subtle lg:sr-only">{label}</span>
      <span className="group/name relative w-full max-w-xl">
        <input
          ref={input}
          type="text"
          data-testid="project-name"
          title={text ?? value}
          value={text ?? value}
          maxLength={120}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => {
            if (isDefault) e.currentTarget.select();
          }}
          onMouseUp={(e) => {
            if (!isDefault) return;
            e.preventDefault();
            e.currentTarget.select();
          }}
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
