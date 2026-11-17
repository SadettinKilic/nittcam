'use client';

import { materialKindOf } from '@nittcam/core';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { buttonClass } from '../../components/parts/ui';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import type { ProjectDetail, ProjectListItem, ProjectStatus } from '../../lib/projects-api';

type Text = Messages['projects'];

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: ProjectListItem[] };

const STATUS_STYLE: Record<ProjectStatus, string> = {
  draft: 'bg-info-bg text-info',
  produced: 'bg-warn-bg text-warn',
  completed: 'bg-ok-bg text-ok',
};

const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

/** Turkish material name for a stored material id (D-029 mapping), else the id itself. */
export function materialLabel(materials: Messages['materials'], id: string): string {
  const kind = materialKindOf(id);
  return kind ? materials[kind] : id;
}

/** Lower case with Turkish rules and folded letters, for searching. */
function fold(s: string): string {
  return s.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
}

/**
 * Projeler (spec §3.4): list with name, status, machine, material and date; search; open; copy;
 * "+ Yeni proje". Data comes from `/api/projects`.
 */
export function ProjectsView({ t, materials }: { t: Text; materials: Messages['materials'] }) {
  const searchId = useId();
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [copying, setCopying] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setList({ status: 'loading' });
    try {
      const res = await fetch('/api/projects', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setList({ status: 'ready', items: (await res.json()) as ProjectListItem[] });
    } catch {
      setList({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    // Initial fetch; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function copy(item: ProjectListItem) {
    setCopying(item.id);
    setNotice(null);
    const name = fill(t.copyName, { name: item.name }).slice(0, 120);
    try {
      const res = await fetch(`/api/projects/${item.id}/copy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const created = (await res.json()) as ProjectDetail;
      await load();
      setNotice({ kind: 'ok', text: fill(t.copied, { name: created.name }) });
    } catch {
      setNotice({ kind: 'error', text: t.copyFailed });
    } finally {
      setCopying(null);
    }
  }

  const items = useMemo(() => (list.status === 'ready' ? list.items : []), [list]);
  const shown = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return items;
    return items.filter((i) =>
      fold(
        [
          i.name,
          i.machine ?? '',
          materialLabel(materials, i.material),
          i.material,
          t.status[i.status],
        ].join(' '),
      ).includes(q),
    );
  }, [items, query, materials, t.status]);

  return (
    <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-fg-muted">{t.subtitle}</p>
        </div>
        <Link
          href="/projeler/yeni"
          data-testid="projects-new"
          className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
        >
          {t.newProject}
        </Link>
      </header>

      <div className="flex flex-col gap-1">
        <label htmlFor={searchId} className="text-sm font-medium">
          {t.search}
        </label>
        <input
          id={searchId}
          type="search"
          data-testid="projects-search"
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-md rounded-md border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
      </div>

      <div aria-live="polite">
        {notice ? (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`rounded-lg p-3 text-sm ${notice.kind === 'error' ? 'bg-danger-bg text-danger' : 'bg-ok-bg text-ok'}`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      {list.status === 'loading' ? (
        <p
          role="status"
          data-testid="projects-loading"
          className="flex items-center gap-3 text-fg-muted"
        >
          <span
            aria-hidden="true"
            className="size-5 animate-spin rounded-full border-2 border-border border-t-accent"
          />
          {t.loading}
        </p>
      ) : list.status === 'error' ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">
            {t.error}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
          >
            {t.retry}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div
          data-testid="projects-empty"
          className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border p-6"
        >
          <p className="text-fg-muted">{t.empty}</p>
          <Link
            href="/projeler/yeni"
            className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
          >
            {t.emptyAction}
          </Link>
        </div>
      ) : (
        <section className="flex min-w-0 flex-col gap-2" aria-labelledby="projects-table">
          <p id="projects-table" className="text-sm text-fg-muted" data-testid="projects-count">
            {fill(t.count, { count: shown.length })}
          </p>
          {shown.length === 0 ? (
            <p className="rounded-card border border-dashed border-border p-6 text-center text-fg-muted">
              {fill(t.noMatch, { q: query.trim() })}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
              {shown.map((item) => (
                <li
                  key={item.id}
                  data-testid="project-row"
                  data-id={item.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/projeler/${item.id}`}
                        className="truncate font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {item.name}
                      </Link>
                      <span
                        data-testid="project-status"
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[item.status]}`}
                      >
                        {t.status[item.status]}
                      </span>
                    </div>
                    <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-muted">
                      <div className="flex gap-1">
                        <dt>{t.columns.machine}:</dt>
                        <dd>{item.machine ?? t.noMachine}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t.columns.material}:</dt>
                        <dd>
                          {fill(t.material, {
                            material: materialLabel(materials, item.material),
                            thickness: mmFormat.format(item.thickness),
                          })}
                          {' · '}
                          {fill(t.pieces, { count: item.pieces })}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t.columns.updated}:</dt>
                        <dd>
                          <time dateTime={item.updatedAt}>
                            {dateFormat.format(new Date(item.updatedAt))}
                          </time>
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link
                      href={`/projeler/${item.id}`}
                      aria-label={fill(t.rowAction, { action: t.open, name: item.name })}
                      className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
                    >
                      {t.open}
                    </Link>
                    <button
                      type="button"
                      aria-label={fill(t.rowAction, { action: t.copy, name: item.name })}
                      disabled={copying !== null}
                      onClick={() => void copy(item)}
                      className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
                    >
                      {copying === item.id ? t.copying : t.copy}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
