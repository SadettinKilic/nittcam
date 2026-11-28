'use client';
/**
 * "Oturuyor mu?" result panel (T388): overlaps (red, depth in mm), off-centre holes (orange),
 * small gaps and aligned holes (green). Clicking a row frames the pair. Never blocks export.
 */
import { IconButton, cn } from '@nittcam/ui';
import { X } from 'lucide-react';
import { useMemo } from 'react';
import type { Messages } from '../../lib/messages';
import { fill } from '../../lib/fill';
import type { BenchItem } from '../../lib/preview3d/assembly-model';
import type { FitIssue } from '../../lib/preview3d/fit-check';
import type { FitState } from './use-fit-check';

type T = Messages['bench'];

const MM2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

/** Short part label: "Yan (2.)" for the second copy of a multi-copy part. */
export function benchLabel(item: BenchItem | undefined, t: T): string {
  if (!item) return '?';
  const name = item.part.name || item.partId;
  return item.part.qty > 1 ? `${name} (${fill(t.list.copy, { n: item.copy + 1 })})` : name;
}

export interface FitRow {
  key: string;
  tone: 'danger' | 'warning' | 'muted' | 'success';
  kind: FitIssue['kind'] | 'holeOk';
  a: string;
  b: string;
  text: string;
}

/** Issues → panel rows (aligned holes of one pair grouped into one row). */
export function fitRows(
  issues: readonly FitIssue[],
  byId: ReadonlyMap<string, BenchItem>,
  t: T,
): FitRow[] {
  const c = t.check;
  const rows: FitRow[] = [];
  const ok = new Map<string, { a: string; b: string; count: number }>();
  const name = (id: string) => benchLabel(byId.get(id), t);
  issues.forEach((x, i) => {
    const base = { a: x.a, b: x.b, key: `${x.kind}:${x.a}:${x.b}:${i}` };
    const ab = { a: name(x.a), b: name(x.b) };
    if (x.kind === 'overlap') {
      rows.push({
        ...base,
        kind: 'overlap',
        tone: 'danger',
        text: fill(c.overlap, { ...ab, mm: MM2.format(x.depth) }),
      });
    } else if (x.kind === 'gap') {
      rows.push({
        ...base,
        kind: 'gap',
        tone: 'muted',
        text: fill(c.gap, { ...ab, mm: MM2.format(x.gap) }),
      });
    } else if (!x.ok) {
      rows.push({
        ...base,
        kind: 'hole',
        tone: 'warning',
        text: fill(c.holeOff, { ...ab, mm: MM2.format(x.offset) }),
      });
    } else {
      const k = `${x.a}|${x.b}`;
      const g = ok.get(k) ?? { a: x.a, b: x.b, count: 0 };
      g.count++;
      ok.set(k, g);
    }
  });
  for (const g of ok.values()) {
    rows.push({
      key: `ok:${g.a}:${g.b}`,
      kind: 'holeOk',
      tone: 'success',
      a: g.a,
      b: g.b,
      text: fill(c.holeOk, { a: name(g.a), b: name(g.b), count: g.count }),
    });
  }
  return rows;
}

const DOT: Record<FitRow['tone'], string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  muted: 'bg-fg-subtle',
  success: 'bg-success',
};

export function FitPanel({
  t,
  state,
  byId,
  onFrame,
  onClose,
}: {
  t: T;
  state: FitState;
  byId: ReadonlyMap<string, BenchItem>;
  onFrame: (a: string, b: string) => void;
  onClose: () => void;
}) {
  const c = t.check;
  const { result, busy, failed } = state;
  const rows = useMemo(() => (result ? fitRows(result.issues, byId, t) : []), [result, byId, t]);
  const counts = useMemo(() => {
    const n = { overlap: 0, holeOff: 0, gap: 0 };
    for (const r of rows) {
      if (r.kind === 'overlap') n.overlap++;
      else if (r.kind === 'hole') n.holeOff++;
      else if (r.kind === 'gap') n.gap++;
    }
    return n;
  }, [rows]);
  const bad = counts.overlap + counts.holeOff + counts.gap;
  return (
    <section
      aria-label={c.title}
      data-testid="bench-check"
      data-busy={busy ? 'true' : 'false'}
      data-overlaps={counts.overlap}
      data-holes-off={counts.holeOff}
      data-gaps={counts.gap}
      data-touching={result?.touching ?? ''}
      className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-surface p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-fg text-sm">{c.title}</h3>
        <IconButton
          aria-label={c.close}
          size="sm"
          onClick={onClose}
          data-testid="bench-check-close"
        >
          <X aria-hidden />
        </IconButton>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-fg-muted">
        {failed
          ? c.failed
          : !result
            ? c.busy
            : [
                fill(c.summary, { parts: result.parts, touching: result.touching }),
                ...(counts.overlap ? [fill(c.counts.overlap, { count: counts.overlap })] : []),
                ...(counts.holeOff ? [fill(c.counts.holeOff, { count: counts.holeOff })] : []),
                ...(counts.gap ? [fill(c.counts.gap, { count: counts.gap })] : []),
              ].join(' · ')}
        {busy && result ? ` · ${c.busy}` : null}
      </p>
      {result && bad === 0 ? (
        <p className="rounded-md border border-success-border bg-success-subtle px-2 py-1.5 text-xs text-success-text">
          {c.allGood}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul aria-label={c.listLabel} className="flex max-h-64 flex-col overflow-y-auto">
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                data-testid="bench-check-row"
                data-kind={r.kind}
                title={c.frameTip}
                onClick={() => onFrame(r.a, r.b)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs text-fg hover:bg-surface-hover',
                  'focus-visible:outline-2 focus-visible:outline-accent',
                )}
              >
                <span
                  aria-hidden
                  className={cn('mt-1 size-2 shrink-0 rounded-full', DOT[r.tone])}
                />
                <span className="min-w-0 break-words">{r.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-fg-subtle">{c.rules}</p>
    </section>
  );
}
