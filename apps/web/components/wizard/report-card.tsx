'use client';

import { useEffect, useState } from 'react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import { summaryTiles, type ReportSummary } from '../../lib/report-summary';

type Text = Messages['wizard']['report'];

/**
 * Project report card (T177, spec §6.6): waste %, waste and part area, sheets, pieces and the
 * estimated cut time of the saved revision, from the server (the same values as the PDF report).
 */
export function ReportCard({
  t,
  projectId,
  revision,
  hasLayout,
  saved,
}: {
  t: Text;
  projectId: string | null;
  revision: number;
  hasLayout: boolean;
  saved: boolean;
}) {
  const ready = projectId !== null && hasLayout && saved;
  const key = ready ? `${projectId}@${revision}` : '';
  const [state, setState] = useState<{ key: string; data: ReportSummary | null } | null>(null);
  useEffect(() => {
    if (!ready || projectId === null) return;
    let live = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/report?revision=${revision}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        if (live) setState({ key, data: res.ok ? ((await res.json()) as ReportSummary) : null });
      })
      .catch(() => {
        if (live) setState({ key, data: null });
      });
    return () => {
      live = false;
    };
  }, [ready, projectId, revision, key]);
  const current = state?.key === key ? state : null;

  let body: React.ReactNode;
  if (!hasLayout) body = <p className="text-xs text-fg-muted">{t.noLayout}</p>;
  else if (!ready) body = <p className="text-xs text-fg-muted">{t.waitSave}</p>;
  else if (!current) {
    body = (
      <p role="status" className="text-xs text-fg-muted">
        {t.loading}
      </p>
    );
  } else if (!current.data) {
    body = <p className="text-xs text-danger-text">{t.error}</p>;
  } else {
    const data = current.data;
    body = (
      <>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="report-tiles">
          {summaryTiles(data).map((tile) => (
            <div
              key={tile.key}
              data-testid={`report-${tile.key}`}
              className="min-w-0 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2"
            >
              <dt className="truncate text-xs text-fg-muted">{tile.label}</dt>
              <dd className="numeric truncate text-base font-semibold text-fg">{tile.value}</dd>
            </div>
          ))}
        </dl>
        {data.unplaced > 0 ? (
          <p className="text-xs text-warning-text" data-testid="report-unplaced">
            {fill(t.unplaced, { count: data.unplaced })}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section
      aria-labelledby="report-card-title"
      data-testid="report-card"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id="report-card-title" className="text-sm font-semibold tracking-tight text-fg">
          {t.title}
        </h2>
        <p className="text-xs text-fg-subtle">{t.hint}</p>
      </div>
      {body}
    </section>
  );
}
