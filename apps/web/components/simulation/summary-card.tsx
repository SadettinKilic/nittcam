'use client';

import type { SimSummary } from '@nittcam/core';
import { fill } from '../../lib/draft-project';
import { Measure } from '@nittcam/ui';
import type { ReactNode } from 'react';
import { formatDuration, formatInt, type SimText } from './model';
import { WarningList, type Finding } from './violations';

/** Summary card (§6.5): estimated time, lengths, tool changes, passes, tabs, check status. */
export function SummaryCard({
  t,
  summary,
  checksOk,
  errorCount,
  warnings,
}: {
  t: SimText;
  summary: SimSummary;
  checksOk: boolean;
  errorCount: number;
  warnings: readonly Finding[];
}) {
  const s = t.summary;
  // Measure (T195): Turkish digits, tabular figures, the unit quieter than the number.
  const meters = (mm: number) => <Measure value={mm / 1000} unit={t.meterUnit} maxDecimals={1} />;
  const count = (n: number) => <Measure value={n} maxDecimals={0} />;
  const tiles: [string, string, ReactNode][] = [
    [
      'time',
      s.time,
      <span key="t" className="numeric">
        {fill(t.time.approx, { time: formatDuration(t, summary.seconds) })}
      </span>,
    ],
    ['cut', s.cutLength, meters(summary.cutLength)],
    ['rapid', s.rapidLength, meters(summary.rapidLength)],
    ['tools', s.toolChanges, count(summary.toolChanges)],
    ['passes', s.passes, count(summary.passes)],
    ['tabs', s.tabs, count(summary.tabs)],
  ];
  return (
    <section
      aria-labelledby="sim-summary-title"
      data-testid="sim-summary"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sim-summary-title" className="text-base font-semibold tracking-tight text-fg">
          {s.title}
        </h2>
        <p
          data-testid="sim-check-status"
          data-ok={checksOk}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${checksOk ? 'border-success-border bg-success-subtle text-success-text' : 'border-danger-border bg-danger-subtle text-danger-text'}`}
        >
          <span aria-hidden="true">{checksOk ? '✓' : '✕'}</span>
          {checksOk ? s.checksOk : fill(s.checksFail, { count: errorCount })}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([key, label, value]) => (
          <div
            key={key}
            className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2.5"
          >
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd
              className="mt-0.5 text-lg font-semibold tracking-tight text-fg"
              data-testid={`sim-summary-${key}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-fg-muted">
        {fill(s.timeNote, { rapid: formatInt(summary.rapidFeed) })}
      </p>
      <p className="text-xs text-fg-muted">
        {fill(s.files, {
          files: summary.files,
          sheets: summary.sheets,
          moves: formatInt(summary.moves),
        })}{' '}
        · {s.noDownloadHere}
      </p>
      {warnings.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer rounded-sm font-medium text-warning-text">
            {fill(s.warnings, { count: warnings.length })}
          </summary>
          <div className="mt-2">
            <WarningList t={t} items={warnings} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
