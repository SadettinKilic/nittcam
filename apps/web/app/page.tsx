import { materialKindOf, type VerificationState } from '@nittcam/core';
import { Badge, Button, Card, EmptyState, ErrorState, RouterIcon } from '@nittcam/ui';
import {
  ArrowRight,
  ClipboardPaste,
  FileOutput,
  FolderOpen,
  LayoutGrid,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageSkeleton } from '../components/feedback/page-skeleton';
import { ThrowProbe } from '../components/feedback/throw-probe';
import { LayoutThumbnail } from '../components/home/layout-thumb';
import { StartStrip } from '../components/home/start-strip';
import { StatTile } from '../components/home/stat-tile';
import { MaintenanceBadge } from '../components/machines/maintenance-badge';
import { MachineStateBadge } from '../components/machines/state-badge';
import { localDay, maintenanceView } from '../lib/maintenance';
import {
  PageHeader,
  SectionHeader,
  focusRing,
  pageContainer,
  sectionLink,
} from '../components/page/page-header';
import {
  dashboardStats,
  layoutThumb,
  machinesByUrgency,
  type DashboardStats,
  type LayoutThumb,
} from '../lib/dashboard';
import { fill } from '../lib/draft-project';
import { getMessages, type Messages } from '../lib/messages';
import type { MachineListItem } from '../lib/machines-api';
import { PROJECT_STATUS_TONE, type ProjectListItem } from '../lib/projects-api';
import { companyScope } from '../lib/server/company';
import { versionNumbers } from '../lib/server/exports';
import { toListItem as machineItem } from '../lib/server/machines';
import { machineNames, toListItem } from '../lib/server/projects';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${getMessages().nav.home} · ${getMessages().meta.title}`,
};

/** Recent project cards on the home page (a 2 × 2 grid on wide screens). */
const RECENT = 4;
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const countFormat = new Intl.NumberFormat('tr-TR');
const pctFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

interface RecentProject {
  item: ProjectListItem;
  thumb: LayoutThumb | null;
}

type Dashboard =
  | { ok: true; stats: DashboardStats; recent: RecentProject[]; machines: MachineListItem[] }
  | { ok: false };

async function loadDashboard(): Promise<Dashboard> {
  try {
    const scope = await companyScope();
    const [rows, names, machines, exports, latest, versions] = await Promise.all([
      scope.projects.list(),
      machineNames(scope),
      scope.machines.listWithProfiles(),
      scope.exports.list(),
      scope.exports.latestPerProject(),
      versionNumbers(scope),
    ]);
    const last = new Map(latest.map((e) => [e.projectId, e]));
    const sorted = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    // T289: archived machines count nowhere on Ana sayfa (old projects still name them).
    const machineItems = machines.map(machineItem).filter((m) => !m.archived);
    return {
      ok: true,
      stats: dashboardStats({
        projects: rows,
        machines: machineItems,
        exports,
        now: new Date(),
      }),
      recent: sorted.slice(0, RECENT).map((r) => ({
        item: toListItem(r, names, last, versions),
        thumb: layoutThumb(r.data),
      })),
      machines: machinesByUrgency(machineItems),
    };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

/** Ana sayfa (spec §3.4, T106): workshop summary, recent projects, machines, quick actions. */
export default function HomePage() {
  // Streams the skeleton first while the dashboard reads the database (T105).
  return (
    <Suspense fallback={<PageSkeleton label={getMessages().feedback.loading} />}>
      <Dashboard />
      {/* Test-only crash for the app error page e2e (inert in production). */}
      <ThrowProbe target="page" />
    </Suspense>
  );
}

async function Dashboard() {
  const messages = getMessages();
  const t = messages.home;
  const data = await loadDashboard();
  return (
    <main className={`${pageContainer} gap-8`}>
      <PageHeader
        title={t.title}
        description={t.subtitle}
        actions={
          <Button asChild className="md:hidden">
            <Link href="/projeler/yeni" data-testid="home-new-project">
              <Plus aria-hidden />
              {t.newProject}
            </Link>
          </Button>
        }
      />

      {!data.ok ? (
        <ErrorState
          title={t.errorTitle}
          description={t.error}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/">{t.retry}</Link>
            </Button>
          }
        />
      ) : (
        <>
          {data.stats.projects === 0 ? (
            <StartStrip
              label={t.start.label}
              doneLabel={t.start.done}
              steps={[
                { ...t.start.machine, href: '/makineler', done: data.stats.machines > 0 },
                { ...t.start.cutList, href: '/projeler/yeni?adim=parcalar' },
                { ...t.start.gcode, href: '/projeler/yeni' },
              ]}
            />
          ) : (
            <Stats stats={data.stats} t={t} />
          )}
          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:gap-6">
            <RecentProjects recent={data.recent} messages={messages} />
            <div className="flex min-w-0 flex-col gap-6">
              <Machines machines={data.machines} messages={messages} />
              <QuickActions t={t} />
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Stats({ stats, t }: { stats: DashboardStats; t: Messages['home'] }) {
  const s = t.stats;
  return (
    <section
      aria-label={s.label}
      className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1"
    >
      <StatTile
        testId="stat-projects"
        label={s.projects}
        value={countFormat.format(stats.projects)}
        hint={fill(s.projectsHint, { n: countFormat.format(stats.drafts) })}
        icon={<FolderOpen />}
      />
      <StatTile
        testId="stat-exports"
        label={s.exports}
        value={countFormat.format(stats.exportsThisWeek)}
        hint={s.exportsHint}
        icon={<FileOutput />}
      />
      <StatTile
        testId="stat-machines"
        label={s.machines}
        value={fill(s.machinesValue, {
          verified: countFormat.format(stats.verified),
          total: countFormat.format(stats.machines),
        })}
        hint={
          stats.pending > 0
            ? fill(s.machinesPending, { n: countFormat.format(stats.pending) })
            : s.machinesAllVerified
        }
        icon={<ShieldCheck />}
      />
    </section>
  );
}

function RecentProjects({ recent, messages }: { recent: RecentProject[]; messages: Messages }) {
  const t = messages.home;
  return (
    <section aria-labelledby="home-recent" className="flex min-w-0 flex-col gap-4">
      <SectionHeader
        id="home-recent"
        title={t.recent}
        description={t.recentDescription}
        action={
          <Link href="/projeler" className={sectionLink}>
            {t.allProjects}
            <ArrowRight aria-hidden />
          </Link>
        }
      />
      {recent.length === 0 ? (
        <EmptyState
          data-testid="home-projects-empty"
          icon={<LayoutGrid />}
          title={t.recentEmptyTitle}
          description={t.recentEmpty}
          action={
            <>
              <Button asChild size="sm" variant="secondary">
                <Link href="/projeler/yeni">
                  <Plus aria-hidden />
                  {t.newProject}
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/projeler/yeni?adim=parcalar">
                  <ClipboardPaste aria-hidden />
                  {t.quick.paste.title}
                </Link>
              </Button>
            </>
          }
        />
      ) : (
        <ul data-testid="home-projects" className="grid gap-4 sm:grid-cols-2">
          {recent.map((r) => (
            <li key={r.item.id} className="min-w-0">
              <ProjectCard project={r} messages={messages} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectCard({ project, messages }: { project: RecentProject; messages: Messages }) {
  const { item, thumb } = project;
  const t = messages.home.card;
  const kind = materialKindOf(item.material);
  const material = fill(messages.projects.material, {
    material: kind ? messages.materials[kind] : item.material,
    thickness: mmFormat.format(item.thickness),
  });
  return (
    <Card interactive className="group relative flex h-full flex-col overflow-hidden">
      <div className="relative flex h-32 items-center justify-center border-b border-border-subtle bg-canvas p-3">
        {thumb ? (
          <>
            <LayoutThumbnail thumb={thumb} label={fill(t.thumb, { name: item.name })} />
            <span
              data-testid="home-thumb-utilisation"
              className="numeric absolute right-2 bottom-2 rounded-md border border-border bg-surface/90 px-1.5 py-0.5 text-2xs font-medium text-fg shadow-xs backdrop-blur-sm"
            >
              {fill(t.utilisation, { value: pctFormat.format(thumb.utilisation) })}
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-2 text-xs text-fg-muted">
            <LayoutGrid aria-hidden className="size-5" />
            {t.noLayout}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/projeler/${item.id}`}
            className={`min-w-0 truncate rounded-sm text-sm font-semibold text-fg after:absolute after:inset-0 after:rounded-xl ${focusRing}`}
          >
            {item.name}
          </Link>
          <Badge variant={PROJECT_STATUS_TONE[item.status]}>
            {messages.projects.status[item.status]}
          </Badge>
        </div>
        <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-fg-muted">
          <span>{item.machine ?? messages.projects.noMachine}</span>
          <span aria-hidden>·</span>
          <span>{material}</span>
          <span aria-hidden>·</span>
          <span className="numeric">{fill(t.pieces, { n: countFormat.format(item.pieces) })}</span>
          {thumb && thumb.sheets > 1 ? (
            <>
              <span aria-hidden>·</span>
              <span className="numeric">{fill(t.sheets, { n: thumb.sheets })}</span>
            </>
          ) : null}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-subtle pt-3 text-xs text-fg-muted">
          <span className="flex min-w-0 items-center gap-1.5">
            <FileOutput aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">
              {item.lastExport
                ? fill(t.lastExport, {
                    date: dateFormat.format(new Date(item.lastExport.createdAt)),
                  })
                : t.noExport}
            </span>
          </span>
          <time dateTime={item.updatedAt} className="numeric shrink-0">
            {dateFormat.format(new Date(item.updatedAt))}
          </time>
        </div>
      </div>
    </Card>
  );
}

function needsVerification(state: VerificationState): boolean {
  return state !== 'verified';
}

function Machines({ machines, messages }: { machines: MachineListItem[]; messages: Messages }) {
  const t = messages.home;
  // T181: maintenance reminder on the workshop's calendar day.
  const today = localDay();
  return (
    <section aria-labelledby="home-machines" className="flex min-w-0 flex-col gap-4">
      <SectionHeader
        id="home-machines"
        title={t.machines}
        description={t.machinesDescription}
        action={
          <Link href="/makineler" className={sectionLink}>
            {t.allMachines}
            <ArrowRight aria-hidden />
          </Link>
        }
      />
      {machines.length === 0 ? (
        <EmptyState
          compact
          icon={<RouterIcon />}
          title={t.machinesEmptyTitle}
          description={t.machinesEmpty}
          action={
            <Button asChild size="sm">
              <Link href="/makineler?yeni=1">
                <Plus aria-hidden />
                {t.quick.addMachine.title}
              </Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <ul data-testid="home-machines" className="divide-y divide-border-subtle">
            {machines.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-subtle text-fg-muted [&_svg]:size-4"
                >
                  <RouterIcon />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium text-fg">{m.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <MachineStateBadge state={m.state} label={messages.machines.state[m.state]} />
                    {m.example ? <Badge>{t.example}</Badge> : null}
                    <HomeMaintenance m={m} today={today} t={messages.machines.maintenance} />
                  </span>
                </div>
                {needsVerification(m.state) ? (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/makineler/${m.id}/dogrulama`}
                      aria-label={fill(t.verifyLabel, { name: m.name })}
                    >
                      {t.verify}
                    </Link>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

/** T181: "Bakım gecikti" / "Bakım yaklaşıyor" badge, only when a reminder is due. */
function HomeMaintenance({
  m,
  today,
  t,
}: {
  m: MachineListItem;
  today: string;
  t: Messages['machines']['maintenance'];
}) {
  const view = maintenanceView(m.maintenance, today, t);
  return view.remind ? <MaintenanceBadge view={view} data-testid="home-maintenance" /> : null;
}

function QuickActions({ t }: { t: Messages['home'] }) {
  const q = t.quick;
  const items = [
    { href: '/projeler/yeni', icon: <Plus />, ...q.newProject },
    { href: '/projeler/yeni?adim=parcalar', icon: <ClipboardPaste />, ...q.paste },
    { href: '/makineler?yeni=1', icon: <RouterIcon />, ...q.addMachine },
  ];
  return (
    <section aria-labelledby="home-quick" className="flex min-w-0 flex-col gap-4">
      <SectionHeader id="home-quick" title={q.title} />
      <Card className="overflow-hidden">
        <ul data-testid="home-quick" className="divide-y divide-border-subtle">
          {items.map((a) => (
            <li key={a.href}>
              <Link
                href={a.href}
                className={`group flex items-center gap-3 px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-surface-hover ${focusRing} focus-visible:outline-offset-[-2px]`}
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-accent-border bg-accent-subtle text-accent-text [&_svg]:size-4"
                >
                  {a.icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-fg">{a.title}</span>
                  <span className="truncate text-xs text-fg-muted">{a.text}</span>
                </span>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-fg-subtle transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
