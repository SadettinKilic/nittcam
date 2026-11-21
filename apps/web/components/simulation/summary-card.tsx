'use client';

import type { ProgramTools, SimSummary } from '@nittcam/core';
import { focusCuttingSettings } from './cutting-settings';
import { fill } from '../../lib/fill';
import { Measure } from '@nittcam/ui';
import { SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDuration, formatInt, type SimText } from './model';
import { ErrorList, WarningList, type Finding, type PartLinks } from './violations';

/** Summary card (§6.5): estimated time, lengths, tool changes, passes, tabs, check status. */
export function SummaryCard({
  t,
  summary,
  checksOk,
  errorCount,
  warnings,
  errors = [],
  links = {},
  program = null,
  templateNames = [],
  cutting = null,
  stale = false,
}: {
  t: SimText;
  summary: SimSummary;
  /** Tools in order of use and manual changes (T274). */
  program?: ProgramTools | null;
  /** Unverified ready templates in the project (T282): one yellow line, like the Z re-zero line. */
  templateNames?: readonly string[];
  checksOk: boolean;
  errorCount: number;
  warnings: readonly Finding[];
  /** T287: errors that lock the export although the program ran (shown open, with places). */
  errors?: readonly Finding[];
  links?: PartLinks;
  /** T294: one line with the cutting settings and a way to the panel ("Kesim ayarları"). */
  cutting?: { line: string; edit: string } | null;
  /** T307: the shown run is for the previous project state; the new one is on its way. */
  stale?: boolean;
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
      aria-busy={stale || undefined}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sim-summary-title" className="text-base font-semibold tracking-tight text-fg">
          {s.title}
        </h2>
        <p
          data-testid="sim-check-status"
          data-ok={stale ? 'pending' : checksOk}
          className={`inline-flex transition-opacity duration-(--duration-fast) ${stale ? 'opacity-60' : ''} items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${checksOk ? 'border-success-border bg-success-subtle text-success-text' : 'border-danger-border bg-danger-subtle text-danger-text'}`}
        >
          <span aria-hidden="true">{checksOk ? '✓' : '✕'}</span>
          {checksOk ? s.checksOk : fill(s.checksFail, { count: errorCount })}
        </p>
      </div>
      {errors.length > 0 ? (
        <div data-testid="sim-errors" className="flex flex-col gap-2">
          <p className="text-sm text-danger-text">{s.errorsNote}</p>
          <ErrorList t={t} items={errors} links={links} />
        </div>
      ) : null}
      {/* T245: one compact definition list (label | value), not six tiles. Each row sizes on its own
          so a long label next to a short value stays whole; labels wrap, never truncate (r1). */}
      <dl className="flex flex-col gap-y-0.5 text-sm" data-testid="sim-summary-list">
        {tiles.map(([key, label, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-x-3">
            <dt className="min-w-0 text-pretty break-words text-fg-muted">{label}</dt>
            <dd
              className="shrink-0 text-right font-semibold whitespace-nowrap text-fg tabular-nums"
              data-testid={`sim-summary-${key}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {cutting ? (
        // T294 (CTO #11 E1): one line; the full text is the tooltip when it does not fit.
        <p
          className="flex min-w-0 items-center gap-1.5 text-sm text-fg"
          data-testid="sim-summary-cutting"
          title={cutting.line}
        >
          <span className="min-w-0 truncate">{cutting.line}</span>
          <button
            type="button"
            data-testid="sim-summary-cutting-edit"
            aria-label={cutting.edit}
            title={cutting.edit}
            onClick={focusCuttingSettings}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-accent-text outline-none hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <SlidersHorizontal aria-hidden className="size-3.5" />
          </button>
        </p>
      ) : null}
      {program && program.sheets.some((sh) => sh.tools.length > 1) ? (
        <p className="text-sm text-fg" data-testid="sim-tool-order">
          {fill(s.toolOrder, {
            tools: program.sheets
              .reduce((a, b) => (b.tools.length > a.tools.length ? b : a))
              .tools.map((tool) => `T${tool.number} Ø${tool.diameter} mm`)
              .join(' → '),
          })}
        </p>
      ) : null}
      {program && program.manualChanges > 0 ? (
        <p
          className="flex items-start gap-1.5 text-sm font-medium text-warning-text"
          data-testid="sim-manual-change"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {fill(program.rezeroZ ? s.manualChangeZ : s.manualChange, {
            count: program.manualChanges,
          })}
        </p>
      ) : null}
      {templateNames.length > 0 ? (
        <p
          className="flex items-start gap-1.5 text-sm font-medium text-warning-text"
          data-testid="sim-unverified-templates"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {fill(s.unverifiedTemplates, { names: templateNames.join(', ') })}
        </p>
      ) : null}
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
            <WarningList t={t} items={warnings} links={links} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
