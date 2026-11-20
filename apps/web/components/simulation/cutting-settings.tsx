'use client';

import {
  TAB_BOUNDS,
  cuttingSettingsOf,
  maxTabHeight,
  type MachineProfile,
  type Project,
  type TabMode,
} from '@nittcam/core';
import { useId } from 'react';
import { cn } from '@nittcam/ui';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import { NumberField } from '../wizard/number-field';

type Text = Messages['simulation']['cutting'];
type Run = (name: string, params: unknown) => boolean;

const TAB_MODES: readonly TabMode[] = ['all', 'small', 'off'];
const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

/**
 * T288 (CTO #10 E1, K3): "Kesim ayarları" in the Simülasyon left panel: tabs (every part / small
 * parts only / off), their count, width and height, lead-in (arc / line) and cut direction. Every
 * change is one command (undoable); the simulation re-runs on the new project at once, and the
 * server export reads the same project values. The values shown are the ones the toolpath uses
 * (`cuttingSettingsOf`: project > material set > built-in default).
 */
/**
 * T294: scrolls to the "Kesim ayarları" panel and focuses its first refused field (T299), else its
 * tab choice. `block: 'nearest'` scrolls only as far as needed inside the step's own scroll box,
 * so the fixed workspace (`main`) and its footer never move (CTO #12 B).
 */
export function focusCuttingSettings() {
  const panel = document.querySelector<HTMLElement>('[data-testid="sim-cutting"]');
  if (!panel) return;
  panel.scrollIntoView({ block: 'nearest' });
  const target =
    panel.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    panel.querySelector<HTMLInputElement>('input[type="radio"]:checked');
  target?.focus({ preventScroll: true });
}

/** T294: one line for Özet: "Köprü: her parçada 4 × 10 × 3 mm · Giriş: yay · Yön: climb". */
export function cuttingSummary(t: Text, project: Project, machine: MachineProfile | null): string {
  const c = cuttingSettingsOf(project, machine ?? undefined);
  const f = (v: number) => mmFormat.format(v);
  const tabs = fill(t.summaryTabs[c.tabMode], {
    count: c.tabMode === 'small' ? c.tabs.smallCount : c.tabs.count,
    width: f(c.tabs.width),
    height: f(c.tabs.height),
    skin: f(c.skin ?? 0),
  });
  return fill(t.summaryLine, {
    tabs,
    lead: t.leadIns[c.leadIn].toLocaleLowerCase('tr'),
    direction: c.direction,
  });
}

export function CuttingSettings({
  t,
  errors,
  mm,
  project,
  machine,
  run,
}: {
  t: Text;
  errors: { number: string; positive: string; rejected: string };
  /** Unit label for millimetres. */
  mm: string;
  project: Project;
  machine: MachineProfile | null;
  run: Run;
}) {
  const c = cuttingSettingsOf(project, machine ?? undefined);
  const own = Object.values(c.tabs.source).includes('project');
  const source = own ? 'project' : c.tabs.source.count === 'material' ? 'material' : 'default';
  return (
    <section
      aria-labelledby="sim-cutting-title"
      data-testid="sim-cutting"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-panel py-3 shadow-xs"
    >
      <h2 id="sim-cutting-title" className="text-sm font-semibold text-fg">
        {t.title}
      </h2>
      <Choice
        legend={t.tabs}
        name="tab-mode"
        testId="sim-cutting-tabs"
        value={c.tabMode}
        options={TAB_MODES.map((m) => [m, t.tabModes[m]])}
        onChange={(mode) => run('setTabs', { mode })}
        segmented
      />
      <p className="text-xs text-fg-muted" data-testid="sim-cutting-tabs-hint">
        {fill(t.tabHints[c.tabMode], { skin: mmFormat.format(c.skin ?? 0) })}
      </p>
      {c.tabMode === 'all' && c.skin !== null ? (
        // T294 (CTO #11 E1): the thin skin "Kapalı" switched on stays on small parts after
        // "Her parçada"; say so and let it be switched off here.
        <p
          className="flex flex-wrap items-baseline gap-x-2 text-xs text-fg"
          data-testid="sim-cutting-skin-on"
        >
          <span>{fill(t.skinOn, { skin: mmFormat.format(c.skin) })}</span>
          <button
            type="button"
            data-testid="sim-cutting-skin-off"
            onClick={() => run('setThinSkin', { thickness: null })}
            className="rounded-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t.skinOff}
          </button>
        </p>
      ) : null}
      {c.tabMode !== 'off' ? (
        <div className="flex flex-col gap-2">
          {/* B44: the three fields in one row; the unit sits in the label so a narrow
              field still shows its whole value. */}
          <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
            <NumberField
              label={t.count}
              value={c.tabs.count}
              testId="sim-cutting-count"
              inRow
              errors={errors}
              bounds={{ min: 1, max: 20, integer: true, message: t.bounds.count }}
              inUse={fill(t.inUse, { value: String(c.tabs.count) })}
              onCommit={(count) => run('setTabs', { count })}
            />
            <NumberField
              label={`${t.width} (${mm})`}
              value={c.tabs.width}
              testId="sim-cutting-width"
              inRow
              errors={errors}
              bounds={{
                min: TAB_BOUNDS.minWidth,
                message: fill(t.bounds.width, { min: mmFormat.format(TAB_BOUNDS.minWidth) }),
              }}
              inUse={fill(t.inUse, { value: `${mmFormat.format(c.tabs.width)} mm` })}
              onCommit={(width) => run('setTabs', { width })}
            />
            <NumberField
              label={`${t.height} (${mm})`}
              value={c.tabs.height}
              testId="sim-cutting-height"
              inRow
              errors={errors}
              bounds={heightBounds(t, project.stock.thickness)}
              inUse={fill(t.inUse, { value: `${mmFormat.format(c.tabs.height)} mm` })}
              onCommit={(height) => run('setTabs', { height })}
            />
          </div>
          {c.tabs.smallCount > c.tabs.count ? (
            <p className="text-xs text-fg-muted" data-testid="sim-cutting-small-count">
              {fill(t.smallCount, { n: c.tabs.smallCount })}
            </p>
          ) : null}
          {c.tabs.height > project.stock.thickness / 2 ? (
            <p className="text-xs text-warning-text" data-testid="sim-cutting-height-warn">
              {t.heightWarn}
            </p>
          ) : null}
          <p className="text-xs text-fg-muted" data-testid="sim-cutting-source">
            {t.source[source]}{' '}
            {own ? (
              <button
                type="button"
                data-testid="sim-cutting-reset"
                onClick={() => run('setTabs', { count: null, width: null, height: null })}
                className="rounded-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {t.reset}
              </button>
            ) : null}
          </p>
        </div>
      ) : null}
      <Choice
        legend={t.leadIn}
        name="lead-in"
        testId="sim-cutting-lead"
        value={c.leadIn}
        options={(['arc', 'line'] as const).map((v) => [v, t.leadIns[v]])}
        onChange={(leadIn) => run('setLeadIn', { leadIn })}
      />
      <Choice
        legend={t.direction}
        name="direction"
        testId="sim-cutting-direction"
        value={c.direction}
        options={(['climb', 'conventional'] as const).map((v) => [v, t.directions[v]])}
        onChange={(direction) => run('setCutDirection', { direction })}
      />
      <p className="text-xs text-fg-muted" data-testid="sim-cutting-direction-hint">
        {t.directionHint}
      </p>
      <p className="text-xs text-fg-muted">{t.note}</p>
    </section>
  );
}

/**
 * Tab height range for the field (T293, B44): "çok yüksek" above the top; on a sheet thinner than
 * min + 1 mm no height holds, so the range is never shown reversed ("1–0,5 mm").
 */
function heightBounds(t: Text, thickness: number) {
  const min = TAB_BOUNDS.minHeight;
  const max = maxTabHeight(thickness);
  const f = (v: number) => mmFormat.format(v);
  if (max < min) {
    const none = fill(t.bounds.heightNone, {
      thickness: f(thickness),
      need: f(min + TAB_BOUNDS.belowThickness),
    });
    return { min, max: min - 1, message: none, highMessage: none };
  }
  return {
    min,
    max,
    message: fill(t.bounds.height, { min: f(min), max: f(max) }),
    highMessage: fill(t.bounds.heightHigh, { max: f(max) }),
  };
}

/** A small radio row (the same pattern as the sheet size choice on step 1). */
function Choice<V extends string>({
  legend,
  name,
  testId,
  value,
  options,
  onChange,
  segmented = false,
}: {
  /** B44: one connected row (the radios visually hidden, labels share the width). */
  segmented?: boolean;
  legend: string;
  name: string;
  testId: string;
  value: V;
  options: readonly (readonly [V, string])[];
  onChange: (v: V) => void;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid={testId} data-value={value}>
      <legend className="mb-1 text-xs font-medium text-fg">{legend}</legend>
      <div
        className={
          segmented
            ? 'flex gap-0.5 rounded-lg border border-border p-0.5'
            : 'flex flex-wrap gap-1.5'
        }
      >
        {options.map(([v, label]) => {
          const on = v === value;
          return (
            <label
              key={v}
              className={cn(
                'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                segmented &&
                  'relative min-w-0 flex-1 justify-center rounded-md px-1.5 text-center text-xs leading-tight',
                on
                  ? 'border-accent-border bg-accent-subtle font-medium text-fg'
                  : segmented
                    ? 'border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg'
                    : 'border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              <input
                type="radio"
                name={`${id}-${name}`}
                value={v}
                // Segmented: the radio covers its label (invisible), so a click or tap lands on it.
                className={
                  segmented
                    ? 'absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0'
                    : 'size-4 accent-(--color-accent)'
                }
                checked={on}
                onChange={() => {
                  if (!on) onChange(v);
                }}
              />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
