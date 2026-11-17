'use client';

import { defaultMachineProfile, type MachineProfile, type VerificationState } from '@nittcam/core';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
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
  | { kind: 'form'; machineId: string | null; initial: MachineProfile; key: number };

const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

const STATE_STYLE: Record<VerificationState, string> = {
  draft: 'bg-info-bg text-info',
  air_cut_approved: 'bg-warn-bg text-warn',
  test_cut_approved: 'bg-warn-bg text-warn',
  verified: 'bg-ok-bg text-ok',
  reverify_needed: 'bg-danger-bg text-danger',
};

const buttonClass =
  'rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** A new machine starts from the generic profile, not marked as an example, with no name. */
function newProfile(): MachineProfile {
  const p = defaultMachineProfile();
  p.example = false;
  p.identity.name = '';
  return p;
}

export function MachinesView({ t }: { t: Text }) {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [notice, setNotice] = useState<string | null>(null);
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

  async function openEdit(machineId: string) {
    setNotice(null);
    setMode({ kind: 'loading', machineId });
    try {
      const res = await fetch(`/api/machines/${machineId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const detail = (await res.json()) as MachineDetail;
      setFormKey((k) => k + 1);
      setMode({ kind: 'form', machineId, initial: detail.profile, key: formKey + 1 });
    } catch {
      setMode({ kind: 'loadError', machineId });
    }
  }

  function openNew() {
    setNotice(null);
    setFormKey((k) => k + 1);
    setMode({ kind: 'form', machineId: null, initial: newProfile(), key: formKey + 1 });
  }

  function onSaved(detail: MachineDetail) {
    setMode({ kind: 'list' });
    setNotice(t.form.saved.replace('{version}', String(detail.version)));
    void loadList();
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-fg-muted">{t.subtitle}</p>
        </div>
        {mode.kind === 'list' ? (
          <button
            type="button"
            onClick={openNew}
            className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
          >
            {t.add}
          </button>
        ) : null}
      </header>

      <div aria-live="polite">
        {notice ? (
          <p role="status" className="rounded-lg bg-ok-bg p-3 text-sm text-ok">
            {notice}
          </p>
        ) : null}
      </div>

      {mode.kind === 'form' ? (
        <MachineForm
          key={mode.key}
          t={t}
          machineId={mode.machineId}
          initial={mode.initial}
          onSaved={onSaved}
          onCancel={() => setMode({ kind: 'list' })}
        />
      ) : mode.kind === 'loading' ? (
        <p role="status" className="text-fg-muted">
          {t.form.loading}
        </p>
      ) : mode.kind === 'loadError' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-bg p-3">
          <span className="text-sm text-danger">{t.form.loadError}</span>
          <button
            type="button"
            onClick={() => void openEdit(mode.machineId)}
            className={`${buttonClass} border border-border bg-bg`}
          >
            {t.retry}
          </button>
          <button
            type="button"
            onClick={() => setMode({ kind: 'list' })}
            className={`${buttonClass} border border-border bg-bg`}
          >
            {t.form.cancel}
          </button>
        </div>
      ) : (
        <MachineList t={t} list={list} onRetry={() => void loadList()} onEdit={openEdit} />
      )}
    </main>
  );
}

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
      <p role="status" className="text-fg-muted">
        {t.loading}
      </p>
    );
  }
  if (list.status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-bg p-3">
        <span className="text-sm text-danger">{t.loadError}</span>
        <button
          type="button"
          onClick={onRetry}
          className={`${buttonClass} border border-border bg-bg`}
        >
          {t.retry}
        </button>
      </div>
    );
  }
  if (list.items.length === 0) {
    return <p className="rounded-card bg-sidebar p-6 text-fg-muted">{t.empty}</p>;
  }
  const c = t.columns;
  return (
    <div className="relative max-w-full overflow-x-auto rounded-card border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-sidebar text-fg-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {c.name}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {c.controller}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {c.table}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {c.version}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {c.status}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              <span className="sr-only">{c.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.items.map((m) => (
            <tr key={m.id} className="border-t border-border">
              <td className="px-4 py-3 font-medium">
                {m.name}
                {m.example ? (
                  <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-xs text-warn">
                    {t.example}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3">{m.controller}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {mmFormat.format(m.table.width)} × {mmFormat.format(m.table.depth)} mm
              </td>
              <td className="px-4 py-3">v{m.version}</td>
              <td className="px-4 py-3">
                <span
                  data-testid="machine-state"
                  className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${STATE_STYLE[m.state]}`}
                >
                  {t.state[m.state]}
                </span>
              </td>
              <td className="flex justify-end gap-2 px-4 py-3 text-right">
                <Link
                  href={`/makineler/${m.id}/dogrulama`}
                  aria-label={`${t.verify}: ${m.name}`}
                  data-testid="machine-verify"
                  className={`${buttonClass} border border-border bg-bg whitespace-nowrap hover:bg-sidebar`}
                >
                  {t.verify}
                </Link>
                <button
                  type="button"
                  onClick={() => onEdit(m.id)}
                  aria-label={`${t.edit}: ${m.name}`}
                  className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
                >
                  {t.edit}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
