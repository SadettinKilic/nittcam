'use client';

import { summarizeLayout, type Project } from '@nittcam/core';
import { fill } from '../../../../lib/draft-project';
import type { Messages } from '../../../../lib/messages';
import { buttonClass } from './ui';

type Text = Messages['cutList']['nesting'];

const percent = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/**
 * Minimal nesting panel (T012): the "Diz" button and the result of the current layout (sheet
 * count, waste %). The figures are derived from the project, so undo/redo update them too. The
 * visual layout view comes with T013.
 */
export function NestingPanel({
  t,
  project,
  toolDiameter,
  running,
  message,
  onRun,
}: {
  t: Text;
  project: Project;
  toolDiameter: number;
  running: boolean;
  message: { kind: 'error' | 'info'; text: string } | null;
  onRun: () => void;
}) {
  const summary = summarizeLayout(project);
  const pct = (v: number) => fill(t.percent, { value: percent.format(v) });
  return (
    <section
      aria-labelledby="nesting-title"
      className="flex flex-col gap-3 rounded-card border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="nesting-title" className="text-xl font-semibold">
            {t.title}
          </h2>
          <p className="text-sm text-fg-muted">
            {fill(t.help, {
              gap: percent.format(project.nesting.gap),
              margin: percent.format(project.nesting.margin),
              tool: percent.format(toolDiameter),
            })}
          </p>
          <p className="text-xs text-fg-muted">{t.toolNote}</p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running || project.parts.length === 0}
          aria-busy={running}
          className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
        >
          {running ? t.running : t.run}
        </button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        {message ? (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={`rounded-lg p-3 text-sm ${message.kind === 'error' ? 'bg-danger-bg text-danger' : 'bg-sidebar text-fg'}`}
          >
            {message.text}
          </p>
        ) : null}
        {summary.sheetCount === 0 ? (
          <p className="text-sm text-fg-muted">{t.none}</p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2" data-testid="nesting-summary">
              <div className="rounded-lg bg-sidebar p-3">
                <dt className="text-xs text-fg-muted">{t.sheets}</dt>
                <dd className="text-2xl font-semibold tabular-nums" data-testid="nesting-sheets">
                  {summary.sheetCount}
                </dd>
              </div>
              <div className="rounded-lg bg-sidebar p-3">
                <dt className="text-xs text-fg-muted">{t.waste}</dt>
                <dd className="text-2xl font-semibold tabular-nums" data-testid="nesting-waste">
                  {pct(summary.wastePercent)}
                </dd>
              </div>
              <div className="rounded-lg bg-sidebar p-3">
                <dt className="text-xs text-fg-muted">{t.utilisation}</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {pct(summary.utilisationPercent)}
                </dd>
              </div>
            </dl>
            <ul className="flex flex-col gap-0.5 text-sm text-fg-muted">
              {summary.sheets.map((s) => (
                <li key={s.index}>
                  {fill(t.sheetLine, {
                    n: s.index + 1,
                    count: s.placed,
                    waste: percent.format(s.wastePercent),
                  })}
                </li>
              ))}
            </ul>
          </>
        )}
        {summary.sheetCount > 0 && summary.unplaced.length > 0 ? (
          <p className="text-sm font-medium text-warn" data-testid="nesting-unplaced">
            {fill(t.unplaced, { count: summary.unplaced.length })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
