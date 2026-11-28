'use client';
/**
 * T391 (D-131): "Katla (ACM)" on the montaj tezgâhı. One slider folds every V-groove of every ACM
 * part from flat to its designed angle; the selected part lists its grooves with their own angle,
 * designed angle and bend, and the fold check (overlap red, corner gap, missing relief). View
 * state only: never stored, never changes nesting, toolpath or NC.
 */
import { NumberInput, Slider, cn } from '@nittcam/ui';
import type { Messages } from '../../lib/messages';
import { fill } from '../../lib/fill';
import type { FoldIssue } from '../../lib/preview3d/acm-fold';
import { foldKey, type FoldPart, type FoldState } from '../../lib/preview3d/bench-fold';

type T = Messages['bench']['fold'];
const MM1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const MM2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

const STATE_TONE = {
  closed: 'text-success-text',
  gap: 'text-warning-text',
  clash: 'text-danger-text',
} as const;

export function FoldTools({
  t,
  parts,
  state,
  onState,
  focusPartId,
  vAngle,
  noTool,
}: {
  t: T;
  parts: readonly FoldPart[];
  state: FoldState;
  onState: (s: FoldState) => void;
  /** The part listed in detail (the selected one, else the first foldable part). */
  focusPartId: string | null;
  /** The V-bit angle the grooves are cut with, degrees. */
  vAngle: number;
  noTool: boolean;
}) {
  const focus = parts.find((p) => p.partId === focusPartId) ?? parts[0];
  const pieceName = (p: FoldPart, piece: number) => {
    const h = p.plan.pieces[piece]?.hinge ?? -1;
    return h < 0 ? t.base : fill(t.groove, { n: h + 1 });
  };
  const issueText = (p: FoldPart, x: FoldIssue) => {
    const a = pieceName(p, x.a);
    const b = pieceName(p, x.b);
    if (x.kind === 'relief') return fill(t.issues.relief, { a, b });
    if (x.kind === 'overlap') return fill(t.issues.overlap, { a, b, mm: MM1.format(x.depth) });
    return fill(t.issues.corner, { a, b, mm: MM2.format(x.gap) });
  };
  return (
    <section
      aria-label={t.title}
      data-testid="bench-fold"
      className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-surface p-2"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="font-semibold text-fg text-sm">{t.title}</h3>
        <p className="text-xs text-fg-muted">{t.hint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg">{t.all}</span>
          <span className="text-fg-muted tabular-nums">{fill(t.percent, { v: state.pct })}</span>
        </div>
        <Slider
          value={state.pct}
          min={0}
          max={100}
          step={5}
          label={t.all}
          valueText={fill(t.percent, { v: state.pct })}
          // The global slider takes over every groove again.
          onValueChange={(pct) => onState({ ...state, pct, deg: {} })}
          onValueCommit={(pct) => onState({ ...state, pct, deg: {} })}
          data-testid="bench-fold-all"
        />
        {noTool ? <p className="text-xs text-fg-muted">{t.noTool}</p> : null}
      </div>
      {parts.length > 1 ? (
        <ul className="flex flex-col gap-0.5 text-xs" data-testid="bench-fold-parts">
          {parts.map((p) => (
            <li key={p.partId} className="flex items-center justify-between gap-2">
              <span className={cn('truncate text-fg', p === focus && 'font-semibold')}>
                {p.name}
              </span>
              <span className={STATE_TONE[p.check.state]}>{t.states[p.check.state]}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {focus ? (
        <div
          className="flex flex-col gap-2 border-border border-t pt-2"
          data-testid="bench-fold-part"
          data-state={focus.check.state}
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-semibold text-fg">{focus.name}</span>
            <span
              className={cn('font-semibold', STATE_TONE[focus.check.state])}
              data-testid="bench-fold-state"
            >
              {t.states[focus.check.state]}
            </span>
          </div>
          {focus.plan.hinges.map((h, i) => {
            const key = foldKey(focus.partId, h.key);
            const deg = focus.angles[i] ?? 0;
            const target = focus.targets[i] ?? 90;
            const bend = focus.bends[i];
            const label = fill(t.groove, { n: i + 1 });
            return (
              <div
                key={h.key}
                className="flex flex-col gap-1"
                data-testid={`bench-fold-groove-${i + 1}`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-fg">{label}</span>
                  <span className="text-fg-muted tabular-nums">{fill(t.angle, { v: deg })}</span>
                </div>
                <Slider
                  value={deg}
                  min={0}
                  max={Math.max(1, target)}
                  step={1}
                  pageStep={15}
                  label={label}
                  valueText={fill(t.angle, { v: deg })}
                  onValueChange={(v) => onState({ ...state, deg: { ...state.deg, [key]: v } })}
                  onValueCommit={(v) => onState({ ...state, deg: { ...state.deg, [key]: v } })}
                />
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-fg-muted">{t.target}</span>
                  <NumberInput
                    aria-label={`${label}: ${t.target}`}
                    value={target}
                    min={0}
                    max={180}
                    step={5}
                    unit="°"
                    maxDecimals={0}
                    inputSize="sm"
                    className="w-20"
                    data-testid={`bench-fold-target-${i + 1}`}
                    onValueChange={(v) => {
                      if (v === null || !(v >= 0 && v <= 180)) return;
                      const deg = Object.fromEntries(
                        Object.entries(state.deg).filter(([k]) => k !== key),
                      );
                      onState({ ...state, deg, target: { ...state.target, [key]: v } });
                    }}
                  />
                </div>
                {bend ? (
                  <p className="text-xs text-fg-muted tabular-nums">
                    {fill(t.bend, {
                      ri: MM2.format(bend.rInner),
                      ro: MM2.format(bend.rOuter),
                      ba: MM2.format(bend.allowance),
                    })}
                  </p>
                ) : null}
                {bend?.overFold ? (
                  <p className="text-xs text-warning-text">{fill(t.overFold, { v: vAngle })}</p>
                ) : null}
              </div>
            );
          })}
          {focus.plan.skipped > 0 ? (
            <p className="text-xs text-fg-muted">{fill(t.skipped, { n: focus.plan.skipped })}</p>
          ) : null}
          {focus.check.issues.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-xs" data-testid="bench-fold-issues">
              {focus.check.issues.map((x) => (
                <li
                  key={`${x.kind}:${x.a}:${x.b}`}
                  className={x.kind === 'corner' ? 'text-fg-muted' : 'text-danger-text'}
                >
                  {issueText(focus, x)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
