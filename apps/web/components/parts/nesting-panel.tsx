'use client';

import { summarizeLayout, usedOffcutIds, type Project } from '@nittcam/core';
import { useMemo } from 'react';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import { useNestProgress, type NestProgressStore } from '../../lib/nesting-progress';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Progress } from '@nittcam/ui';
import { Info, LayoutGrid, TriangleAlert } from 'lucide-react';

const sizeFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

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
  progress = null,
  message,
  onRun,
  onCancel,
}: {
  t: Text;
  project: Project;
  toolDiameter: number;
  running: boolean;
  /** Placer candidates done / total while running (T163), read by the bar only. */
  progress?: NestProgressStore | null;
  message: { kind: 'error' | 'info'; text: string } | null;
  onRun: () => void;
  /** "İptal" while running (T163): stops the worker, the old layout stays. */
  onCancel?: (() => void) | undefined;
}) {
  // T281: a run starting or stopping re-renders the panel; the summary only changes with the project.
  const summary = useMemo(() => summarizeLayout(project), [project]);
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
        {/* T244 (D-039): values as chips; the explanation sits in the popover. T249: gap and
            margin are not repeated here (their inputs sit right above); the tool stays. */}
        <ul className="flex flex-wrap gap-1.5" data-testid="nesting-chips">
          {[fill(t.toolChip, { value: percent.format(toolDiameter) })].map((chip) => (
            <li
              key={chip}
              className="rounded-sm border border-border-subtle bg-surface-subtle px-1.5 py-0.5 text-xs whitespace-nowrap text-fg-muted tabular-nums"
            >
              {chip}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            onClick={onRun}
            disabled={running || project.parts.length === 0}
            aria-busy={running}
            className="min-w-0 flex-1"
          >
            <LayoutGrid aria-hidden />
            {running ? <RunningLabel t={t} store={progress} /> : t.run}
          </Button>
          {running && onCancel ? (
            <Button variant="outline" onClick={onCancel} data-testid="nesting-cancel">
              {t.cancel}
            </Button>
          ) : null}
        </div>
        {running ? <NestProgressBar t={t} store={progress} /> : null}
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
            {summary.bySize.length > 1 ? (
              // T164: several stock sizes in the layout: one line per size.
              <ul
                className="flex flex-col gap-0.5 text-xs text-fg-muted tabular-nums"
                aria-label={t.bySizeLabel}
                data-testid="nesting-by-size"
              >
                {summary.bySize.map((b) => (
                  <li key={`${b.width}x${b.height}`}>
                    {fill(t.bySize, {
                      w: sizeFormat.format(b.width),
                      h: sizeFormat.format(b.height),
                      count: String(b.sheets),
                      waste: pct(b.wastePercent),
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
            {usedOffcutIds(project).length > 0 ? (
              // T168: sheets cut from the offcut stock (the export marks them used).
              <p
                className="text-xs text-fg-muted"
                data-testid="nesting-offcuts"
                data-count={usedOffcutIds(project).length}
              >
                {fill(t.fromOffcuts, { count: String(usedOffcutIds(project).length) })}
              </p>
            ) : null}
            {/* T249: no per-plate lines; the plate tabs carry "fire %" once. */}
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

/** "Diziliyor… %40" on the running "Diz" button (B44); "İptal" sits next to it. */
function RunningLabel({ t, store }: { t: Text; store: NestProgressStore | null }) {
  const progress = useNestProgress(store);
  if (!progress || progress.total <= 0) return <>{t.running}</>;
  const pct = Math.min(100, Math.round((100 * progress.done) / progress.total));
  return <span className="tabular-nums">{fill(t.runningPercent, { pct })}</span>;
}

/** The progress bar of a running nesting (T163); subscribes to the store by itself. */
function NestProgressBar({ t, store }: { t: Text; store: NestProgressStore | null }) {
  const progress = useNestProgress(store);
  return (
    <div className="flex flex-col gap-1" data-testid="nesting-progress">
      <Progress value={progress?.done ?? 0} max={progress?.total ?? 1} aria-label={t.progress} />
      <span className="text-xs text-fg-muted tabular-nums">
        {progress ? fill(t.progressText, { done: progress.done, total: progress.total }) : ' '}
      </span>
    </div>
  );
}
