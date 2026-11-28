'use client';

import {
  SPINDLE_RPM_BAND,
  SPINDLE_RPM_INPUT_STEP,
  SPINDLE_RPM_PAGE_STEP,
  SPINDLE_RPM_STEP,
  chipLoadStatus,
  feedAboveRecommendation,
  machineFeedLimits,
  rpmBand,
  spindleSettingsOf,
  type MachineProfile,
  type Project,
  type ToolSpindle,
} from '@nittcam/core';
import { NumberInput, Slider, cn, formatNumberTr } from '@nittcam/ui';
import { useId, useState } from 'react';
import { fill } from '../../lib/fill';
import { NumberField } from '../wizard/number-field';
import type { Messages } from '../../lib/messages';

type Text = Messages['simulation']['cutting']['spindle'];
type Run = (name: string, params: unknown) => boolean;
type FieldErrors = { number: string; positive: string; rejected: string };
type Limits = ReturnType<typeof machineFeedLimits>;

const rpmText = (v: number) => formatNumberTr(v, { maxDecimals: 0 });
const chipFormat = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/**
 * T307 (D-098): "Devir" in the Simülasyon "Kesim ayarları": one row per tool of the job with a
 * slider over the machine's spindle range and a typed field. The recommended value (the material
 * set's rpm) is marked on the track; a calm band shows ±20 %; outside it the value turns warning
 * colour with one line why. Every committed value is one `setSpindleRpm` command (undoable); the
 * recommended value itself clears the project's own value. T323: each row also holds the tool's
 * cutting feed and plunge feed (`setToolFeed`, inside the machine limits); the chip load uses the
 * tool's own feed.
 */
export function SpindleSettings({
  t,
  errors,
  project,
  machine,
  run,
}: {
  t: Text;
  errors: FieldErrors;
  project: Project;
  machine: MachineProfile | null;
  run: Run;
}) {
  if (!machine) return null;
  const rows = spindleSettingsOf(project, machine);
  const limits = machineFeedLimits(machine);
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" data-testid="sim-cutting-spindle">
      <legend className="mb-1 text-xs font-medium text-fg">{t.title}</legend>
      {rows.length === 0 ? (
        <p className="text-xs text-fg-muted">{t.none}</p>
      ) : (
        rows.map((row) => (
          <SpindleRow
            key={row.tool}
            t={t}
            row={row}
            min={machine.spindle.minRpm}
            max={machine.spindle.maxRpm}
            limits={limits}
            errors={errors}
            run={run}
            project={project}
            machine={machine}
          />
        ))
      )}
    </fieldset>
  );
}

function SpindleRow({
  t,
  row,
  min,
  max,
  limits,
  errors,
  run,
  project,
  machine,
}: {
  t: Text;
  row: ToolSpindle;
  min: number;
  max: number;
  limits: Limits;
  errors: FieldErrors;
  run: Run;
  project: Project;
  machine: MachineProfile;
}) {
  const id = useId();
  const [draft, setDraft] = useState(row.rpm);
  const [typed, setTyped] = useState<number | null>(row.rpm);
  const [refused, setRefused] = useState(false);
  // Follow a committed, undone or reset value (derived state, no effect; the row keeps focus).
  const [shown, setShown] = useState(row.rpm);
  if (row.rpm !== shown) {
    setShown(row.rpm);
    setDraft(row.rpm);
    setTyped(row.rpm);
    setRefused(false);
  }
  const live = rpmBand(draft, row.recommended);
  const lo = Math.max(min, Math.round(row.recommended * (1 - SPINDLE_RPM_BAND)));
  const hi = Math.min(max, Math.round(row.recommended * (1 + SPINDLE_RPM_BAND)));
  const inRange = draft >= min && draft <= max;
  const warn = !inRange || live.band !== 'ok';
  const chipLoad = draft > 0 && row.flutes > 0 ? row.feed / (draft * row.flutes) : null;
  // T359 (D-150): a metal kind's chip-load band leads the row, with the feed that fixes it.
  const chip =
    chipLoad === null ? null : chipLoadStatus(project, { ...row, rpm: draft, chipLoad }, machine);
  const testId = `sim-spindle-T${row.tool}`;

  function commit(v: number): void {
    const next = Math.round(v / SPINDLE_RPM_INPUT_STEP) * SPINDLE_RPM_INPUT_STEP;
    if (!Number.isFinite(next) || next < min || next > max) {
      setRefused(true);
      return;
    }
    setRefused(false);
    setDraft(next);
    setTyped(next);
    if (next === row.rpm) return;
    run('setSpindleRpm', { tool: row.tool, rpm: next === row.recommended ? null : next });
  }

  const statusId = `${id}-status`;
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId} data-value={row.rpm}>
      {chip && chipLoad !== null ? (
        <div
          className={cn(
            'flex flex-col gap-1 rounded-md border px-2 py-1.5 text-xs numeric',
            chip.inBand
              ? 'border-border text-fg'
              : 'border-warning-border bg-warning-subtle text-warning-text',
          )}
          data-testid={`${testId}-chipband`}
          data-in-band={chip.inBand}
          aria-live="polite"
        >
          <p className="font-medium">
            {fill(t.chipLoadBand, {
              value: chipFormat.format(chipLoad),
              min: chipFormat.format(chip.min),
              max: chipFormat.format(chip.max),
              flutes: row.flutes,
              feed: rpmText(row.feed),
            })}
          </p>
          {chip.fixFeed !== null ? (
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span>
                {fill(chip.enforce === 'limit' ? t.chipLoadOutLimit : t.chipLoadOutWarn, {
                  fix: rpmText(chip.fixFeed),
                })}
              </span>
              {draft === row.rpm ? (
                <button
                  type="button"
                  data-testid={`${testId}-chipfix`}
                  onClick={() => run('setToolFeed', { tool: row.tool, feed: chip.fixFeed })}
                  className="rounded-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {fill(t.chipLoadApply, { fix: rpmText(chip.fixFeed) })}
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${id}-input`} className="text-xs text-fg-muted">
          {fill(t.tool, {
            tool: row.tool,
            diameter: formatNumberTr(row.diameter, { maxDecimals: 2 }),
          })}
        </label>
        <NumberInput
          id={`${id}-input`}
          data-testid={`${testId}-input`}
          aria-describedby={statusId}
          inputSize="sm"
          className="w-32 shrink-0"
          value={typed}
          min={min}
          max={max}
          step={SPINDLE_RPM_STEP}
          maxDecimals={0}
          unit={t.unit}
          invalid={refused}
          onValueChange={(v) => {
            setTyped(v);
            setRefused(false);
            if (v !== null && v >= min && v <= max) setDraft(v);
          }}
          onBlur={() => {
            if (typed !== null) commit(typed);
            else {
              setTyped(row.rpm);
              setDraft(row.rpm);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && typed !== null) commit(typed);
            if (e.key === 'Escape') {
              setTyped(row.rpm);
              setDraft(row.rpm);
              setRefused(false);
            }
          }}
        />
      </div>
      <Slider
        data-testid={`${testId}-slider`}
        value={Math.min(max, Math.max(min, draft))}
        min={min}
        max={max}
        step={SPINDLE_RPM_STEP}
        pageStep={SPINDLE_RPM_PAGE_STEP}
        onValueChange={(v) => {
          setDraft(v);
          setTyped(v);
          setRefused(false);
        }}
        onValueCommit={commit}
        label={fill(t.label, { tool: row.tool })}
        valueText={fill(t.valueText, { value: rpmText(draft) })}
        mark={{
          value: row.recommended,
          label: fill(t.recommended, { value: rpmText(row.recommended) }),
        }}
        band={[lo, hi]}
        tone={warn ? 'warning' : 'default'}
      />
      <div className="flex justify-between text-2xs text-fg-subtle numeric" aria-hidden>
        <span>{rpmText(min)}</span>
        <span>{rpmText(max)}</span>
      </div>
      <p
        id={statusId}
        className={cn('text-xs', warn ? 'text-warning-text' : 'text-fg-muted')}
        data-testid={`${testId}-status`}
        data-band={inRange ? live.band : 'out'}
        aria-live="polite"
      >
        {refused || !inRange
          ? fill(t.outOfRange, { min: rpmText(min), max: rpmText(max) })
          : live.band === 'high'
            ? fill(t.high, { percent: Math.abs(live.deviation) })
            : live.band === 'low'
              ? fill(t.low, { percent: Math.abs(live.deviation) })
              : fill(t.band, { min: rpmText(lo), max: rpmText(hi) })}
      </p>
      {chipLoad !== null && !chip ? (
        <p className="text-xs text-fg-muted numeric" data-testid={`${testId}-chip`}>
          {fill(t.chipLoad, {
            value: chipFormat.format(chipLoad),
            flutes: row.flutes,
            feed: rpmText(row.feed),
          })}
        </p>
      ) : null}
      <FeedFields t={t} row={row} limits={limits} errors={errors} run={run} testId={testId} />
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-fg-muted">
        <span>
          {row.override
            ? t.source.project
            : row.recommendedSource === 'startingValue'
              ? t.source.startingValue
              : t.source.recommended}
        </span>
        {row.override ? (
          <button
            type="button"
            data-testid={`${testId}-reset`}
            onClick={() => run('setSpindleRpm', { tool: row.tool, rpm: null })}
            className="rounded-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t.reset}
          </button>
        ) : null}
      </p>
    </div>
  );
}

/** T323: the tool's cutting feed and plunge feed, mm/min; the recommended value clears the own one. */
function FeedFields({
  t,
  row,
  limits,
  errors,
  run,
  testId,
}: {
  t: Text;
  row: ToolSpindle;
  limits: Limits;
  errors: FieldErrors;
  run: Run;
  testId: string;
}) {
  const n = (v: number) => formatNumberTr(v, { maxDecimals: 0 });
  const bounds = (r: { min: number; max: number }) => ({
    min: r.min,
    max: r.max,
    message: fill(t.feedBounds, { min: n(r.min), max: n(r.max) }),
  });
  const own = row.feedOverride || row.plungeOverride;
  const values = { feed: n(row.recommendedFeed), plunge: n(row.recommendedPlungeFeed) };
  return (
    <div className="flex flex-col gap-1.5" data-testid={`${testId}-feeds`}>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <NumberField
          label={`${t.feed} (${t.feedUnit})`}
          value={row.feed}
          testId={`${testId}-feed`}
          inRow
          errors={errors}
          bounds={bounds(limits.feed)}
          onCommit={(v) =>
            run('setToolFeed', { tool: row.tool, feed: v === row.recommendedFeed ? null : v })
          }
        />
        <NumberField
          label={`${t.plungeFeed} (${t.feedUnit})`}
          value={row.plungeFeed}
          testId={`${testId}-plunge`}
          inRow
          errors={errors}
          bounds={bounds(limits.plungeFeed)}
          onCommit={(v) =>
            run('setToolFeed', {
              tool: row.tool,
              plungeFeed: v === row.recommendedPlungeFeed ? null : v,
            })
          }
        />
      </div>
      {row.plungeFeed > row.feed ? (
        <p className="text-xs text-warning-text" data-testid={`${testId}-plunge-warn`}>
          {t.plungeFaster}
        </p>
      ) : null}
      {feedAboveRecommendation(row) ? (
        // T330 (D-121): far above the recommendation; often one extra zero (field rehearsal B1).
        <p className="text-xs text-warning-text" data-testid={`${testId}-feed-high`}>
          {row.chipLoadHigh && !row.feedHigh && !row.plungeHigh ? t.chipLoadHigh : t.feedHigh}
        </p>
      ) : null}
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-fg-muted">
        <span data-testid={`${testId}-feed-source`}>
          {fill(
            own
              ? t.feedSource.project
              : row.recommendedSource === 'startingValue'
                ? t.feedSource.startingValue
                : t.feedSource.recommended,
            values,
          )}
        </span>
        {own ? (
          <button
            type="button"
            data-testid={`${testId}-feeds-clear`}
            onClick={() => run('setToolFeed', { tool: row.tool, feed: null, plungeFeed: null })}
            className="rounded-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t.feedReset}
          </button>
        ) : null}
      </p>
    </div>
  );
}
