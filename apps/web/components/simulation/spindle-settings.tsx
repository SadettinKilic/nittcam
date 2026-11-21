'use client';

import {
  SPINDLE_RPM_BAND,
  SPINDLE_RPM_INPUT_STEP,
  SPINDLE_RPM_PAGE_STEP,
  SPINDLE_RPM_STEP,
  rpmBand,
  spindleSettingsOf,
  type MachineProfile,
  type Project,
  type ToolSpindle,
} from '@nittcam/core';
import { NumberInput, Slider, cn, formatNumberTr } from '@nittcam/ui';
import { useId, useState } from 'react';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';

type Text = Messages['simulation']['cutting']['spindle'];
type Run = (name: string, params: unknown) => boolean;

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
 * recommended value itself clears the project's own value.
 */
export function SpindleSettings({
  t,
  project,
  machine,
  run,
}: {
  t: Text;
  project: Project;
  machine: MachineProfile | null;
  run: Run;
}) {
  if (!machine) return null;
  const rows = spindleSettingsOf(project, machine);
  return (
    <fieldset className="flex flex-col gap-3" data-testid="sim-cutting-spindle">
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
            run={run}
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
  run,
}: {
  t: Text;
  row: ToolSpindle;
  min: number;
  max: number;
  run: Run;
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
      {chipLoad !== null ? (
        <p className="text-xs text-fg-muted numeric" data-testid={`${testId}-chip`}>
          {fill(t.chipLoad, {
            value: chipFormat.format(chipLoad),
            flutes: row.flutes,
            feed: rpmText(row.feed),
          })}
        </p>
      ) : null}
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-fg-muted">
        <span>{row.override ? t.source.project : t.source.recommended}</span>
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
