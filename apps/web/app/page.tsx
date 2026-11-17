import { materialKindOf } from '@nittcam/core';
import { PageTitle } from '@nittcam/ui';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageSkeleton } from '../components/feedback/page-skeleton';
import { buttonClass } from '../components/parts/ui';
import { fill } from '../lib/draft-project';
import { getMessages } from '../lib/messages';
import type { ProjectListItem } from '../lib/projects-api';
import { companyScope } from '../lib/server/company';
import { toListItem as machineItem } from '../lib/server/machines';
import { machineNames, toListItem } from '../lib/server/projects';
import type { MachineListItem } from '../lib/machines-api';

export const dynamic = 'force-dynamic';

const RECENT = 5;
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

async function loadDashboard(): Promise<
  { ok: true; projects: ProjectListItem[]; machines: MachineListItem[] } | { ok: false }
> {
  try {
    const scope = await companyScope();
    const [rows, names, machines] = await Promise.all([
      scope.projects.list(),
      machineNames(scope),
      scope.machines.listWithProfiles(),
    ]);
    return {
      ok: true,
      projects: rows.slice(0, RECENT).map((r) => toListItem(r, names)),
      machines: machines.map(machineItem).filter((m) => m.state !== 'verified'),
    };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

/** Ana sayfa (spec §3.4): latest projects and the machines waiting for verification. */
export default function HomePage() {
  // Streams the skeleton first while the dashboard reads the database (T105).
  return (
    <Suspense fallback={<PageSkeleton label={getMessages().feedback.loading} />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const messages = getMessages();
  const t = messages.home;
  const data = await loadDashboard();
  return (
    <main className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle subtitle={t.subtitle}>{t.title}</PageTitle>
        <Link
          href="/projeler/yeni"
          className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
        >
          {t.newProject}
        </Link>
      </div>

      {!data.ok ? (
        <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">
          {t.error}
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="home-recent" className="flex min-w-0 flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="home-recent" className="text-xl font-semibold">
                {t.recent}
              </h2>
              <Link href="/projeler" className="text-sm text-accent hover:underline">
                {t.allProjects}
              </Link>
            </div>
            {data.projects.length === 0 ? (
              <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">
                {t.recentEmpty}
              </p>
            ) : (
              <ul
                data-testid="home-projects"
                className="flex flex-col divide-y divide-border rounded-card border border-border"
              >
                {data.projects.map((p) => {
                  const kind = materialKindOf(p.material);
                  return (
                    <li key={p.id} className="flex flex-col gap-0.5 p-3">
                      <Link
                        href={`/projeler/${p.id}`}
                        className="truncate font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {p.name}
                      </Link>
                      <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                        <span>{messages.projects.status[p.status]}</span>
                        <span>{p.machine ?? messages.projects.noMachine}</span>
                        <span>
                          {fill(messages.projects.material, {
                            material: kind ? messages.materials[kind] : p.material,
                            thickness: mmFormat.format(p.thickness),
                          })}
                        </span>
                        <time dateTime={p.updatedAt}>
                          {dateFormat.format(new Date(p.updatedAt))}
                        </time>
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="home-machines" className="flex min-w-0 flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="home-machines" className="text-xl font-semibold">
                {t.machines}
              </h2>
              <Link href="/makineler" className="text-sm text-accent hover:underline">
                {t.allMachines}
              </Link>
            </div>
            {data.machines.length === 0 ? (
              <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">
                {t.machinesEmpty}
              </p>
            ) : (
              <ul
                data-testid="home-machines"
                className="flex flex-col divide-y divide-border rounded-card border border-border"
              >
                {data.machines.map((m) => (
                  <li key={m.id} className="flex flex-col gap-0.5 p-3">
                    <span className="font-medium">{m.name}</span>
                    <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                      <span className="text-warn">{messages.machines.state[m.state]}</span>
                      {m.example ? <span>{t.example}</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
