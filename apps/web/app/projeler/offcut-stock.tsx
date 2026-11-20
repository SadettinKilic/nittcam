'use client';

import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, notify } from '@nittcam/ui';
import { Layers } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import type { OffcutItem, OffcutStatus } from '../../lib/offcuts-api';
import { materialLabel } from './projects-view';

type Text = Messages['projects']['offcuts'];

const TONE: Record<OffcutStatus, 'success' | 'warning' | 'neutral'> = {
  available: 'success',
  reserved: 'warning',
  used: 'neutral',
};

/** "Artık parçalar" tab under Projeler (T168, spec §3.4): the company offcut stock. */
export function OffcutStock({ t, materials }: { t: Text; materials: Messages['materials'] }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ok'; items: OffcutItem[] }
  >({ status: 'loading' });

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

  async function setStatus(item: OffcutItem, status: OffcutStatus) {
    try {
      const res = await fetch(`/api/offcuts/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as OffcutItem;
      setState((s) =>
        s.status === 'ok'
          ? { status: 'ok', items: s.items.map((i) => (i.id === next.id ? next : i)) }
          : s,
      );
    } catch {
      notify.error(t.statusFailed);
    }
  }

  if (state.status === 'loading') {
    return (
      <div role="status" data-testid="offcuts-loading" className="flex flex-col gap-2">
        <span className="sr-only">{t.loading}</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        data-testid="offcuts-error"
        title={t.error}
        retryLabel={t.retry}
        onRetry={() => void load()}
      />
    );
  }
  if (state.items.length === 0) {
    return (
      <EmptyState
        data-testid="offcuts-empty"
        icon={<Layers />}
        title={t.empty}
        description={t.emptyText}
      />
    );
  }
  return (
    <section aria-label={t.label} className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-fg-muted" data-testid="offcuts-count">
        {fill(t.count, { count: state.items.length })}
      </p>
      <Card className="overflow-hidden p-0">
        <ul className="flex flex-col divide-y divide-border-subtle">
          {state.items.map((o) => (
            <li
              key={o.id}
              data-testid="offcut-row"
              data-status={o.status}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm"
            >
              <span className="min-w-28 font-mono font-medium text-fg tabular-nums">
                {fill(t.size, { w: o.width, h: o.height })}
              </span>
              <span className="min-w-36 text-fg-muted">
                {fill(t.material, {
                  material: materialLabel(materials, o.material),
                  thickness: o.thickness,
                })}
              </span>
              <span className="text-fg-muted">
                {t.columns.grain}: {o.grain === null ? t.grain.none : `${o.grain}°`}
              </span>
              <span className="min-w-0 flex-1 truncate text-fg-muted">
                {t.columns.source}:{' '}
                {o.sourceProjectId ? (
                  <a className="underline" href={`/projeler/${o.sourceProjectId}`}>
                    {t.openSource}
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
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
