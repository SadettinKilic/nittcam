'use client';

import { materialKindOf } from '@nittcam/core';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Skeleton,
  Tooltip,
  notify,
} from '@nittcam/ui';
import { Copy, FolderPlus, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { PageHeader, focusRing, pageContainer } from '../../components/page/page-header';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import {
  PROJECT_STATUS_TONE,
  type ProjectDetail,
  type ProjectListItem,
} from '../../lib/projects-api';

type Text = Messages['projects'];

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: ProjectListItem[] };

/** Columns of the project list on wide screens (one DOM for the table and the card look). */
const COLS =
  'lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_auto]';

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
      notify.success(fill(t.copied, { name: created.name }));
    } catch {
      notify.error(t.copyFailed);
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
    <main className={`${pageContainer} gap-6`}>
      <PageHeader
        title={t.title}
        description={t.subtitle}
        actions={
          <Button asChild>
            <Link href="/projeler/yeni" data-testid="projects-new">
              <Plus aria-hidden />
              {t.newProject}
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={searchId} className="text-sm font-medium text-fg">
          {t.search}
        </label>
        <div className="relative w-full max-w-md">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            id={searchId}
            type="search"
            data-testid="projects-search"
            placeholder={t.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {list.status === 'loading' ? (
        <div role="status" data-testid="projects-loading" className="flex flex-col gap-2">
          <span className="sr-only">{t.loading}</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : list.status === 'error' ? (
        <ErrorState
          data-testid="projects-error"
          title={t.error}
          retryLabel={t.retry}
          onRetry={() => void load()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          data-testid="projects-empty"
          icon={<FolderPlus />}
          title={t.empty}
          description={t.emptyText}
          action={
            <Button asChild>
              <Link href="/projeler/yeni">{t.emptyAction}</Link>
            </Button>
          }
        />
      ) : (
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="projects-table">
          <p id="projects-table" className="text-sm text-fg-muted" data-testid="projects-count">
            {fill(t.count, { count: shown.length })}
          </p>
          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-fg-muted">
              {fill(t.noMatch, { q: query.trim() })}
            </p>
          ) : (
            <Card className="overflow-hidden p-0">
              <div
                aria-hidden="true"
                className={`hidden gap-4 border-b border-border bg-surface-subtle px-5 py-2.5 text-xs font-medium text-fg-muted lg:grid ${COLS}`}
              >
                <span>{t.columns.name}</span>
                <span>{t.columns.machine}</span>
                <span>{t.columns.material}</span>
                <span>{t.columns.updated}</span>
                <span>{t.columns.lastExport}</span>
                <span className="w-24" />
              </div>
              <ul className="flex flex-col divide-y divide-border-subtle">
                {shown.map((item) => (
                  <li
                    key={item.id}
                    data-testid="project-row"
                    data-id={item.id}
                    className={`grid gap-3 px-4 py-3.5 transition-colors duration-(--duration-fast) hover:bg-surface-hover lg:items-center lg:gap-4 lg:px-5 ${COLS}`}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link
                        href={`/projeler/${item.id}`}
                        className={`min-w-0 truncate rounded-sm font-medium text-fg hover:underline ${focusRing}`}
                      >
                        {item.name}
                      </Link>
                      <Badge
                        data-testid="project-status"
                        variant={PROJECT_STATUS_TONE[item.status]}
                        dot
                      >
                        {t.status[item.status]}
                      </Badge>
                    </div>
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted lg:contents lg:text-sm">
                      <div className="flex min-w-0 gap-1">
                        <dt className="lg:sr-only">{t.columns.machine}:</dt>
                        <dd className="truncate">{item.machine ?? t.noMachine}</dd>
                      </div>
                      <div className="flex min-w-0 gap-1">
                        <dt className="lg:sr-only">{t.columns.material}:</dt>
                        <dd className="numeric">
                          {fill(t.material, {
                            material: materialLabel(materials, item.material),
                            thickness: mmFormat.format(item.thickness),
                          })}
                          {' · '}
                          {fill(t.pieces, { count: item.pieces })}
                        </dd>
                      </div>
                      <div className="flex min-w-0 gap-1">
                        <dt className="lg:sr-only">{t.columns.updated}:</dt>
                        <dd className="numeric">
                          <time dateTime={item.updatedAt}>
                            {dateFormat.format(new Date(item.updatedAt))}
                          </time>
                        </dd>
                      </div>
                      <div className="flex min-w-0 gap-1" data-testid="project-last-export">
                        <dt className="lg:sr-only">{t.columns.lastExport}:</dt>
                        <dd className="flex min-w-0 flex-wrap gap-x-2">
                          {item.lastExport ? (
                            <>
                              <time dateTime={item.lastExport.createdAt}>
                                {fill(t.lastExport, {
                                  revision: item.lastExport.revision,
                                  date: dateFormat.format(new Date(item.lastExport.createdAt)),
                                })}
                              </time>
                              {item.lastExport.files.map((file) => (
                                <a
                                  key={file.name}
                                  href={file.downloadUrl}
                                  download={file.name}
                                  title={file.hash}
                                  className={`rounded-sm break-all text-accent-text underline underline-offset-4 ${focusRing}`}
                                >
                                  {fill(t.downloadLast, { name: file.name })}
                                </a>
                              ))}
                            </>
                          ) : (
                            <span className="text-fg-subtle">{t.noExport}</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex shrink-0 items-center gap-1 lg:w-24 lg:justify-end">
                      <Button asChild variant="outline" size="sm">
                        <Link
                          href={`/projeler/${item.id}`}
                          aria-label={fill(t.rowAction, { action: t.open, name: item.name })}
                        >
                          {t.open}
                        </Link>
                      </Button>
                      <Tooltip content={t.copy}>
                        <IconButton
                          size="sm"
                          aria-label={fill(t.rowAction, { action: t.copy, name: item.name })}
                          disabled={copying !== null}
                          loading={copying === item.id}
                          onClick={() => void copy(item)}
                        >
                          <Copy aria-hidden />
                        </IconButton>
                      </Tooltip>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
    </main>
  );
}
