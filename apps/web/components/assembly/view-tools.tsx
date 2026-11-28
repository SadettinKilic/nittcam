'use client';
/**
 * Explode slider and section plane of the montaj tezgâhı (T389). Display only: the exploded poses
 * and the cut are never stored.
 */
import { Button, Slider, Switch, cn } from '@nittcam/ui';
import { FlipHorizontal2 } from 'lucide-react';
import type { Messages } from '../../lib/messages';
import { fill } from '../../lib/fill';
import type { Bounds, Section } from '../../lib/preview3d/assembly-explode';
import type { FastenerRow } from '../../lib/preview3d/fasteners';

type T = Messages['bench'];
const MM = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const MM1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const AXES = ['x', 'y', 'z'] as const;

export function ViewTools({
  t,
  explode,
  onExplode,
  section,
  onSection,
  bounds,
  sheet,
  onSheet,
  fasteners,
  onFasteners,
  fastenerRows,
}: {
  t: T;
  /** 0 … 100 %. */
  explode: number;
  onExplode: (v: number) => void;
  section: Section | null;
  onSection: (s: Section | null) => void;
  bounds: Bounds | null;
  /** The "Montaj föyü" page in the project PDF (stored in the project). */
  sheet: boolean;
  onSheet: (on: boolean) => void;
  /** T390: fastener markers through aligned holes shown (view state, not stored). */
  fasteners: boolean;
  onFasteners: (on: boolean) => void;
  /** The markers of the visible parts, grouped (empty = no aligned hole pair). */
  fastenerRows: readonly FastenerRow[];
}) {
  const v = t.tools;
  const range = (axis: 0 | 1 | 2): [number, number] =>
    bounds ? [Math.floor(bounds.min[axis]), Math.ceil(bounds.max[axis])] : [0, 0];
  const pick = (axis: 0 | 1 | 2 | null) => {
    if (axis === null) return onSection(null);
    const [lo, hi] = range(axis);
    onSection({ axis, at: Math.round((lo + hi) / 2), flip: section?.flip ?? false });
  };
  const [lo, hi] = section ? range(section.axis) : [0, 0];
  return (
    <section
      aria-label={v.title}
      data-testid="bench-tools"
      className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-surface p-2"
    >
      <h3 className="font-semibold text-fg text-sm">{v.title}</h3>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg">{v.explode}</span>
          <span className="text-fg-muted tabular-nums">{fill(v.percent, { v: explode })}</span>
        </div>
        <Slider
          value={explode}
          min={0}
          max={100}
          step={5}
          label={v.explode}
          valueText={fill(v.percent, { v: explode })}
          onValueChange={onExplode}
          onValueCommit={onExplode}
          data-testid="bench-explode"
        />
        {explode > 0 ? <p className="text-xs text-fg-muted">{v.locked}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg">{v.section}</span>
        <div role="radiogroup" aria-label={v.section} className="flex items-center gap-0.5">
          {([null, 0, 1, 2] as const).map((axis) => {
            const on = axis === null ? section === null : section?.axis === axis;
            return (
              <Button
                key={String(axis)}
                role="radio"
                aria-checked={on}
                variant="ghost"
                size="sm"
                data-testid={`bench-section-${axis === null ? 'off' : AXES[axis]}`}
                onClick={() => pick(axis)}
                className={cn(
                  'flex-1 px-2',
                  on && 'bg-accent-subtle text-accent-text hover:text-accent-text',
                )}
              >
                {axis === null ? v.sectionOff : t.inspector[AXES[axis]]}
              </Button>
            );
          })}
        </div>
        {section ? (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-fg-muted">{v.sectionAt}</span>
              <span className="text-fg-muted tabular-nums">{MM.format(section.at)} mm</span>
            </div>
            <Slider
              value={section.at}
              min={lo}
              max={Math.max(hi, lo + 1)}
              step={1}
              pageStep={10}
              label={v.sectionAt}
              valueText={`${MM.format(section.at)} mm`}
              onValueChange={(at) => onSection({ ...section, at })}
              onValueCommit={(at) => onSection({ ...section, at })}
              data-testid="bench-section-at"
            />
            <Button
              variant="outline"
              size="sm"
              aria-pressed={section.flip}
              data-testid="bench-section-flip"
              onClick={() => onSection({ ...section, flip: !section.flip })}
            >
              <FlipHorizontal2 aria-hidden />
              {v.flip}
            </Button>
          </>
        ) : null}
      </div>
      <div className="flex items-start gap-2 border-border border-t pt-2">
        <Switch
          id="bench-fasteners"
          checked={fasteners}
          onCheckedChange={onFasteners}
          data-testid="bench-fasteners"
          aria-describedby="bench-fasteners-hint"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor="bench-fasteners" className="text-xs text-fg">
            {v.fasteners}
          </label>
          <p id="bench-fasteners-hint" className="text-xs text-fg-muted">
            {fastenerRows.length === 0 ? v.fastenersNone : v.fastenersHint}
          </p>
          {fastenerRows.length > 0 ? (
            <ul className="flex flex-col text-xs text-fg" data-testid="bench-fastener-rows">
              {fastenerRows.map((r) => (
                <li key={`${r.kind}:${r.d}:${r.length}`} className="tabular-nums">
                  {fill(v.fastenerRow, {
                    qty: r.qty,
                    name: fill(v.fastenerKinds[r.kind], {
                      d: MM1.format(r.d),
                      length: MM1.format(r.length),
                    }),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex items-start gap-2 border-border border-t pt-2">
        <Switch
          id="bench-sheet"
          checked={sheet}
          onCheckedChange={onSheet}
          data-testid="bench-sheet"
          aria-describedby="bench-sheet-hint"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor="bench-sheet" className="text-xs text-fg">
            {v.sheet}
          </label>
          <p id="bench-sheet-hint" className="text-xs text-fg-muted">
            {v.sheetHint}
          </p>
        </div>
      </div>
    </section>
  );
}
