'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fill, newProject, toolDiameterFor } from '../../lib/draft-project';
import type { MachineDetail, MachineListItem } from '../../lib/machines-api';
import type { Messages } from '../../lib/messages';
import { useProjectSession, type SessionInit } from '../../lib/project-session';
import type { ProjectDetail } from '../../lib/projects-api';
import { CutListEditor } from '../parts/cut-list-editor';
import { buttonClass } from '../parts/ui';
import { SimulationView, type SimMachine } from '../simulation/simulation-view';
import { ExportStep } from './export-step';
import { LayoutStep } from './layout-step';
import { MachineFields, SheetPreview } from './machine-step';
import { ValidationPanel } from './validation-panel';
import { STEPS, toStep, type StepKey } from '../../lib/wizard-steps';
import { Badge, Button, ErrorState, notify } from '@nittcam/ui';
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
          const date = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
          init = {
            id: null,
            revision: 0,
            name: fill(t.defaultName, { date: date.format(new Date()) }),
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
  const validation = <ValidationPanel t={t.issues} project={project} issues={session.issues} />;

  let left: ReactNode = null;
  let right: ReactNode = null;
  let both: ReactNode = null;
  if (step === 'makine') {
    left =
      machines.length === 0 ? (
        <p role="alert" className="rounded-lg bg-warn-bg p-3 text-sm text-warn">
          {t.noMachines}{' '}
          <Link href="/makineler" className="font-medium underline">
            {t.machinesLink}
          </Link>
        </p>
      ) : (
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
      );
    right = <SheetPreview t={t.machine} project={project} profile={profile} />;
  } else if (step === 'parcalar') {
    left = (
      <aside className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-fg-muted">{messages.cutList.subtitle}</p>
        {validation}
      </aside>
    );
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
    left = <aside className="flex min-w-0 flex-col gap-3">{validation}</aside>;
    right = (
      <SimulationView
        t={messages.simulation}
        project={project}
        machine={simMachine}
        empty={{
          noLayout: (
            <section
              data-testid="sim-empty"
              className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border p-6"
            >
              <p className="text-fg-muted">{t.simulation.empty}</p>
              <button
                type="button"
                onClick={() => go('dizilim')}
                className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
              >
                {t.simulation.toLayout}
              </button>
            </section>
          ),
          noMachine: (
            <p role="alert" className="rounded-lg bg-warn-bg p-3 text-sm text-warn">
              {detailError ? t.machinesError : t.simulation.noMachine}
            </p>
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

  return (
    <main className="mx-auto flex w-full max-w-[96rem] min-w-0 flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <NameField label={t.nameLabel} value={session.name} onCommit={session.rename} />
        <div className="flex flex-wrap items-center gap-2">
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
            >
              {saveText}
            </Badge>
          </ShellStatus>
          <button
            type="button"
            onClick={session.undo}
            disabled={!session.canUndo}
            aria-keyshortcuts={ariaKeyShortcuts(shortcutById('undo').keys, false)}
            className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
          >
            {messages.cutList.undo}
          </button>
          <button
            type="button"
            onClick={session.redo}
            disabled={!session.canRedo}
            aria-keyshortcuts={ariaKeyShortcuts(shortcutById('redo').keys, false)}
            className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
          >
            {messages.cutList.redo}
          </button>
        </div>
      </header>

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
        <p role="status" className="rounded-lg bg-info-bg p-3 text-sm text-info">
          {fill(t.restored, { count: session.restoredCount })}
        </p>
      ) : null}

      <StepIndicator t={t.steps} current={step} onGo={go} />

      <h1
        ref={heading}
        tabIndex={-1}
        data-testid="wizard-step-title"
        data-step={step}
        className="text-2xl font-semibold tracking-tight focus:outline-none"
      >
        {t.steps[step]}
      </h1>

      <div className={`grid min-w-0 gap-5 ${GRID[step]}`}>
        {both ?? (
          <>
            <div className="min-w-0">{left}</div>
            <div className="min-w-0">{right}</div>
          </>
        )}
      </div>

      <nav
        aria-label={t.steps.label}
        className="flex flex-wrap justify-between gap-2 border-t border-border pt-4"
      >
        <button
          type="button"
          data-testid="wizard-back"
          disabled={index === 0}
          onClick={() => go(STEPS[index - 1] ?? 'makine')}
          className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
        >
          {t.back}
        </button>
        {index < STEPS.length - 1 ? (
          <button
            type="button"
            data-testid="wizard-next"
            onClick={() => go(STEPS[index + 1] ?? 'export')}
            className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
          >
            {t.next}
          </button>
        ) : null}
      </nav>
    </main>
  );
}

function StepIndicator({
  t,
  current,
  onGo,
}: {
  t: Messages['wizard']['steps'];
  current: StepKey;
  onGo: (step: StepKey) => void;
}) {
  const index = STEPS.indexOf(current);
  return (
    <nav aria-label={t.label}>
      <p className="mb-2 text-xs text-fg-muted sm:hidden">
        {fill(t.stepOf, { n: index + 1, total: STEPS.length })}
      </p>
      <ol className="flex flex-wrap gap-1.5" data-testid="wizard-steps">
        {STEPS.map((s, i) => {
          const active = s === current;
          const done = i < index;
          return (
            <li key={s}>
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                data-testid={`wizard-step-${s}`}
                onClick={() => onGo(s)}
                className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active ? 'border-accent bg-accent text-accent-fg' : done ? 'border-accent/40 bg-bg text-fg hover:bg-sidebar' : 'border-border bg-bg text-fg-muted hover:bg-sidebar'}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-5 items-center justify-center rounded-full text-xs font-semibold ${active ? 'bg-accent-fg text-accent' : 'bg-sidebar text-fg'}`}
                >
                  {i + 1}
                </span>
                <span className={active ? '' : 'sr-only md:not-sr-only'}>{t[s]}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function NameField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (name: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  function commit() {
    if (text === null) return;
    const name = text.trim();
    setText(null);
    if (name !== '' && name !== value) onCommit(name.slice(0, 120));
  }
  return (
    <label className="flex min-w-64 flex-1 flex-col gap-1">
      <span className="text-xs text-fg-muted">{label}</span>
      <input
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
        className="w-full max-w-xl rounded-md border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold hover:border-border focus-visible:border-border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
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
    <section
      role="alert"
      data-testid="conflict"
      className="flex flex-col gap-3 rounded-card border border-danger/40 bg-danger-bg p-4 text-danger"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t.title}</h2>
        <p className="text-sm">{t.body}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReload}
          className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
        >
          {t.reload}
        </button>
        <button
          type="button"
          onClick={() => void keepCopy()}
          disabled={busy}
          className={`${buttonClass} border border-border bg-bg text-fg hover:bg-sidebar`}
        >
          {busy ? t.copying : t.keepCopy}
        </button>
      </div>
      {failed ? <p className="text-sm font-medium">{t.copyFailed}</p> : null}
    </section>
  );
}
