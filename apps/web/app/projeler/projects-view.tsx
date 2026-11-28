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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  notify,
} from '@nittcam/ui';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderPlus,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { PageHeader, focusRing, pageContainer } from '../../components/page/page-header';
import { fill } from '../../lib/fill';
import { OffcutStock } from './offcut-stock';
import { DRAFT_PARAM, discardLeftDraft, leftDrafts, type LeftDraft } from '../../lib/autosave';
import { LeftDraftNotice } from './left-draft-notice';
import type { Messages } from '../../lib/messages';
import { materialHeadName } from '../../lib/material-head';

import {
  NO_FILTERS,
  NO_MACHINE,
  PROJECT_TABS,
  filterOptions,
  filterProjects,
  hasFilters,
  paginate,
  sortProjects,
  type ProjectFilters,
  type ProjectTab,
  type SortKey,
} from '../../lib/project-list';
import {
  PROJECT_STATUS_TONE,
  type ProjectDetail,
  type ProjectListItem,
  type ProjectStatus,
} from '../../lib/projects-api';
import { changedAfterProduced, isOldRevision } from '../../lib/export-current';

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

/** Select value for "all" (Radix Select items cannot have an empty value). */
const ALL = '__all__';

/**
 * Projeler (spec §3.4): list with name, status, machine, material and date; search (Turkish
 * folding), filters, sort, pagination; open; copy; delete with "Geri al"; "Silinenler" with
 * restore (T178); "+ Yeni proje". Data comes from `/api/projects`.
 */
export function ProjectsView({
  t,
  materials,
  materialHead,
  initialTab = 'projects',
}: {
  t: Text;
  materials: Messages['materials'];
  /** T350: header names of the metal kinds (Kompozit panel, Alüminyum 5754); passed from the server page so the client bundle does not carry tr.json. */
  materialHead: Messages['materialHead'];
  initialTab?: ProjectTab;
}) {
  const [tab, setTab] = useState<ProjectTab>(initialTab);
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [deletedList, setDeletedList] = useState<ListState>({ status: 'loading' });
  const [copying, setCopying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // T326 (D-117): new projects whose tab was closed before the server had them.
  const [drafts, setDrafts] = useState<LeftDraft[]>([]);
  useEffect(() => {
    try {
      const store = window.localStorage;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrafts(leftDrafts(store, Object.keys(store)));
    } catch {
      // Blocked storage: nothing to offer.
    }
  }, []);

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

  const loadDeleted = useCallback(async () => {
    setDeletedList({ status: 'loading' });
    try {
      const res = await fetch('/api/projects?silinen=1', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setDeletedList({ status: 'ready', items: (await res.json()) as ProjectListItem[] });
    } catch {
      setDeletedList({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    // Initial fetch; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // The deleted list loads when its tab opens (and again on every visit).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === 'deleted') void loadDeleted();
  }, [tab, loadDeleted]);

  function changeTab(next: string) {
    const key: ProjectTab = next in PROJECT_TABS ? (next as ProjectTab) : 'projects';
    setTab(key);
    try {
      const url = new URL(window.location.href);
      const v = PROJECT_TABS[key];
      if (v) url.searchParams.set('sekme', v);
      else url.searchParams.delete('sekme');
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // URL sync is a convenience only.
    }
  }

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

  async function setDeleted(id: string, deleted: boolean): Promise<void> {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deleted }),
    });
    if (!res.ok) throw new Error(String(res.status));
  }

  /**
   * Soft delete (T178): no confirm dialog; the row leaves the list and the toast offers
   * "Geri al" (the project, its history and exports are kept on the server).
   */
  async function remove(item: ProjectListItem) {
    setBusy(item.id);
    try {
      await setDeleted(item.id, true);
      setList((l) =>
        l.status === 'ready' ? { ...l, items: l.items.filter((i) => i.id !== item.id) } : l,
      );
      notify.success(fill(t.deleted, { name: item.name }), {
        id: `project-deleted-${item.id}`,
        duration: 8000,
        action: { label: t.undo, onClick: () => void restore(item) },
      });
    } catch {
      notify.error(t.deleteFailed);
    } finally {
      setBusy(null);
    }
  }

  async function restore(item: ProjectListItem) {
    setBusy(item.id);
    try {
      await setDeleted(item.id, false);
      setDeletedList((l) =>
        l.status === 'ready' ? { ...l, items: l.items.filter((i) => i.id !== item.id) } : l,
      );
      await load();
      notify.success(fill(t.restored, { name: item.name }));
    } catch {
      notify.error(t.restoreFailed);
    } finally {
      setBusy(null);
    }
  }

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

      {drafts.map((d) => {
        const saved =
          d.parked === true ||
          (list.status === 'ready' && list.items.some((p) => p.id === d.draftId));
        const href = saved
          ? `/projeler/${d.draftId}`
          : `/projeler/yeni?${DRAFT_PARAM}=${encodeURIComponent(d.draftId)}`;
        return (
          <LeftDraftNotice
            key={d.draftId}
            draft={d}
            href={href}
            t={t.leftDraft}
            onDiscard={(id) => {
              let store: Storage | null = null;
              try {
                store = window.localStorage;
              } catch {
                // Blocked storage: nothing stored either.
              }
              discardLeftDraft(store, id);
              setDrafts((all) => all.filter((x) => x.draftId !== id));
            }}
          />
        );
      })}

      <Tabs value={tab} onValueChange={changeTab} className="flex flex-col gap-6">
        <TabsList aria-label={t.title} className="self-start">
          <TabsTrigger value="projects" data-testid="projects-tab">
            {t.tabs.projects}
          </TabsTrigger>
          <TabsTrigger value="offcuts" data-testid="offcuts-tab">
            {t.tabs.offcuts}
          </TabsTrigger>
          <TabsTrigger value="deleted" data-testid="deleted-tab">
            {t.lists.deleted}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="projects" className="flex flex-col gap-6">
          <ProjectList
            t={t}
            materials={materials}
            materialHead={materialHead}
            mode="live"
            list={list}
            onRetry={() => void load()}
            renderActions={(item) => (
              <>
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
                <Tooltip content={t.delete}>
                  <IconButton
                    size="sm"
                    data-testid="project-delete"
                    aria-label={fill(t.rowAction, { action: t.delete, name: item.name })}
                    disabled={busy !== null}
                    loading={busy === item.id}
                    onClick={() => void remove(item)}
                  >
                    <Trash2 aria-hidden />
                  </IconButton>
                </Tooltip>
              </>
            )}
          />
        </TabsContent>
        <TabsContent value="offcuts">
          <OffcutStock t={t.offcuts} materials={materials} />
        </TabsContent>
        <TabsContent value="deleted" className="flex flex-col gap-6">
          <ProjectList
            t={t}
            materials={materials}
            materialHead={materialHead}
            mode="deleted"
            list={deletedList}
            onRetry={() => void loadDeleted()}
            renderActions={(item) => (
              <Button
                variant="outline"
                size="sm"
                data-testid="project-restore"
                aria-label={fill(t.rowAction, { action: t.restore, name: item.name })}
                disabled={busy !== null}
                loading={busy === item.id}
                onClick={() => void restore(item)}
              >
                <RotateCcw aria-hidden />
                {t.restore}
              </Button>
            )}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

/**
 * One list (live projects or "Silinenler"): search, filters, sort, rows, pagination. A deleted
 * project's name is not a link (its direct link is blocked, T178).
 */
function ProjectList({
  t,
  materials,
  materialHead,
  mode,
  list,
  onRetry,
  renderActions,
}: {
  t: Text;
  materials: Messages['materials'];
  materialHead: Messages['materialHead'];
  mode: 'live' | 'deleted';
  list: ListState;
  onRetry: () => void;
  renderActions: (item: ProjectListItem) => ReactNode;
}) {
  const uid = useId();
  const [filters, setFilters] = useState<ProjectFilters>(NO_FILTERS);
  const [sort, setSort] = useState<SortKey>(mode === 'deleted' ? 'deleted' : 'updated');
  const [page, setPage] = useState(1);
  const live = mode === 'live';

  const items = useMemo(() => (list.status === 'ready' ? list.items : []), [list]);
  const options = useMemo(() => filterOptions(items), [items]);
  const shown = useMemo(
    () =>
      sortProjects(
        filterProjects(items, filters, (i) =>
          [
            i.name,
            i.machine ?? t.noMachine,
            materialLabel(materials, i.material),
            i.material,
            t.status[i.status],
          ].join(' '),
        ),
        sort,
      ),
    [items, filters, sort, materials, t.noMachine, t.status],
  );
  const current = paginate(shown, page);
  const filtered = hasFilters(filters);

  function update(patch: Partial<ProjectFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  if (list.status === 'loading') {
    return (
      <div role="status" data-testid="projects-loading" className="flex flex-col gap-2">
        <span className="sr-only">{t.loading}</span>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (list.status === 'error') {
    return (
      <ErrorState
        data-testid="projects-error"
        title={t.error}
        retryLabel={t.retry}
        onRetry={onRetry}
      />
    );
  }
  // No rows: the search stays (it is where people look first), the empty state replaces the list.
  const emptyState =
    items.length === 0 ? (
      live ? (
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
        <EmptyState
          data-testid="deleted-empty"
          icon={<Trash2 />}
          title={t.deletedEmpty}
          description={t.deletedEmptyText}
        />
      )
    ) : null;

  const selectField = (
    key: 'status' | 'machine' | 'material',
    label: string,
    entries: { value: string; label: string }[],
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`${uid}-${key}`} className="text-sm font-medium text-fg">
        {label}
      </label>
      <Select
        value={filters[key] || ALL}
        onValueChange={(v) => update({ [key]: v === ALL ? '' : v } as Partial<ProjectFilters>)}
      >
        <SelectTrigger
          id={`${uid}-${key}`}
          className="w-full sm:w-44"
          data-testid={`projects-filter-${key}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t.filters.all}</SelectItem>
          {entries.map((e) => (
            <SelectItem key={e.value} value={e.value}>
              {e.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const sortKeys: SortKey[] = live
    ? ['updated', 'oldest', 'name', 'nameDesc']
    : ['deleted', 'updated', 'name', 'nameDesc'];

  return (
    <>
      <div
        role="search"
        aria-label={t.filters.label}
        className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap"
      >
        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 sm:w-72">
          <label htmlFor={`${uid}-q`} className="text-sm font-medium text-fg">
            {t.search}
          </label>
          <div className="relative w-full">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              id={`${uid}-q`}
              type="search"
              data-testid="projects-search"
              placeholder={t.searchPlaceholder}
              value={filters.q}
              onChange={(e) => update({ q: e.target.value })}
              className="pl-9"
            />
          </div>
        </div>
        {emptyState ? null : (
          <>
            {selectField(
              'status',
              t.filters.status,
              (Object.keys(t.status) as ProjectStatus[]).map((s) => ({
                value: s,
                label: t.status[s],
              })),
            )}
            {selectField('machine', t.filters.machine, [
              ...options.machines.map((m) => ({ value: m, label: m })),
              ...(options.hasNoMachine ? [{ value: NO_MACHINE, label: t.noMachine }] : []),
            ])}
            {selectField(
              'material',
              t.filters.material,
              options.materials.map((m) => ({ value: m, label: materialLabel(materials, m) })),
            )}
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${uid}-sort`} className="text-sm font-medium text-fg">
                {t.sort.label}
              </label>
              <Select
                value={sort}
                onValueChange={(v) => {
                  setSort(v as SortKey);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  id={`${uid}-sort`}
                  className="w-full sm:w-44"
                  data-testid="projects-sort"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortKeys.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t.sort[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filtered ? (
              <Button
                variant="ghost"
                size="md"
                data-testid="projects-clear"
                onClick={() => update(NO_FILTERS)}
              >
                <X aria-hidden />
                {t.filters.clear}
              </Button>
            ) : null}
          </>
        )}
      </div>

      {emptyState ?? (
        <section
          className="flex min-w-0 flex-col gap-3"
          aria-labelledby={`${uid}-count`}
          data-testid={live ? 'projects-list' : 'deleted-list'}
        >
          <p
            id={`${uid}-count`}
            className="text-sm text-fg-muted"
            data-testid="projects-count"
            aria-live="polite"
          >
            {filtered
              ? fill(t.countOf, { shown: shown.length, count: items.length })
              : fill(t.count, { count: shown.length })}
          </p>
          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-fg-muted">
              {fill(t.noMatch, { q: filters.q.trim() })}
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
                <span>{live ? t.columns.lastExport : t.columns.deletedAt}</span>
                <span className="w-32" />
              </div>
              <ul className="flex flex-col divide-y divide-border-subtle">
                {current.items.map((item) => (
                  <li
                    key={item.id}
                    data-testid={live ? 'project-row' : 'deleted-row'}
                    data-id={item.id}
                    className={`grid gap-3 px-4 py-3.5 transition-colors duration-(--duration-fast) hover:bg-surface-hover lg:items-center lg:gap-4 lg:px-5 ${COLS}`}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {live ? (
                        <Link
                          href={`/projeler/${item.id}`}
                          className={`min-w-0 truncate rounded-sm font-medium text-fg hover:underline ${focusRing}`}
                        >
                          {item.name}
                        </Link>
                      ) : (
                        <span className="min-w-0 truncate font-medium text-fg">{item.name}</span>
                      )}
                      <Badge
                        data-testid="project-status"
                        variant={PROJECT_STATUS_TONE[item.status]}
                        dot
                      >
                        {t.status[item.status]}
                      </Badge>
                      {(() => {
                        // T303: produced / completed, then saved again after the newest NC file.
                        const changed = changedAfterProduced(
                          item.status,
                          item.revision,
                          item.lastExport?.revision,
                        );
                        return changed ? (
                          <Badge
                            variant="warning"
                            data-testid="project-status-changed"
                            title={fill(t.changedTitle, changed)}
                          >
                            {t.changed}
                            <span className="sr-only">: {fill(t.changedTitle, changed)}</span>
                          </Badge>
                        ) : null;
                      })()}
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
                            // T350: "Alüminyum 5754" / "Kompozit panel"
                            material: materialHeadName(
                              materials,
                              materialHead,
                              item.material,
                              item.materialProps,
                            ),
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
                      {live ? (
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
                                {isOldRevision(item.lastExport.revision, item.revision) ? (
                                  <>
                                    <Badge
                                      variant="warning"
                                      data-testid="project-export-old"
                                      title={fill(t.oldRevisionTitle, {
                                        old: item.lastExport.revision,
                                        current: item.revision,
                                      })}
                                    >
                                      {t.oldRevision}
                                    </Badge>
                                    <Link
                                      href={`/projeler/${item.id}?adim=export`}
                                      data-testid="project-export-regenerate"
                                      className={`rounded-sm text-accent-text underline underline-offset-4 ${focusRing}`}
                                    >
                                      {t.regenerate}
                                    </Link>
                                  </>
                                ) : null}
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
                      ) : (
                        <div className="flex min-w-0 gap-1" data-testid="project-deleted-at">
                          <dt className="lg:sr-only">{t.columns.deletedAt}:</dt>
                          <dd className="numeric">
                            {item.deletedAt ? (
                              <time dateTime={item.deletedAt}>
                                {dateFormat.format(new Date(item.deletedAt))}
                              </time>
                            ) : null}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="flex shrink-0 items-center gap-1 lg:w-32 lg:justify-end">
                      {renderActions(item)}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {current.pages > 1 ? (
            <nav
              aria-label={t.page.label}
              data-testid="projects-pages"
              className="flex items-center justify-end gap-2"
            >
              <Tooltip content={t.page.prev}>
                <IconButton
                  size="sm"
                  aria-label={t.page.prev}
                  data-testid="projects-prev"
                  disabled={current.page <= 1}
                  onClick={() => setPage(current.page - 1)}
                >
                  <ChevronLeft aria-hidden />
                </IconButton>
              </Tooltip>
              <span className="numeric text-sm text-fg-muted" data-testid="projects-page">
                {fill(t.page.of, { page: current.page, pages: current.pages })}
              </span>
              <Tooltip content={t.page.next}>
                <IconButton
                  size="sm"
                  aria-label={t.page.next}
                  data-testid="projects-next"
                  disabled={current.page >= current.pages}
                  onClick={() => setPage(current.page + 1)}
                >
                  <ChevronRight aria-hidden />
                </IconButton>
              </Tooltip>
            </nav>
          ) : null}
        </section>
      )}
    </>
  );
}
