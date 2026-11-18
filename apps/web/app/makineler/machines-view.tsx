'use client';

import { defaultMachineProfile, type MachineProfile } from '@nittcam/core';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  RouterIcon,
  Skeleton,
  notify,
} from '@nittcam/ui';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { Pencil, Plus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MachineStateBadge } from '../../components/machines/state-badge';
import { PageHeader, pageContainer } from '../../components/page/page-header';
import type { MachineDetail, MachineListItem } from '../../lib/machines-api';
import type { Messages } from '../../lib/messages';
import { MachineForm } from './machine-form';

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
    };

const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** A new machine starts from the generic profile, not marked as an example, with no name. */
function newProfile(): MachineProfile {
  const p = defaultMachineProfile();
  p.example = false;
  p.identity.name = '';
  return p;
}

function tableSize(m: MachineListItem): string {
  return `${mmFormat.format(m.table.width)} × ${mmFormat.format(m.table.depth)} mm`;
}

export function MachinesView({ t, startNew = false }: { t: Text; startNew?: boolean }) {
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

  async function openEdit(machineId: string) {
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
      });
    } catch {
      setMode({ kind: 'loadError', machineId });
    }
  }

  function openNew() {
    setFormKey((k) => k + 1);
    setMode({ kind: 'form', machineId: null, initial: newProfile(), key: formKey + 1 });
  }

  function onSaved(detail: MachineDetail) {
    setMode({ kind: 'list' });
    notify.success(t.form.saved.replace('{version}', String(detail.version)));
    void loadList();
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

      {mode.kind === 'form' ? (
        <MachineForm
          key={mode.key}
          t={t}
          machineId={mode.machineId}
          version={mode.version}
          initial={mode.initial}
          onSaved={onSaved}
          onCancel={() => setMode({ kind: 'list' })}
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
        <MachineList t={t} list={list} onRetry={() => void loadList()} onEdit={openEdit} />
      )}
    </main>
  );
}

const features = tableFeatures({});
const column = createColumnHelper<typeof features, MachineListItem>();

function MachineList({
  t,
  list,
  onRetry,
  onEdit,
}: {
  t: Text;
  list: ListState;
  onRetry: () => void;
  onEdit: (id: string) => void;
}) {
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
  if (list.items.length === 0) {
    return <EmptyState icon={<RouterIcon />} title={t.emptyTitle} description={t.empty} />;
  }
  return (
    <div data-testid="machine-list" className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t.count.replace('{n}', String(list.items.length))}</p>
      <MachineTable t={t} items={list.items} onEdit={onEdit} />
      <ul className="flex flex-col gap-3 lg:hidden">
        {list.items.map((m) => (
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
                <span className="numeric ml-auto text-xs text-fg-muted">{tableSize(m)}</span>
              </div>
              <RowActions
                t={t}
                m={m}
                onEdit={onEdit}
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
  className,
}: {
  t: Text;
  m: MachineListItem;
  onEdit: (id: string) => void;
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
    </div>
  );
}

/** Wide screens: a data table (TanStack Table v9, D-032). Phones get the card list instead. */
function MachineTable({
  t,
  items,
  onEdit,
}: {
  t: Text;
  items: MachineListItem[];
  onEdit: (id: string) => void;
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
          cell: (info) => (
            <span className="numeric whitespace-nowrap text-fg-muted">
              {tableSize(info.row.original)}
            </span>
          ),
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
        column.display({
          id: 'actions',
          header: () => <span className="sr-only">{c.actions}</span>,
          cell: (info) => <RowActions t={t} m={info.row.original} onEdit={onEdit} />,
        }),
      ]),
    [c, t, onEdit],
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
