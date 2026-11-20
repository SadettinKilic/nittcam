'use client';

import dynamic from 'next/dynamic';
import { libraryParamLinks, type LibraryMaterial, type MachineProfile } from '@nittcam/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Measure,
  SheetIcon,
  Skeleton,
  Tooltip,
  notify,
} from '@nittcam/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { MaterialSwatch } from '../../../components/materials/swatch';
import { PageHeader, pageContainer } from '../../../components/page/page-header';
import { fill } from '../../../lib/fill';
import { draftFrom, emptyDraft, type MaterialDraft } from '../../../lib/material-draft';
import type { MachineDetail, MachineListItem } from '../../../lib/machines-api';
import { fetchMaterials, type MaterialItem } from '../../../lib/materials-api';
import type { Messages } from '../../../lib/messages';

/** The material dialog and its schemas load when it opens (T186). */
const MaterialDialog = dynamic(() => import('./material-dialog').then((m) => m.MaterialDialog));

type Text = Messages['materialLibrary'];
type KindText = Messages['materials'];

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: MaterialItem[] };

interface Editing {
  id: string | null;
  draft: MaterialDraft;
  key: number;
}

const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** Machines with their latest profile, for the "linked parameter set" column. */
async function loadProfiles(): Promise<{ name: string; profile: MachineProfile }[]> {
  try {
    const res = await fetch('/api/machines', { cache: 'no-store' });
    if (!res.ok) return [];
    const list = (await res.json()) as MachineListItem[];
    const details = await Promise.all(
      // T289: archived machines are not used for new work, so their sets are not listed.
      list
        .filter((m) => !m.archived)
        .map(async (m) => {
          const r = await fetch(`/api/machines/${m.id}`, { cache: 'no-store' });
          return r.ok ? ((await r.json()) as MachineDetail) : null;
        }),
    );
    return details
      .filter((d): d is MachineDetail => d !== null)
      .map((d) => ({ name: d.profile.identity.name, profile: d.profile }));
  } catch {
    return [];
  }
}

export function MaterialsView({ t, kinds }: { t: Text; kinds: KindText }) {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [machines, setMachines] = useState<{ name: string; profile: MachineProfile }[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<MaterialItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState(0);

  const load = useCallback(async () => {
    setList({ status: 'loading' });
    const items = await fetchMaterials();
    setList(items ? { status: 'ready', items } : { status: 'error' });
  }, []);

  useEffect(() => {
    // Initial fetch; the state updates happen after the requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadProfiles().then(setMachines);
  }, [load]);

  function openNew() {
    setSeq((s) => s + 1);
    setEditing({ id: null, draft: emptyDraft(), key: seq + 1 });
  }

  function openEdit(m: MaterialItem) {
    setSeq((s) => s + 1);
    setEditing({ id: m.id, draft: draftFrom(m), key: seq + 1 });
  }

  async function save(material: LibraryMaterial) {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await fetch(editing.id ? `/api/materials/${editing.id}` : '/api/materials', {
        method: editing.id ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ material }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setEditing(null);
      notify.success(fill(t.saved, { name: material.name }));
      void load();
    } catch {
      notify.error(t.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: MaterialItem) {
    setRemoving(null);
    const res = await fetch(`/api/materials/${m.id}`, { method: 'DELETE' }).catch(() => null);
    if (res && (res.ok || res.status === 404)) {
      notify.success(fill(t.removed, { name: m.name }));
      void load();
    } else {
      notify.error(t.saveError);
    }
  }

  return (
    <main className={`${pageContainer} gap-6`}>
      <PageHeader
        title={t.title}
        description={t.subtitle}
        actions={
          <Button onClick={openNew} data-testid="material-add">
            <Plus aria-hidden />
            {t.add}
          </Button>
        }
      />

      {list.status === 'loading' ? (
        <div role="status" className="flex flex-col gap-2" data-testid="material-list-loading">
          <span className="sr-only">{t.loading}</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : list.status === 'error' ? (
        <ErrorState title={t.loadError} onRetry={() => void load()} retryLabel={t.retry} />
      ) : list.items.length === 0 ? (
        <EmptyState icon={<SheetIcon />} title={t.emptyTitle} description={t.empty} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="material-list" aria-label={t.title}>
          {list.items.map((m) => (
            <MaterialRow
              key={m.id}
              t={t}
              kinds={kinds}
              m={m}
              machines={machines}
              onEdit={() => openEdit(m)}
              onRemove={() => setRemoving(m)}
            />
          ))}
        </ul>
      )}

      {editing ? (
        <MaterialDialog
          key={editing.key}
          t={t}
          kinds={kinds}
          open
          title={editing.id ? t.form.editTitle : t.form.newTitle}
          initial={editing.draft}
          busy={busy}
          onSave={(m) => void save(m)}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      ) : null}

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {fill(t.removeTitle, { name: removing?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t.removeBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="material-remove-confirm"
              onClick={() => removing && void remove(removing)}
            >
              {t.removeConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function MaterialRow({
  t,
  kinds,
  m,
  machines,
  onEdit,
  onRemove,
}: {
  t: Text;
  kinds: KindText;
  m: MaterialItem;
  machines: { name: string; profile: MachineProfile }[];
  onEdit: () => void;
  onRemove: () => void;
}) {
  const c = t.columns;
  return (
    <li
      className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-2 rounded-xl border border-border bg-surface p-4 shadow-xs xl:grid-cols-[minmax(10rem,1.2fr)_minmax(6rem,0.7fr)_minmax(9rem,1fr)_minmax(4rem,0.4fr)_minmax(10rem,1.3fr)_auto] xl:items-center"
      data-testid="material-row"
      data-name={m.name}
    >
      <div className="flex min-w-0 items-center gap-3">
        <MaterialSwatch tone={m.tone} className="size-6 rounded-md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{m.name}</p>
          <p className="truncate text-xs text-fg-muted">
            {kinds[m.kind]} · {t.tones[m.tone]}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 xl:order-last">
        <Tooltip content={t.edit}>
          <IconButton
            variant="ghost"
            aria-label={fill(t.editNamed, { name: m.name })}
            onClick={onEdit}
            data-testid="material-edit"
          >
            <Pencil aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content={t.remove}>
          <IconButton
            variant="ghost"
            aria-label={fill(t.removeNamed, { name: m.name })}
            onClick={onRemove}
            data-testid="material-remove"
          >
            <Trash2 aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
      <dl className="col-span-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4 xl:col-span-4 xl:grid-cols-[minmax(6rem,0.7fr)_minmax(9rem,1fr)_minmax(4rem,0.4fr)_minmax(10rem,1.3fr)]">
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted xl:sr-only">{c.thicknesses}</dt>
          <dd className="numeric text-fg" data-testid="material-thicknesses">
            {m.thicknesses.map((v) => mmFormat.format(v)).join(' · ')} mm
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted xl:sr-only">{c.sheets}</dt>
          <dd className="flex flex-col">
            {m.sheetSizes.map((s) => (
              <span key={`${s.width}x${s.height}`} className="flex items-baseline gap-1.5">
                <Measure value={[s.width, s.height]} unit="mm" />
                {s.qty !== undefined ? (
                  <span className="numeric text-xs text-fg-muted" data-testid="material-sheet-qty">
                    {fill(t.sheetQty, { n: s.qty })}
                  </span>
                ) : null}
              </span>
            ))}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted xl:sr-only">{c.grain}</dt>
          <dd className="numeric text-fg">
            {m.grain === null
              ? t.grainNone
              : fill(t.grainValue, { angle: mmFormat.format(m.grain) })}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted xl:sr-only">{c.params}</dt>
          <dd className="flex flex-wrap gap-1" data-testid="material-params">
            {machines.length === 0 ? (
              <span className="text-fg-muted">{t.paramsNoMachine}</span>
            ) : (
              machines.map(({ name, profile }) => {
                const links = libraryParamLinks(m, profile);
                const missing = links
                  .filter((l) => !l.params)
                  .map((l) => mmFormat.format(l.thickness));
                // T265: unconfirmed starting values are never a green "Tamam".
                const unverified = links
                  .filter((l) => l.params?.unverified)
                  .map((l) => mmFormat.format(l.thickness));
                const status =
                  missing.length > 0 ? 'missing' : unverified.length > 0 ? 'unverified' : 'ok';
                const sentence =
                  status === 'ok'
                    ? fill(t.paramsOk, { machine: name })
                    : status === 'missing'
                      ? fill(t.paramsMissing, { machine: name, list: missing.join(', ') })
                      : fill(t.paramsUnverified, { machine: name, list: unverified.join(', ') });
                // T257: the status is short and always readable; only the name may shorten.
                return (
                  <Tooltip key={name} content={sentence}>
                    <Badge
                      tabIndex={0}
                      aria-label={sentence}
                      data-status={status}
                      variant={status === 'ok' ? 'success' : 'warning'}
                      className="max-w-full"
                    >
                      <span className="min-w-0 truncate">{name}</span>
                      <span aria-hidden className="shrink-0">
                        {' · '}
                        {status === 'ok'
                          ? t.statusOk
                          : status === 'missing'
                            ? t.statusMissing
                            : t.statusUnverified}
                      </span>
                    </Badge>
                  </Tooltip>
                );
              })
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}
