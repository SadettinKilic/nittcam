'use client';

import { summarizeLayout, type Project } from '@nittcam/core';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger } from '@nittcam/ui';
import { Info, LayoutGrid, TriangleAlert } from 'lucide-react';

type Text = Messages['cutList']['nesting'];

const percent = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/**
 * Minimal nesting panel (T012): the "Diz" button and the result of the current layout (sheet
 * count, waste %). The figures are derived from the project, so undo/redo update them too. The
 * visual layout view (T013) is rendered below this panel.
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
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-xs"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="nesting-title" className="text-sm font-semibold tracking-tight text-fg">
            {t.title}
          </h2>
          <Popover>
            <PopoverTrigger asChild>
              <IconButton size="sm" variant="ghost" aria-label={t.about}>
                <Info aria-hidden />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-72 flex-col gap-2 text-sm">
              <p className="text-fg">
                {fill(t.help, {
                  gap: percent.format(project.nesting.gap),
                  margin: percent.format(project.nesting.margin),
                  tool: percent.format(toolDiameter),
                })}
              </p>
              <p className="text-xs text-fg-muted">{t.toolNote}</p>
            </PopoverContent>
          </Popover>
        </div>
        {/* T244 (D-039): values as one line of chips; the explanation sits in the popover. */}
        <ul className="flex flex-wrap gap-1.5" data-testid="nesting-chips">
          {[
            fill(t.gapChip, { value: percent.format(project.nesting.gap) }),
            fill(t.marginChip, { value: percent.format(project.nesting.margin) }),
            fill(t.toolChip, { value: percent.format(toolDiameter) }),
          ].map((chip) => (
            <li
              key={chip}
              className="rounded-sm border border-border-subtle bg-surface-subtle px-1.5 py-0.5 text-xs whitespace-nowrap text-fg-muted tabular-nums"
            >
              {chip}
            </li>
          ))}
        </ul>
        <Button
          onClick={onRun}
          disabled={running || project.parts.length === 0}
          aria-busy={running}
          className="w-full"
        >
          <LayoutGrid aria-hidden />
          {running ? t.running : t.run}
        </Button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        {message ? (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border px-3 py-2.5 text-sm ${message.kind === 'error' ? 'border-danger-border bg-danger-subtle text-danger-text' : 'border-border-subtle bg-surface-subtle text-fg'}`}
          >
            {message.text}
          </p>
        ) : null}
        {summary.sheetCount === 0 ? (
          <p className="text-sm text-fg-muted">{t.none}</p>
        ) : (
          <>
            {/* One strip of three values (T244): no wrapped labels at the 300 px panel width. */}
            <dl
              className="grid grid-cols-3 divide-x divide-border-subtle rounded-lg border border-border-subtle bg-surface-subtle"
              data-testid="nesting-summary"
            >
              <div className="min-w-0 px-2 py-1.5">
                <dt className="text-xs whitespace-nowrap text-fg-muted">{t.sheets}</dt>
                <dd
                  className="text-base font-semibold tracking-tight whitespace-nowrap text-fg tabular-nums"
                  data-testid="nesting-sheets"
                >
                  {summary.sheetCount}
                </dd>
              </div>
              <div className="min-w-0 px-2 py-1.5">
                <dt className="text-xs whitespace-nowrap text-fg-muted">{t.waste}</dt>
                <dd
                  className="text-base font-semibold tracking-tight whitespace-nowrap text-fg tabular-nums"
                  data-testid="nesting-waste"
                >
                  {pct(summary.wastePercent)}
                </dd>
              </div>
              <div className="min-w-0 px-2 py-1.5">
                <dt className="text-xs whitespace-nowrap text-fg-muted">{t.utilisation}</dt>
                <dd className="text-base font-semibold tracking-tight whitespace-nowrap text-fg tabular-nums">
                  {pct(summary.utilisationPercent)}
                </dd>
              </div>
            </dl>
            <ul
              className="flex flex-col gap-0.5 text-sm text-fg-muted"
              data-testid="nesting-sheet-lines"
            >
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
          <p
            className="flex items-center gap-1.5 text-sm font-medium text-warning-text"
            data-testid="nesting-unplaced"
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {fill(t.unplaced, { count: summary.unplaced.length })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
