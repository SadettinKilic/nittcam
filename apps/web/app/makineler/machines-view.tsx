'use client';

import { defaultMachineProfile, type MachineProfile } from '@nittcam/core';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Measure,
  RouterIcon,
  Skeleton,
  notify,
} from '@nittcam/ui';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CircleCheck,
  Pencil,
  Plus,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MachineStateBadge } from '../../components/machines/state-badge';
import { PageHeader, focusRing, pageContainer } from '../../components/page/page-header';
import { Callout } from '../../components/wizard/panels';
import type { ParamFix } from '../../lib/machine-form';
import type { MachineDetail, MachineListItem } from '../../lib/machines-api';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import { MachineForm } from './machine-form';
import { MaintenanceDialog } from './maintenance-dialog';
import { MaintenanceBadge } from '../../components/machines/maintenance-badge';
import { localDay, maintenanceView } from '../../lib/maintenance';

type Text = Messages['machines'];

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: MachineListItem[] };

type Mode =
  | { kind: 'list' }
  | { kind: 'loading'; machineId: string }
  | { kind: 'loadError'; machineId: string }
  | {
      kind: 'form';
      machineId: string | null;
      version?: number;
      initial: MachineProfile;
      key: number;
      addParams?: ParamFix['set'];
    };

/** A new machine starts from the generic profile, not marked as an example, with no name. */
function newProfile(): MachineProfile {
  const p = defaultMachineProfile();
  p.example = false;
  p.identity.name = '';
  return p;
}

/** Table width × depth as a Measure (T195): Turkish digits, tabular, unit muted. */
function TableSize({ m, className }: { m: MachineListItem; className?: string }) {
  return <Measure value={[m.table.width, m.table.depth]} unit="mm" className={className} />;
}

export function MachinesView({
  t,
  startNew = false,
  fix = null,
}: {
  t: Text;
  startNew?: boolean;
  /** T258: open this machine with a new parameter set; after saving, offer the way back. */
  fix?: ParamFix | null;
}) {
  // T258: shown after the fix was saved: the link back to the project and step.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [mode, setMode] = useState<Mode>(() =>
    startNew ? { kind: 'form', machineId: null, initial: newProfile(), key: 0 } : { kind: 'list' },
  );
  const [formKey, setFormKey] = useState(0);

  const loadList = useCallback(async () => {
    setList({ status: 'loading' });
    try {
      const res = await fetch('/api/machines', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setList({ status: 'ready', items: (await res.json()) as MachineListItem[] });
    } catch {
      setList({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    // Initial fetch of the list; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadList();
  }, [loadList]);

  // Opening or closing the form starts at the top of the page.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [mode.kind]);

  async function openEdit(machineId: string, addParams: ParamFix['set'] = null) {
    setMode({ kind: 'loading', machineId });
    try {
      const res = await fetch(`/api/machines/${machineId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const detail = (await res.json()) as MachineDetail;
      setFormKey((k) => k + 1);
      setMode({
        kind: 'form',
        machineId,
        version: detail.version,
        initial: detail.profile,
        key: formKey + 1,
        addParams,
      });
    } catch {
      setMode({ kind: 'loadError', machineId });
    }
  }

  // T258: `?duzenle=` opens that machine straight away (once, on mount).
  const fixMachine = fix?.machineId ?? null;
  const fixSet = fix?.set ?? null;
  const [fixOpened, setFixOpened] = useState(false);
  useEffect(() => {
    if (fixMachine === null || fixOpened) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFixOpened(true);
    void openEdit(fixMachine, fixSet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixMachine, fixOpened]);

  function openNew() {
    setFormKey((k) => k + 1);
    setMode({ kind: 'form', machineId: null, initial: newProfile(), key: formKey + 1 });
  }

  function onSaved(detail: MachineDetail) {
    setMode({ kind: 'list' });
    notify.success(t.form.saved.replace('{version}', String(detail.version)));
    if (fix?.returnTo && detail.id === fix.machineId) setReturnTo(fix.returnTo);
    void loadList();
  }

  // T181: the machine whose maintenance dialog is open.
  const [maintenanceFor, setMaintenanceFor] = useState<MachineListItem | null>(null);

  // T289: which machine's archive request is running (buttons disabled meanwhile).
  const [archiving, setArchiving] = useState<string | null>(null);

  async function setArchived(m: MachineListItem, archived: boolean): Promise<boolean> {
    setArchiving(m.id);
    try {
      const res = await fetch(`/api/machines/${m.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setList((l) =>
        l.status === 'ready'
          ? { ...l, items: l.items.map((i) => (i.id === m.id ? { ...i, archived } : i)) }
          : l,
      );
      return true;
    } catch {
      notify.error(t.archive.failed);
      return false;
    } finally {
      setArchiving(null);
    }
  }

  /**
   * Archive (T289, soft delete like the T178 project delete): no confirm dialog; the machine moves
   * to "Arşivlenen makineler" and the toast offers "Geri al". The sample machine can be archived.
   */
  async function archive(m: MachineListItem) {
    if (!(await setArchived(m, true))) return;
    notify.success(fill(t.archive.archived, { name: m.name }), {
      id: `machine-archived-${m.id}`,
      duration: 8000,
      action: { label: t.archive.undo, onClick: () => void restore(m) },
    });
  }

  async function restore(m: MachineListItem) {
    if (await setArchived(m, false)) notify.success(fill(t.archive.restored, { name: m.name }));
  }

  return (
    <main className={`${pageContainer} gap-6`}>
      <PageHeader
        title={t.title}
        description={t.subtitle}
        actions={
          mode.kind === 'list' ? (
            <Button onClick={openNew}>
              <Plus aria-hidden />
              {t.add}
            </Button>
          ) : null
        }
      />

      {returnTo && mode.kind === 'list' ? (
        <Callout
          tone="success"
          role="status"
          icon={<CircleCheck aria-hidden />}
          data-testid="param-fix-saved"
          className="items-center"
        >
          <p className="min-w-0 flex-1">{t.paramFix.saved}</p>
          <Button asChild size="sm" variant="outline">
            <Link href={returnTo} data-testid="param-fix-return" className={focusRing}>
              <ArrowLeft aria-hidden />
              {t.paramFix.back}
            </Link>
          </Button>
        </Callout>
      ) : null}

      {mode.kind === 'form' ? (
        <MachineForm
          key={mode.key}
          t={t}
          machineId={mode.machineId}
          version={mode.version}
          initial={mode.initial}
          onSaved={onSaved}
          onCancel={() => setMode({ kind: 'list' })}
          addParams={mode.addParams}
        />
      ) : mode.kind === 'loading' ? (
        <div role="status" className="flex flex-col gap-4">
          <span className="sr-only">{t.form.loading}</span>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : mode.kind === 'loadError' ? (
        <ErrorState
          title={t.form.loadError}
          onRetry={() => void openEdit(mode.machineId)}
          retryLabel={t.retry}
          action={
            <Button variant="ghost" size="sm" onClick={() => setMode({ kind: 'list' })}>
              {t.form.cancel}
            </Button>
          }
        />
      ) : (
        <MachineList
          t={t}
          list={list}
          onRetry={() => void loadList()}
          onEdit={openEdit}
          busy={archiving}
          onArchive={(m) => void archive(m)}
          onRestore={(m) => void restore(m)}
          onMaintenance={(m) => setMaintenanceFor(m)}
        />
      )}
      {maintenanceFor ? (
        <MaintenanceDialog
          t={t.maintenance}
          machine={maintenanceFor}
          onClose={() => setMaintenanceFor(null)}
          onSaved={(latest) => {
            notify.success(t.maintenance.saved);
            setList((l) =>
              l.status === 'ready'
                ? {
                    ...l,
                    items: l.items.map((i) =>
                      i.id === maintenanceFor.id ? { ...i, maintenance: latest } : i,
                    ),
                  }
                : l,
            );
          }}
        />
      ) : null}
    </main>
  );
}

const features = tableFeatures({});
const column = createColumnHelper<typeof features, MachineListItem>();

interface ArchiveActions {
  /** Machine whose archive request is running. */
  busy: string | null;
  onArchive: (m: MachineListItem) => void;
  onRestore: (m: MachineListItem) => void;
}

/** Row context: archive (T289) plus the maintenance reminder and dialog (T181). */
type RowArchive = Pick<ArchiveActions, 'busy' | 'onArchive'> & {
  onMaintenance: (m: MachineListItem) => void;
  /** Local "today", `YYYY-MM-DD`. */
  today: string;
};

function MachineList({
  t,
  list,
  onRetry,
  onEdit,
  busy,
  onArchive,
  onRestore,
  onMaintenance,
}: {
  t: Text;
  list: ListState;
  onRetry: () => void;
  onEdit: (id: string) => void;
  onMaintenance: (m: MachineListItem) => void;
} & ArchiveActions) {
  const [today] = useState(localDay);
  if (list.status === 'loading') {
    return (
      <div role="status" className="flex flex-col gap-2" data-testid="machine-list-loading">
        <span className="sr-only">{t.loading}</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (list.status === 'error') {
    return <ErrorState title={t.loadError} onRetry={onRetry} retryLabel={t.retry} />;
  }
  const active = list.items.filter((m) => !m.archived);
  const archived = list.items.filter((m) => m.archived);
  const rowArchive: RowArchive = { busy, onArchive, onMaintenance, today };
  return (
    <div className="flex flex-col gap-6">
      {active.length === 0 ? (
        <EmptyState icon={<RouterIcon />} title={t.emptyTitle} description={t.empty} />
      ) : (
        <ActiveList t={t} items={active} onEdit={onEdit} archive={rowArchive} />
      )}
      {archived.length > 0 ? (
        <ArchivedList t={t} items={archived} busy={busy} onRestore={onRestore} />
      ) : null}
    </div>
  );
}

/** T289: archived machines, collapsed; "Geri yükle" brings one back after the toast is gone. */
function ArchivedList({
  t,
  items,
  busy,
  onRestore,
}: {
  t: Text;
  items: MachineListItem[];
  busy: string | null;
  onRestore: (m: MachineListItem) => void;
}) {
  return (
    <details data-testid="machine-archived">
      <summary
        className={`w-fit cursor-pointer rounded-md text-sm font-medium text-fg-muted hover:text-fg ${focusRing}`}
      >
        {fill(t.archive.section, { n: String(items.length) })}
      </summary>
      <Card className="mt-3 flex flex-col divide-y divide-border-subtle">
        <p className="px-4 py-3 text-xs text-fg-muted">{t.archive.hint}</p>
        <ul className="flex flex-col divide-y divide-border-subtle">
          {items.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg">{m.name}</span>
                  {m.example ? <Badge>{t.example}</Badge> : null}
                </span>
                <span className="truncate text-xs text-fg-muted">{m.controller}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid="machine-restore"
                aria-label={`${t.archive.restore}: ${m.name}`}
                disabled={busy !== null}
                loading={busy === m.id}
                onClick={() => onRestore(m)}
              >
                <ArchiveRestore aria-hidden />
                {t.archive.restore}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </details>
  );
}

function ActiveList({
  t,
  items,
  onEdit,
  archive,
}: {
  t: Text;
  items: MachineListItem[];
  onEdit: (id: string) => void;
  archive: RowArchive;
}) {
  return (
    <div data-testid="machine-list" className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t.count.replace('{n}', String(items.length))}</p>
      <MachineTable t={t} items={items} onEdit={onEdit} archive={archive} />
      <ul className="flex flex-col gap-3 lg:hidden">
        {items.map((m) => (
          <li key={m.id}>
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-fg">{m.name}</span>
                  <span className="truncate text-xs text-fg-muted">{m.controller}</span>
                </div>
                <span className="numeric shrink-0 text-xs text-fg-muted">v{m.version}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <MachineStateBadge state={m.state} label={t.state[m.state]} />
                {m.example ? <Badge>{t.example}</Badge> : null}
                <MaintenanceCell t={t} m={m} archive={archive} />
                <TableSize m={m} className="ml-auto text-xs text-fg" />
              </div>
              <RowActions
                t={t}
                m={m}
                onEdit={onEdit}
                archive={archive}
                className="border-t border-border-subtle pt-3"
              />
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RowActions({
  t,
  m,
  onEdit,
  archive,
  className,
}: {
  t: Text;
  m: MachineListItem;
  onEdit: (id: string) => void;
  archive: RowArchive;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-end gap-2 ${className ?? ''}`}>
      <Button asChild size="sm" variant="outline">
        <Link
          href={`/makineler/${m.id}/dogrulama`}
          aria-label={`${t.verify}: ${m.name}`}
          data-testid="machine-verify"
        >
          <ShieldCheck aria-hidden />
          {t.verify}
        </Link>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onEdit(m.id)}
        aria-label={`${t.edit}: ${m.name}`}
      >
        <Pencil aria-hidden />
        {t.edit}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-testid="machine-archive"
        onClick={() => archive.onArchive(m)}
        disabled={archive.busy !== null}
        loading={archive.busy === m.id}
        aria-label={`${t.archive.action}: ${m.name}`}
      >
        <Archive aria-hidden />
        {t.archive.action}
      </Button>
    </div>
  );
}

/** Wide screens: a data table (TanStack Table v9, D-032). Phones get the card list instead. */
function MachineTable({
  t,
  items,
  onEdit,
  archive,
}: {
  t: Text;
  items: MachineListItem[];
  onEdit: (id: string) => void;
  archive: RowArchive;
}) {
  const c = t.columns;
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor('name', {
          header: c.machine,
          cell: (info) => {
            const m = info.row.original;
            return (
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-subtle text-fg-muted [&_svg]:size-4"
                >
                  <RouterIcon />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg">{m.name}</span>
                    {m.example ? <Badge>{t.example}</Badge> : null}
                  </span>
                  <span className="truncate text-xs text-fg-muted">{m.controller}</span>
                </div>
              </div>
            );
          },
        }),
        column.accessor('table', {
          header: c.table,
          cell: (info) => <TableSize m={info.row.original} className="text-fg" />,
        }),
        column.accessor('version', {
          header: c.version,
          cell: (info) => <span className="numeric text-fg-muted">v{info.getValue()}</span>,
        }),
        column.accessor('state', {
          header: c.status,
          cell: (info) => (
            <MachineStateBadge
              state={info.getValue()}
              label={t.state[info.getValue()]}
              data-testid="machine-state"
            />
          ),
        }),
        column.accessor('maintenance', {
          header: t.maintenance.column,
          cell: (info) => <MaintenanceCell t={t} m={info.row.original} archive={archive} />,
        }),
        column.display({
          id: 'actions',
          header: () => <span className="sr-only">{c.actions}</span>,
          cell: (info) => (
            <RowActions t={t} m={info.row.original} onEdit={onEdit} archive={archive} />
          ),
        }),
      ]),
    [c, t, onEdit, archive],
  );
  const table = useTable({ features, columns, data: items, getRowId: (m) => m.id });
  return (
    <Card className="hidden overflow-hidden lg:block">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-subtle">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className="px-4 py-2.5 text-xs font-medium whitespace-nowrap text-fg-muted"
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="transition-colors duration-(--duration-fast) hover:bg-surface-hover"
            >
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 align-middle">
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * T181: maintenance state of a machine as a button that opens its "Bakım" dialog. Overdue / soon
 * show the reminder badge; otherwise the next due date or "Kayıt yok".
 */
function MaintenanceCell({ t, m, archive }: { t: Text; m: MachineListItem; archive: RowArchive }) {
  const view = maintenanceView(m.maintenance, archive.today, t.maintenance);
  return (
    <button
      type="button"
      data-testid="machine-maintenance"
      onClick={() => archive.onMaintenance(m)}
      aria-label={`${fill(t.maintenance.actionLabel, { name: m.name })}: ${view.label}${view.detail ? `, ${view.detail}` : ''}`}
      title={view.detail || undefined}
      className={`rounded-sm ${focusRing}`}
    >
      {view.remind ? (
        <MaintenanceBadge view={view} />
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline">
          <Wrench aria-hidden className="size-3" />
          {view.label}
        </span>
      )}
    </button>
  );
}
