'use client';

import dynamic from 'next/dynamic';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  Tooltip,
  notify,
} from '@nittcam/ui';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import type { NewOffcut, OffcutItem, OffcutStatus } from '../../lib/offcuts-api';
import { materialLabel } from './projects-view';

/** The add/edit dialog and its material schemas load when it opens (T186). */
const OffcutDialog = dynamic(() => import('./offcut-dialog').then((m) => m.OffcutDialog));

type Text = Messages['projects']['offcuts'];
type Body = Omit<NewOffcut, 'sourceProjectId'>;

const TONE: Record<OffcutStatus, 'success' | 'warning' | 'neutral'> = {
  available: 'success',
  reserved: 'warning',
  used: 'neutral',
};

async function patchOffcut(id: string, body: unknown): Promise<OffcutItem> {
  const res = await fetch(`/api/offcuts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as OffcutItem;
}

/**
 * "Artık parçalar" tab under Projeler (T168, spec §3.4): the company offcut stock. T291: add an
 * offcut by hand, correct one, delete one ("Geri al" restores it with the same id).
 */
export function OffcutStock({ t, materials }: { t: Text; materials: Messages['materials'] }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ok'; items: OffcutItem[] }
  >({ status: 'loading' });
  // null = closed; 'new' = add; an item = edit it.
  const [dialog, setDialog] = useState<'new' | OffcutItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch('/api/offcuts');
      if (!res.ok) throw new Error(String(res.status));
      setState({ status: 'ok', items: (await res.json()) as OffcutItem[] });
    } catch {
      setState({ status: 'error' });
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads once on mount
    void load();
  }, [load]);

  const sizeOf = (o: { width: number; height: number }) =>
    fill(t.size, { w: o.width, h: o.height });

  function replace(next: OffcutItem) {
    setState((s) =>
      s.status === 'ok'
        ? { status: 'ok', items: s.items.map((i) => (i.id === next.id ? next : i)) }
        : s,
    );
  }

  async function setStatus(item: OffcutItem, status: OffcutStatus) {
    try {
      replace(await patchOffcut(item.id, { status }));
    } catch {
      notify.error(t.statusFailed);
    }
  }

  /** Add (POST) or edit (PATCH with the changed fields); false keeps the dialog open. */
  async function submit(body: Body | Partial<Body>): Promise<boolean> {
    const editing = dialog !== 'new' ? dialog : null;
    try {
      if (editing) {
        const next = await patchOffcut(editing.id, body);
        replace(next);
        notify.success(fill(t.toast.saved, { size: sizeOf(next) }));
      } else {
        const res = await fetch('/api/offcuts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ offcuts: [body] }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const [created] = (await res.json()) as OffcutItem[];
        if (!created) throw new Error('empty');
        setState((s) => (s.status === 'ok' ? { status: 'ok', items: [created, ...s.items] } : s));
        notify.success(fill(t.toast.added, { size: sizeOf(created) }));
      }
      setDialog(null);
      return true;
    } catch {
      return false;
    }
  }

  async function remove(item: OffcutItem) {
    setBusy(item.id);
    try {
      await patchOffcut(item.id, { deleted: true });
      setState((s) =>
        s.status === 'ok' ? { status: 'ok', items: s.items.filter((i) => i.id !== item.id) } : s,
      );
      notify.success(fill(t.toast.deleted, { size: sizeOf(item) }), {
        id: `offcut-deleted-${item.id}`,
        duration: 8000,
        action: { label: t.undo, onClick: () => void restore(item) },
      });
    } catch {
      notify.error(t.toast.failed);
    } finally {
      setBusy(null);
    }
  }

  async function restore(item: OffcutItem) {
    try {
      await patchOffcut(item.id, { deleted: false });
      await load();
      notify.success(fill(t.toast.restored, { size: sizeOf(item) }));
    } catch {
      notify.error(t.toast.failed);
    }
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-fg-muted" data-testid="offcuts-count">
        {state.status === 'ok' && state.items.length > 0
          ? fill(t.count, { count: state.items.length })
          : null}
      </p>
      <Button
        size="sm"
        variant="outline"
        data-testid="offcut-add"
        disabled={state.status !== 'ok'}
        onClick={() => setDialog('new')}
      >
        <Plus aria-hidden />
        {t.add}
      </Button>
    </div>
  );

  let body: React.ReactNode;
  if (state.status === 'loading') {
    body = (
      <div role="status" data-testid="offcuts-loading" className="flex flex-col gap-2">
        <span className="sr-only">{t.loading}</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  } else if (state.status === 'error') {
    body = (
      <ErrorState
        data-testid="offcuts-error"
        title={t.error}
        retryLabel={t.retry}
        onRetry={() => void load()}
      />
    );
  } else if (state.items.length === 0) {
    body = (
      <EmptyState
        data-testid="offcuts-empty"
        icon={<Layers />}
        title={t.empty}
        description={t.emptyText}
      />
    );
  } else {
    body = (
      <Card className="overflow-hidden p-0">
        <ul className="flex flex-col divide-y divide-border-subtle">
          {state.items.map((o) => {
            const material = fill(t.material, {
              material: materialLabel(materials, o.material),
              thickness: o.thickness,
            });
            const label = (action: string) =>
              fill(t.rowAction, { action, size: sizeOf(o), material });
            return (
              <li
                key={o.id}
                data-testid="offcut-row"
                data-status={o.status}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm"
              >
                <span className="min-w-28 font-mono font-medium text-fg tabular-nums">
                  {sizeOf(o)}
                </span>
                <span className="min-w-36 text-fg-muted">{material}</span>
                <span className="text-fg-muted">
                  {t.columns.grain}: {o.grain === null ? t.grain.none : `${o.grain}°`}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  {t.columns.source}:{' '}
                  {o.sourceProjectId ? (
                    <a
                      className="underline"
                      href={`/projeler/${o.sourceProjectId}`}
                      data-testid="offcut-source"
                    >
                      {o.sourceProjectName ?? t.openSource}
                    </a>
                  ) : (
                    t.noSource
                  )}
                </span>
                <Badge variant={TONE[o.status]}>{t.status[o.status]}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void setStatus(o, o.status === 'used' ? 'available' : 'used')}
                  data-testid="offcut-toggle-used"
                >
                  {o.status === 'used' ? t.markAvailable : t.markUsed}
                </Button>
                <div className="flex items-center gap-1">
                  <Tooltip content={t.edit}>
                    <IconButton
                      size="sm"
                      data-testid="offcut-edit"
                      aria-label={label(t.edit)}
                      disabled={busy !== null}
                      onClick={() => setDialog(o)}
                    >
                      <Pencil aria-hidden />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content={t.delete}>
                    <IconButton
                      size="sm"
                      data-testid="offcut-delete"
                      aria-label={label(t.delete)}
                      disabled={busy !== null}
                      loading={busy === o.id}
                      onClick={() => void remove(o)}
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </Tooltip>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  }

  return (
    <section aria-label={t.label} className="flex min-w-0 flex-col gap-3">
      {header}
      {body}
      {dialog ? (
        <OffcutDialog
          key={dialog === 'new' ? 'new' : dialog.id}
          t={t}
          materials={materials}
          item={dialog === 'new' ? null : dialog}
          onClose={() => setDialog(null)}
          onSubmit={submit}
        />
      ) : null}
    </section>
  );
}
