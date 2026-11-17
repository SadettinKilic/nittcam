'use client';

import {
  findMaterialParams,
  materialHasGrain,
  materialKindOf,
  profileThicknesses,
  type MachineProfile,
  type MaterialKind,
  type Project,
  type ValidationIssue,
} from '@nittcam/core';
import Link from 'next/link';
import { useId, useState } from 'react';
import { fill } from '../../lib/draft-project';
import type { MachineDetail, MachineListItem } from '../../lib/machines-api';
import type { Messages } from '../../lib/messages';
import { TriangleAlert } from 'lucide-react';
import { focusRing } from '../page/page-header';
import { NumberField, inputClass } from './number-field';
import { Callout, canvasWellClass } from './panels';

type Text = Messages['wizard']['machine'];
type MaterialText = Messages['materials'];

const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const mm = (v: number) => mmFormat.format(v);

/** Sheet presets of §3.6 (short × long); stored with the long side along X. */
export const SHEET_PRESETS = [
  { a: 1220, b: 2440 },
  { a: 2100, b: 2800 },
  { a: 2070, b: 2800 },
] as const;

const WOOD: readonly MaterialKind[] = ['mdf', 'plywood', 'melamine', 'solidWood'];
const PLASTIC: readonly MaterialKind[] = ['acrylic', 'pvc'];

function presetIndex(sheet: { width: number; height: number }): number {
  return SHEET_PRESETS.findIndex((p) => sheet.width === p.b && sheet.height === p.a);
}

type Run = (name: string, params: unknown) => boolean;

/**
 * Step 1 fields (spec §3.6 "Makine ve plaka"): machine, material and thickness (the profile's
 * parameter sets, D-029), sheet size presets or custom, grain for wood only, and the warnings
 * "plaka tablaya sığmıyor" / no cutting parameters.
 */
export function MachineFields({
  t,
  materials,
  project,
  machines,
  detail,
  issues,
  run,
  machinesLink,
}: {
  t: Text;
  machinesLink: string;
  materials: MaterialText;
  project: Project;
  machines: readonly MachineListItem[];
  detail: MachineDetail | null;
  issues: readonly ValidationIssue[];
  run: Run;
}) {
  const ids = { machine: useId(), material: useId(), thicknesses: useId() };
  const { stock } = project;
  const kind = materialKindOf(stock.material);
  const profile = detail?.profile ?? null;
  const known = machines.some((m) => m.id === project.machine.machineId);
  const preset = presetIndex(stock.sheet);
  const [customOpen, setCustomOpen] = useState(false);
  const custom = preset < 0 || customOpen;
  const thicknesses = profile && kind ? profileThicknesses(profile, kind) : [];
  const set = profile ? findMaterialParams(profile, stock) : undefined;
  const tableIssue = issues.find((i) => i.code === 'SHEET_LARGER_THAN_TABLE');
  const errors = t.errors;

  const materialName = (k: MaterialKind) => materials[k];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-muted">{t.help}</p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.machine} className="text-sm font-medium text-fg">
          {t.machine}
        </label>
        <select
          id={ids.machine}
          data-testid="wizard-machine"
          className={inputClass}
          value={known ? project.machine.machineId : ''}
          onChange={(e) => {
            const m = machines.find((x) => x.id === e.target.value);
            if (m) run('setMachine', { machineId: m.id, profileVersion: m.version });
          }}
        >
          {known ? null : <option value="">{t.choose}</option>}
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {fill(t.option, { name: m.name, version: m.version })}
            </option>
          ))}
        </select>
        {!known ? <p className="text-xs text-warning-text">{t.unknownMachine}</p> : null}
        {profile ? (
          <p className="text-xs text-fg-muted">
            {fill(t.table, {
              w: mm(profile.table.width),
              d: mm(profile.table.depth),
              post: `${profile.post.id} ${profile.post.version}`,
            })}
          </p>
        ) : null}
        {detail && (detail.state !== 'verified' || detail.profile.example) ? (
          <Callout tone="warning" icon={<TriangleAlert aria-hidden />} className="text-xs">
            <p>{t.unverified}</p>
          </Callout>
        ) : null}
        {detail && known && detail.version !== project.machine.profileVersion ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-xs text-info-text">
            <span>
              {fill(t.profileNewer, {
                old: project.machine.profileVersion,
                latest: detail.version,
              })}
            </span>
            <button
              type="button"
              className={`h-control-sm rounded-md border border-border-strong bg-surface px-2.5 font-medium text-fg shadow-xs hover:bg-surface-hover ${focusRing}`}
              onClick={() =>
                run('setMachine', { machineId: detail.id, profileVersion: detail.version })
              }
            >
              {t.useLatest}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.material} className="text-sm font-medium text-fg">
          {t.material}
        </label>
        <select
          id={ids.material}
          data-testid="wizard-material"
          className={inputClass}
          value={kind ?? stock.material}
          onChange={(e) => run('setMaterial', { material: e.target.value })}
        >
          {kind === null ? (
            <option value={stock.material}>
              {fill(materials.unknown, { id: stock.material })}
            </option>
          ) : null}
          <optgroup label={materials.groupWood}>
            {WOOD.map((k) => (
              <option key={k} value={k}>
                {materialName(k)}
              </option>
            ))}
          </optgroup>
          <optgroup label={materials.groupPlastic}>
            {PLASTIC.map((k) => (
              <option key={k} value={k}>
                {materialName(k)}
              </option>
            ))}
          </optgroup>
          <option value="" disabled>
            {materials.stone}
          </option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <NumberField
          label={t.thickness}
          value={stock.thickness}
          testId="wizard-thickness"
          list={thicknesses.length > 0 ? ids.thicknesses : undefined}
          errors={errors}
          onCommit={(thickness) => run('setThickness', { thickness })}
        />
        {thicknesses.length > 0 ? (
          <>
            <datalist id={ids.thicknesses}>
              {thicknesses.map((v) => (
                <option key={v} value={String(v).replace('.', ',')} />
              ))}
            </datalist>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-fg-muted">
                {fill(t.thicknessHint, { list: thicknesses.map(mm).join(', ') })}
              </span>
              {thicknesses.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={v === stock.thickness}
                  onClick={() => run('setThickness', { thickness: v })}
                  className={`h-control-sm min-w-11 rounded-md border px-2.5 text-xs font-medium tabular-nums transition-colors duration-(--duration-fast) ${focusRing} ${v === stock.thickness ? 'border-accent bg-accent text-accent-fg shadow-xs' : 'border-border-strong bg-surface text-fg hover:bg-surface-hover'}`}
                >
                  {mm(v)}
                </button>
              ))}
            </div>
          </>
        ) : profile ? (
          <p className="text-xs text-fg-muted">{t.thicknessNone}</p>
        ) : null}
        {profile && !set ? (
          <p
            role="alert"
            data-testid="no-cutting-params"
            className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm text-danger-text"
          >
            {fill(t.noParams, {
              material: kind ? materialName(kind) : stock.material,
              thickness: mm(stock.thickness),
            })}{' '}
            <Link href="/makineler" className={`font-medium underline ${focusRing}`}>
              {machinesLink}
            </Link>
          </p>
        ) : null}
        {set ? (
          <p className="text-xs text-fg-muted" data-testid="cutting-params">
            {fill(t.paramsOk, {
              tool: set.tool,
              feed: mm(set.feed),
              rpm: mm(set.rpm),
              step: mm(set.stepDown),
            })}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-fg">{t.sheet}</legend>
        <div className="flex flex-wrap gap-2">
          {SHEET_PRESETS.map((p, i) => {
            const on = !custom && preset === i;
            return (
              <label
                key={`${p.a}x${p.b}`}
                className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${on ? 'border-accent-border bg-accent-subtle font-medium text-fg' : 'border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg'}`}
              >
                <input
                  type="radio"
                  name="sheet-size"
                  className="size-4 accent-(--color-accent)"
                  checked={on}
                  onChange={() => {
                    setCustomOpen(false);
                    run('setSheetSize', { width: p.b, height: p.a });
                  }}
                />
                {fill(t.preset, { a: mm(p.a), b: mm(p.b) })}
              </label>
            );
          })}
          <label
            className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${custom ? 'border-accent-border bg-accent-subtle font-medium text-fg' : 'border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg'}`}
          >
            <input
              type="radio"
              name="sheet-size"
              className="size-4 accent-(--color-accent)"
              checked={custom}
              onChange={() => setCustomOpen(true)}
            />
            {t.custom}
          </label>
        </div>
        {custom ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={t.width}
              value={stock.sheet.width}
              testId="wizard-sheet-width"
              errors={errors}
              onCommit={(width) => run('setSheetSize', { width, height: stock.sheet.height })}
            />
            <NumberField
              label={t.height}
              value={stock.sheet.height}
              testId="wizard-sheet-height"
              errors={errors}
              onCommit={(height) => run('setSheetSize', { width: stock.sheet.width, height })}
            />
          </div>
        ) : null}
        {tableIssue && profile ? (
          <p
            role="alert"
            data-testid="sheet-table-warning"
            className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-sm text-warning-text"
          >
            {fill(t.tableWarning, {
              w: mm(stock.sheet.width),
              h: mm(stock.sheet.height),
              tw: mm(profile.table.width),
              td: mm(profile.table.depth),
            })}
          </p>
        ) : null}
      </fieldset>

      {materialHasGrain(kind) ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-fg">{t.grain}</legend>
          <div className="flex flex-wrap gap-2">
            {([0, 90] as const).map((g) => (
              <label
                key={g}
                className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${stock.sheet.grain === g ? 'border-accent-border bg-accent-subtle font-medium text-fg' : 'border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg'}`}
              >
                <input
                  type="radio"
                  name="grain"
                  className="size-4 accent-(--color-accent)"
                  checked={stock.sheet.grain === g}
                  onChange={() => run('setGrain', { grain: g })}
                />
                {g === 0 ? t.grain0 : t.grain90}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-xs text-fg-muted">{t.grainNone}</p>
      )}
    </div>
  );
}

/** Live preview of step 1 (§3.6 "Önizleme canlı şekil alır"): the table with the sheet on it. */
export function SheetPreview({
  t,
  project,
  profile,
}: {
  t: Text;
  project: Project;
  profile: MachineProfile | null;
}) {
  const { sheet } = project.stock;
  const table = profile?.table ?? { width: sheet.width, depth: sheet.height };
  const off = profile?.origin.sheetOffset ?? { x: 0, y: 0 };
  const W = Math.max(table.width, off.x + sheet.width);
  const H = Math.max(table.depth, off.y + sheet.height);
  const pad = Math.max(W, H) * 0.03;
  const fits =
    off.x + sheet.width <= table.width + 0.001 && off.y + sheet.height <= table.depth + 0.001;
  // SVG y grows downwards; the machine frame has Y up (front-left zero, D-019).
  const sy = (y: number, h: number) => H - y - h;
  const label = fill(t.previewLabel, {
    tw: mm(table.width),
    td: mm(table.depth),
    w: mm(sheet.width),
    h: mm(sheet.height),
  });
  const cx = off.x + sheet.width / 2;
  const cy = sy(off.y, sheet.height) + sheet.height / 2;
  const arrow = Math.min(sheet.width, sheet.height) * 0.35;
  const showGrain = materialHasGrain(materialKindOf(project.stock.material));
  return (
    <figure
      className={`${canvasWellClass} flex flex-col gap-3 p-4 sm:p-5`}
      data-testid="sheet-preview"
      data-fits={fits}
    >
      <figcaption className="text-sm font-semibold text-fg">{t.preview}</figcaption>
      <svg
        role="img"
        aria-label={label}
        viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`}
        className="h-auto max-h-[62vh] w-full rounded-lg bg-canvas"
      >
        {profile ? (
          <rect
            x={0}
            y={sy(0, table.depth)}
            width={table.width}
            height={table.depth}
            className="fill-surface stroke-sim-table"
            strokeWidth={W / 300}
            strokeDasharray={`${W / 60} ${W / 120}`}
          />
        ) : null}
        <rect
          x={off.x}
          y={sy(off.y, sheet.height)}
          width={sheet.width}
          height={sheet.height}
          className={fits ? 'fill-sheet stroke-sheet-edge' : 'fill-danger-subtle stroke-danger'}
          strokeWidth={W / 250}
        />
        {showGrain ? (
          <g
            transform={`rotate(${-sheet.grain} ${cx} ${cy})`}
            className="stroke-grain"
            strokeWidth={W / 300}
            fill="none"
          >
            <path
              d={`M ${cx - arrow} ${cy} H ${cx + arrow} M ${cx + arrow - arrow / 5} ${cy - arrow / 6} L ${cx + arrow} ${cy} L ${cx + arrow - arrow / 5} ${cy + arrow / 6} M ${cx - arrow + arrow / 5} ${cy - arrow / 6} L ${cx - arrow} ${cy} L ${cx - arrow + arrow / 5} ${cy + arrow / 6}`}
            />
          </g>
        ) : null}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-fg-muted">
        {profile ? (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-6 border-t-2 border-dashed border-sim-table"
              aria-hidden="true"
            />
            {t.legendTable} {fill(t.preset, { a: mm(table.width), b: mm(table.depth) })}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3.5 rounded-sm border border-sheet-edge bg-sheet"
            aria-hidden="true"
          />
          {t.legendSheet} {fill(t.preset, { a: mm(sheet.width), b: mm(sheet.height) })}
        </span>
      </div>
    </figure>
  );
}
