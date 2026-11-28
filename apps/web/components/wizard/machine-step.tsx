'use client';

import {
  MATERIAL_FAMILIES,
  findMaterialParams,
  kindsOfFamily,
  libraryParamLinks,
  traitsOf,
  materialKindOf,
  profileThicknesses,
  stockFromLibrary,
  type MachineProfile,
  type MaterialFamily,
  type MaterialTraits,
  type MaterialKind,
  type Project,
  type ValidationIssue,
  holdLimitsOf,
  defaultSheet,
  maxSkinThickness,
  stockSheetSizes,
} from '@nittcam/core';
import { Archive, Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Preview3D } from '../preview3d/preview3d';
import { ViewSwitch } from '../preview3d/view-switch';
import type { TableSpec } from '../../lib/preview3d/stage';
import { useView3d } from '../../lib/preview3d/view-memory';
import { fill } from '../../lib/fill';
import { fillRich } from '../../lib/fill-rich';
import { useDirectionText } from '../../lib/direction-context';
import { grainDialLabels } from '../../lib/grain-labels';
import { useMessages } from '../../lib/messages-context';
import { paramFixHref } from '../../lib/machine-form';
import type { MachineDetail, MachineListItem } from '../../lib/machines-api';
import type { MaterialItem } from '../../lib/materials-api';
import { MaterialSwatch } from '../materials/swatch';
import type { Messages } from '../../lib/messages';
import { focusRing } from '../page/page-header';
import {
  Button,
  Checkbox,
  GrainDial,
  Measure,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@nittcam/ui';
import { NumberField } from './number-field';
import { ProfileVersionNotice, versionGap } from './profile-version-notice';

import { canvasWellClass } from './panels';

type Text = Messages['wizard']['machine'];
type MaterialText = Messages['materials'];

const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const mm = (v: number) => mmFormat.format(v);

/**
 * Sheet presets of §3.6 (short × long); stored with the long side along X. Per material from the
 * behaviour table (T342); this is the list of an unknown material.
 */
export const SHEET_PRESETS = traitsOf(null).sheetPresets;

/** Profile thicknesses and the behaviour table's presets, ascending, without repeats. */
export function mergeThicknesses(
  profile: readonly number[],
  traits: Pick<MaterialTraits, 'thicknessPresets'>,
): number[] {
  return [...new Set([...profile, ...traits.thicknessPresets])].sort((a, b) => a - b);
}

/** Picker groups (T342): the families present in the behaviour table, each with its kinds. */
type GroupLabel = 'groupWood' | 'groupPlastic' | 'groupMetal';
const GROUP_LABEL: Record<MaterialFamily, GroupLabel> = {
  woodBoard: 'groupWood',
  plastic: 'groupPlastic',
  // D-130: composite and non-ferrous share one heading, "Metal ve kompozit".
  composite: 'groupMetal',
  nonFerrous: 'groupMetal',
};
const GROUPS = MATERIAL_FAMILIES.reduce<{ label: GroupLabel; kinds: MaterialKind[] }[]>(
  (out, family) => {
    const kinds = kindsOfFamily(family);
    if (kinds.length === 0) return out;
    const label = GROUP_LABEL[family];
    const group = out.find((g) => g.label === label);
    if (group) group.kinds.push(...kinds);
    else out.push({ label, kinds: [...kinds] });
    return out;
  },
  [],
);

type Preset = { a: number; b: number };

function presetIndex(presets: readonly Preset[], sheet: { width: number; height: number }): number {
  return presets.findIndex((p) => sheet.width === p.b && sheet.height === p.a);
}

/** Select value of a library entry (raw kinds use the kind itself). */
const LIB = 'lib:';

/** The library entry the stock was picked from, when it still exists and still matches the kind. */
export function libraryEntryOf(
  library: readonly MaterialItem[],
  stock: Project['stock'],
): MaterialItem | undefined {
  if (stock.libraryId === undefined) return undefined;
  const entry = library.find((m) => m.id === stock.libraryId);
  return entry && entry.kind === materialKindOf(stock.material) ? entry : undefined;
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
  library,
  detail,
  latest,
  issues,
  run,
  returnTo,
  resolveReturnTo,
}: {
  t: Text;
  /** Where "Kesim ayarı ekle" comes back to after saving (this project, step 1; T258). */
  returnTo: string | null;
  /**
   * T264: saves the project first and gives the return path with its id; the link waits for it,
   * so a click right after the first edit of a new project never returns to `/projeler/yeni`.
   */
  resolveReturnTo?: () => Promise<string | null>;
  materials: MaterialText;
  /** Company material library (T121); empty while loading or when it failed. */
  library: readonly MaterialItem[];
  project: Project;
  machines: readonly MachineListItem[];
  /** T269: the profile version the project is bound to (all values on this step come from it). */
  detail: MachineDetail | null;
  /** The machine's latest version, for the "Son sürüme geç" box. */
  latest?: MachineDetail | null;
  issues: readonly ValidationIssue[];
  run: Run;
}) {
  const gap = versionGap(project.machine, latest ?? null);
  const ids = { machine: useId(), material: useId() };
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const { stock } = project;
  const sheet = defaultSheet(project);
  const kind = materialKindOf(stock.material);
  const profile = detail?.profile ?? null;
  const known = machines.some((m) => m.id === project.machine.machineId);
  // P3 (CTO #12): a project bound to a machine archived later says so (T289 keeps it pickable here).
  const archived = machines.some((m) => m.id === project.machine.machineId && m.archived);
  const entry = libraryEntryOf(library, stock);
  // T121: a library pick offers its own thicknesses and sheet sizes; else the profile's and §3.6.
  const presets: readonly Preset[] = entry
    ? entry.sheetSizes.map((s) => ({ a: s.height, b: s.width }))
    : traitsOf(kind).sheetPresets;
  const preset = presetIndex(presets, sheet);
  const [customOpen, setCustomOpen] = useState(false);
  const custom = preset < 0 || customOpen;
  const thicknesses = entry
    ? entry.thicknesses
    : kind
      ? // T346: the profile's thicknesses plus the kind's presets (none for today's kinds).
        mergeThicknesses(profile ? profileThicknesses(profile, kind) : [], traitsOf(kind))
      : [];
  const found = profile ? findMaterialParams(profile, stock) : undefined;
  // T265: unconfirmed starting values do not count as a configured set.
  const unverified = found?.unverified === true;
  const set = unverified ? undefined : found;
  const fix = {
    machineId: project.machine.machineId,
    set: kind ? { material: kind, thickness: stock.thickness } : null,
  };
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
        <Select
          value={known ? project.machine.machineId : undefined}
          onValueChange={(v) => {
            const m = machines.find((x) => x.id === v);
            if (m) run('setMachine', { machineId: m.id, profileVersion: m.version });
          }}
        >
          <SelectTrigger id={ids.machine} data-testid="wizard-machine">
            <SelectValue placeholder={t.choose} />
          </SelectTrigger>
          <SelectContent>
            {machines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {/* T269: the project's machine shows the version the project is bound to. */}
                {fill(t.option, {
                  name: m.name,
                  version:
                    m.id === project.machine.machineId ? project.machine.profileVersion : m.version,
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!known ? <p className="text-xs text-warning-text">{t.unknownMachine}</p> : null}
        {profile ? (
          <p className="text-xs text-fg-muted">
            {fillRich(fill(t.table, { post: `${profile.post.id} ${profile.post.version}` }), {
              size: (
                <Measure value={[profile.table.width, profile.table.depth]} unit={t.units.mm} />
              ),
            })}
          </p>
        ) : null}
        {archived ? (
          <p
            role="note"
            data-testid="machine-archived-notice"
            className="flex items-start gap-2 rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-xs text-info-text"
          >
            <Archive aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{t.archivedNote}</span>
          </p>
        ) : null}
        {/* T199: the unverified-profile notice is the header chip (ProfileStatusChip). */}
        {known && gap !== null ? (
          <ProfileVersionNotice
            t={t}
            machineId={project.machine.machineId}
            version={project.machine.profileVersion}
            latest={gap}
            run={run}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.material} className="text-sm font-medium text-fg">
          {t.material}
        </label>
        <Select
          value={entry ? `${LIB}${entry.id}` : (kind ?? stock.material)}
          onValueChange={(v) => {
            const pick = v.startsWith(LIB) ? library.find((m) => `${LIB}${m.id}` === v) : null;
            if (pick) {
              run('applyLibraryMaterial', { libraryId: pick.id, ...stockFromLibrary(pick, stock) });
              setCustomOpen(false);
            } else run('setMaterial', { material: v });
          }}
        >
          <SelectTrigger
            id={ids.material}
            data-testid="wizard-material"
            data-value={kind ?? stock.material}
            data-library-id={entry?.id}
          >
            {/* T259: a library pick shows on one line (swatch, "MDF · 18 mm"), never clipped. */}
            <SelectValue>
              {entry ? (
                <span
                  className="flex min-w-0 items-center gap-2"
                  data-testid="wizard-material-value"
                >
                  <MaterialSwatch tone={entry.tone} />
                  <span className="truncate">
                    {fill(t.libraryValue, { name: entry.name, thickness: mm(stock.thickness) })}
                  </span>
                </span>
              ) : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {library.length > 0 ? (
              <>
                <SelectGroup data-testid="wizard-material-library">
                  <SelectLabel>{t.libraryGroup}</SelectLabel>
                  {library.map((m) => {
                    // T257: an entry this machine cannot cut is marked before it is picked.
                    const cuttable =
                      !profile || libraryParamLinks(m, profile).some((l) => l.params !== undefined);
                    return (
                      <SelectItem
                        key={m.id}
                        value={`${LIB}${m.id}`}
                        data-no-params={cuttable ? undefined : ''}
                      >
                        <span className="flex items-center gap-2">
                          <MaterialSwatch tone={m.tone} />
                          {m.name}
                        </span>
                        <span className="ml-2 text-xs text-fg-muted tabular-nums">
                          {fill(t.libraryThicknesses, { list: m.thicknesses.map(mm).join(' · ') })}
                        </span>
                        {cuttable ? null : (
                          <span
                            className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-warning-text"
                            data-testid="library-no-params"
                          >
                            <TriangleAlert aria-hidden className="size-3.5" />
                            {t.libraryNoParams}
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
                <SelectSeparator />
              </>
            ) : null}
            {kind === null ? (
              <SelectItem value={stock.material}>
                {fill(materials.unknown, { id: stock.material })}
              </SelectItem>
            ) : null}
            {library.length > 0 ? (
              // T259 (review #4 K7): with a library, the generic kinds sit under one heading.
              <SelectGroup data-testid="wizard-material-generic">
                <SelectLabel>{t.genericGroup}</SelectLabel>
                {GROUPS.flatMap((g) => g.kinds).map((k) => (
                  <SelectItem key={k} value={k}>
                    {materialName(k)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : (
              GROUPS.map((g) => (
                <SelectGroup key={g.label} data-testid={`wizard-material-${g.label}`}>
                  <SelectLabel>{materials[g.label]}</SelectLabel>
                  {g.kinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {materialName(k)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))
            )}
            <SelectSeparator />
            <SelectItem value="__stone" disabled>
              {materials.stone}
            </SelectItem>
            {/* D-118: steel and stainless are permanently out; shown disabled so nobody hunts. */}
            <SelectItem value="__steel" disabled>
              {materials.steel}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <NumberField
          label={t.thickness}
          value={stock.thickness}
          testId="wizard-thickness"
          errors={errors}
          onCommit={(thickness) => run('setThickness', { thickness })}
        />
        {/* P3 (CTO #5): the chip row only when there is a choice (not one chip = the value). */}
        {thicknesses.some((v) => v !== stock.thickness) ? (
          <>
            {/* T259: the chips are the list; no native datalist arrow next to the number. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-fg-muted">
                {fill(entry ? t.libraryThicknessHint : t.thicknessHint, {
                  list: thicknesses.map(mm).join(', '),
                })}
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
        ) : null}
        {/* B53 (CTO #5): no "no thicknesses" line here; the red box below says it once. */}
        {profile && !set ? (
          <div
            role="alert"
            data-testid="no-cutting-params"
            className="flex flex-col items-start gap-2.5 rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm text-danger-text"
          >
            <p>
              {fill(unverified ? t.unverifiedParams : t.noParams, {
                material: kind ? materialName(kind) : stock.material,
                thickness: mm(stock.thickness),
              })}
            </p>
            {/* D-045: one action that leads to the fix and back (T258). */}
            <Button asChild size="sm" variant="outline">
              <Link
                data-testid="add-cutting-params"
                aria-busy={leaving || undefined}
                href={paramFixHref({ ...fix, returnTo })}
                onClick={(e) => {
                  if (!resolveReturnTo || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey)
                    return;
                  e.preventDefault();
                  if (leaving) return;
                  setLeaving(true);
                  void resolveReturnTo().then(
                    (back) => router.push(paramFixHref({ ...fix, returnTo: back })),
                    () => setLeaving(false),
                  );
                }}
              >
                {unverified ? null : <Plus aria-hidden />}
                {unverified ? t.verifyParams : t.addParams}
              </Link>
            </Button>
          </div>
        ) : null}
        {set ? (
          <p className="text-xs text-fg-muted" data-testid="cutting-params">
            {fillRich(fill(t.paramsOk, { tool: set.tool }), {
              feed: <Measure value={set.feed} unit={t.units.feed} maxDecimals={0} />,
              rpm: <Measure value={set.rpm} unit={t.units.rpm} maxDecimals={0} />,
              step: <Measure value={set.stepDown} unit={t.units.mm} />,
            })}
          </p>
        ) : null}
        {/* B53 (CTO #5, D-122): the thin skin is part of the cutting settings; with no set for this
            material it waits (unless already on), so the red box does not push the sheet size
            under the footer at 1440 × 900. */}
        {set || project.cutting.skin ? (
          <ThinSkin t={t} project={project} errors={errors} run={run} />
        ) : null}
        <MachinedFace t={t} project={project} run={run} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-fg">{t.sheet}</legend>
        <div className="flex flex-wrap gap-2">
          {presets.map((p, i) => {
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
              value={sheet.width}
              testId="wizard-sheet-width"
              errors={errors}
              onCommit={(width) => run('setSheetSize', { width, height: sheet.height })}
            />
            <NumberField
              label={t.height}
              value={sheet.height}
              testId="wizard-sheet-height"
              errors={errors}
              onCommit={(height) => run('setSheetSize', { width: sheet.width, height })}
            />
          </div>
        ) : null}
        {entry && entry.sheetSizes.length > 1 ? (
          <SheetSizesPick t={t} project={project} library={entry.sheetSizes} run={run} />
        ) : null}
        {tableIssue && profile ? (
          <p
            role="alert"
            data-testid="sheet-table-warning"
            className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-sm text-warning-text"
          >
            {fill(t.tableWarning, {
              w: mm(sheet.width),
              h: mm(sheet.height),
              tw: mm(profile.table.width),
              td: mm(profile.table.depth),
            })}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

/**
 * Sheet grain block (spec §3.6 "Damar yönü", T252): sits in the Önizleme card right under the
 * sheet preview (dial left, angle input and presets right), so both are seen together.
 */
/** Default skin left under small parts when the option is switched on, mm (T143). */
const SKIN_DEFAULT = 0.5;

/**
 * T143: "Son pasoda ince tabaka bırak" — small parts keep a thin skin instead of tabs; a cleanup
 * pass at the end of each sheet cuts it through. Tabs and skin are alternatives per project.
 */
type LibrarySize = { width: number; height: number; qty?: number | undefined };

/**
 * T164: further library sheet sizes the nesting may use besides the chosen sheet (always used and
 * listed first). One `setStockSheets` per change, so every tick is one undo step.
 */
function SheetSizesPick({
  t,
  project,
  library,
  run,
}: {
  t: Text;
  project: Project;
  library: readonly LibrarySize[];
  run: Run;
}) {
  const id = useId();
  const sheet = defaultSheet(project);
  const listed = stockSheetSizes(project);
  const same = (a: { width: number; height: number }, b: { width: number; height: number }) =>
    a.width === b.width && a.height === b.height;
  const isDefault = (s: LibrarySize) => same(s, sheet);
  const isOn = (s: LibrarySize) => isDefault(s) || listed.some((l) => same(l, s));
  const toggle = (s: LibrarySize, on: boolean) => {
    const first = library.find(isDefault) ?? { width: sheet.width, height: sheet.height };
    const rest = library.filter((x) => !isDefault(x) && (same(x, s) ? on : isOn(x)));
    const sheets = [first, ...rest].map((x) => ({
      width: x.width,
      height: x.height,
      ...(x.qty !== undefined ? { qty: x.qty } : {}),
    }));
    run('setStockSheets', { sheets });
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid="wizard-sheet-sizes">
      <p className="text-sm font-medium text-fg" id={`${id}-label`}>
        {t.sheetsMulti}
      </p>
      <p className="text-xs text-fg-muted" id={`${id}-hint`}>
        {t.sheetsMultiHint}
      </p>
      <ul
        className="flex flex-col gap-1.5"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
      >
        {library.map((s, i) => {
          const box = `${id}-${i}`;
          return (
            <li key={`${s.width}x${s.height}`} className="flex min-h-8 items-center gap-2 text-sm">
              <Checkbox
                id={box}
                checked={isOn(s)}
                disabled={isDefault(s)}
                onCheckedChange={(v) => toggle(s, v === true)}
              />
              <label htmlFor={box} className="text-fg tabular-nums">
                {fill(t.sheetsOption, { w: mm(s.width), h: mm(s.height) })}
                <span className="ml-1.5 text-xs text-fg-muted">
                  {isDefault(s)
                    ? t.sheetsDefault
                    : s.qty !== undefined
                      ? fill(t.sheetsStock, { n: String(s.qty) })
                      : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * T348 (§3.6 "İşlenen yüz"): "Arka yüzden işle". Shown for materials machined from the back by
 * default (composite panels) and whenever a project is already set to the back face.
 */
function MachinedFace({ t, project, run }: { t: Text; project: Project; run: Run }) {
  const id = useId();
  const hintId = useId();
  const back = project.stock.machinedFace === 'back';
  if (!back && traitsOf(materialKindOf(project.stock.material)).machinedFace !== 'back') {
    return null;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="machined-face">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={back}
          aria-describedby={hintId}
          data-testid="machined-face-switch"
          onCheckedChange={(on) => run('setMachinedFace', { face: on ? 'back' : 'front' })}
        />
        <label htmlFor={id} className="text-sm text-fg">
          {t.face.label}
        </label>
      </div>
      <p id={hintId} className="text-xs text-fg-muted">
        {t.face.hint}
      </p>
    </div>
  );
}

function ThinSkin({
  t,
  project,
  errors,
  run,
}: {
  t: Text;
  project: Project;
  errors: { number: string; positive: string; rejected: string };
  run: Run;
}) {
  const id = useId();
  const skin = project.cutting.skin;
  // T298 (CTO #12 A, D-083): the skin that still holds a part, said in the field.
  // T343: the bounds of the stock material (traits row)
  const limits = holdLimitsOf(project.stock.material);
  const skinMin = limits.skin.min;
  const max = maxSkinThickness(project.stock.thickness, limits);
  const fmt = (v: number) => String(v).replace('.', ',');
  const noSkin = max < skinMin;
  const noneId = useId();
  return (
    <div className="flex flex-col gap-2" data-testid="thin-skin">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={skin !== undefined}
          // B53 (D-083 bounds): on a sheet too thin for any skin the switch cannot turn on; the
          // reason stands under it instead of a silent refusal.
          disabled={noSkin && skin === undefined}
          aria-describedby={noSkin ? noneId : undefined}
          data-testid="thin-skin-switch"
          onCheckedChange={(on) =>
            run('setThinSkin', {
              thickness: on ? Math.min(SKIN_DEFAULT, project.stock.thickness / 2) : null,
            })
          }
        />
        <label
          htmlFor={id}
          className={`text-sm ${noSkin && skin === undefined ? 'text-fg-muted' : 'text-fg'}`}
        >
          {t.skin.label}
        </label>
      </div>
      <p className="text-xs text-fg-muted">{t.skin.hint}</p>
      {noSkin ? (
        <p
          id={noneId}
          className={`text-xs ${skin ? 'text-danger-text' : 'text-fg-muted'}`}
          data-testid="thin-skin-none"
        >
          {fill(t.skin.none, {
            t: fmt(project.stock.thickness),
            min: fmt(skinMin),
            below: fmt(limits.skin.belowThickness),
          })}
        </p>
      ) : null}
      {skin ? (
        <NumberField
          label={t.skin.thickness}
          unit={t.units.mm}
          value={skin.thickness}
          testId="thin-skin-thickness"
          errors={errors}
          bounds={{
            min: skinMin,
            max,
            message: fill(t.skin.bounds, { min: fmt(skinMin), max: fmt(max) }),
          }}
          onCommit={(thickness) => run('setThinSkin', { thickness })}
        />
      ) : null}
    </div>
  );
}

export function SheetGrain({
  t,
  project,
  run,
  onGrainPreview,
}: {
  t: Text;
  project: Project;
  run: Run;
  onGrainPreview?: (angle: number | null) => void;
}) {
  const grainText = useMessages().grainDial;
  const direction = useDirectionText();
  const { stock } = project;
  const sheet = defaultSheet(project);
  if (traitsOf(materialKindOf(stock.material)).direction.kind === 'none') {
    return (
      <p className="text-xs text-fg-muted" data-testid="sheet-grain-none">
        {t.grainNone}
      </p>
    );
  }
  // T259: a wood stock without grain ("Yok", e.g. library MDF): say so; one click gives it one.
  if (sheet.grain === null) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="sheet-grain-off">
        <p className="text-xs text-fg-muted">{t.grainOff}</p>
        <button
          type="button"
          data-testid="sheet-grain-on"
          onClick={() => run('setGrain', { grain: 0 })}
          className={`h-control-sm rounded-md border border-border-strong bg-surface px-2.5 text-xs font-medium text-fg shadow-xs hover:bg-surface-hover ${focusRing}`}
        >
          {t.grainOn}
        </button>
      </div>
    );
  }
  return (
    <fieldset className="flex flex-col gap-2" data-testid="sheet-grain">
      <legend className="mb-1.5 text-sm font-medium text-fg">{direction.title}</legend>
      <GrainDial
        value={sheet.grain}
        onValueChange={(a) => onGrainPreview?.(a)}
        onValueCommit={(a) => {
          onGrainPreview?.(null);
          if (a !== sheet.grain) run('setGrain', { grain: a });
        }}
        labels={grainDialLabels(grainText, { direction })}
        data-testid="sheet-grain-dial"
      />
    </fieldset>
  );
}

/** Live preview of step 1 (§3.6 "Önizleme canlı şekil alır"): the table with the sheet on it. */
export function SheetPreview({
  t,
  project,
  profile,
  grainPreview = null,
  footer,
  view3d,
}: {
  t: Text;
  project: Project;
  profile: MachineProfile | null;
  grainPreview?: number | null;
  /** Shown under the legend (T252: the sheet grain dial). */
  footer?: ReactNode;
  /** T160: 2D / 3D switch; the 3D view shows the empty sheet on the table (§3.6). */
  view3d?: { t: Messages['layout']['preview3d']; table: TableSpec | null };
}) {
  const { mode, show3d, noWebGL, camera, chooseMode, preset, fallback } = useView3d(
    view3d !== undefined,
  );
  const { sheet } = project.stock;
  // While the grain dial is dragged the preview follows the live angle (T116).
  const grain = grainPreview ?? sheet.grain;
  const table = profile?.table ?? { width: sheet.width, depth: sheet.height };
  const off = profile?.origin.sheetOffset ?? { x: 0, y: 0 };
  const W = Math.max(table.width, off.x + sheet.width);
  const H = Math.max(table.depth, off.y + sheet.height);
  const pad = Math.max(W, H) * 0.07;
  const fs = Math.max(W, H) / 55;
  const margin = Math.max(0, project.nesting.margin);
  const patternId = `grain-${Math.round(sheet.width)}-${Math.round(sheet.height)}`;
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
  // T259: no hatch on a sheet without grain (the dial block says so).
  const showGrain =
    traitsOf(materialKindOf(project.stock.material)).direction.kind !== 'none' && grain !== null;
  // The 3D sheet step shows the stock alone (a layout may be stale here) with the live grain.
  const sheetOnly = useMemo<Project>(
    () => ({
      ...project,
      stock: { ...project.stock, sheet: { ...sheet, grain } },
      layout: { ...project.layout, sheets: [] },
    }),
    [project, sheet, grain],
  );
  return (
    <figure
      className={`${canvasWellClass} flex flex-col gap-3 p-4 sm:p-5`}
      data-testid="sheet-preview"
      data-fits={fits}
    >
      <figcaption className="flex items-center justify-between gap-2 text-sm font-semibold text-fg">
        {t.preview}
        {view3d ? <ViewSwitch t={view3d.t} mode={mode} onChoose={chooseMode} /> : null}
      </figcaption>
      {show3d && view3d ? (
        <div
          className="relative aspect-4/3 max-h-[62vh] w-full overflow-hidden rounded-lg"
          data-testid="sheet-preview-3d"
        >
          <Preview3D
            t={view3d.t}
            project={sheetOnly}
            sheet={0}
            table={view3d.table}
            command={camera}
            onPreset={preset}
            onFallback={fallback}
            partCount={0}
          />
        </div>
      ) : (
        <svg
          role="img"
          aria-label={label}
          viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`}
          className={`h-auto w-full rounded-lg bg-canvas ${footer ? 'max-h-[62vh] lg:max-h-[calc(100dvh-34rem)] lg:min-h-48' : 'max-h-[62vh]'}`}
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
            <>
              {/* Grain as a fine line texture along the grain direction (T196). */}
              <defs>
                <pattern
                  id={patternId}
                  width={W / 70}
                  height={W / 70}
                  patternUnits="userSpaceOnUse"
                  patternTransform={`rotate(${-(grain ?? 0)} ${cx} ${cy})`}
                >
                  <line
                    x1={0}
                    y1={W / 140}
                    x2={W / 70}
                    y2={W / 140}
                    className="stroke-grain"
                    strokeWidth={W / 900}
                  />
                </pattern>
              </defs>
              <rect
                data-testid="sheet-preview-grain"
                data-angle={grain ?? undefined}
                x={off.x}
                y={sy(off.y, sheet.height)}
                width={sheet.width}
                height={sheet.height}
                fill={`url(#${patternId})`}
              />
            </>
          ) : null}
          {margin > 0 && sheet.width > 2 * margin && sheet.height > 2 * margin ? (
            <rect
              data-testid="sheet-preview-margin"
              x={off.x + margin}
              y={sy(off.y, sheet.height) + margin}
              width={sheet.width - 2 * margin}
              height={sheet.height - 2 * margin}
              fill="none"
              className="stroke-fg-subtle"
              strokeWidth={W / 700}
              strokeDasharray={`${W / 150} ${W / 200}`}
            />
          ) : null}
          {/* Real size on the top and left edges, mono (T196). */}
          <g className="fill-fg-muted font-mono" fontSize={fs} data-testid="sheet-preview-dims">
            <text x={cx} y={sy(off.y, sheet.height) - fs * 0.6} textAnchor="middle">
              {mm(sheet.width)}
            </text>
            <text
              x={off.x - fs * 0.6}
              y={cy}
              textAnchor="middle"
              transform={`rotate(-90 ${off.x - fs * 0.6} ${cy})`}
            >
              {mm(sheet.height)}
            </text>
          </g>
          {profile ? (
            <text
              x={fs * 0.4}
              y={sy(0, table.depth) + fs * 1.2}
              fontSize={fs * 0.9}
              className="fill-fg-subtle"
            >
              {t.legendTable}
            </text>
          ) : null}
          {/* Origin marker: machine zero, X right and Y up. */}
          <g className="stroke-accent-text" strokeWidth={W / 400} fill="none">
            <path d={`M 0 ${H} H ${fs * 2.2} M 0 ${H} V ${H - fs * 2.2}`} />
            <circle cx={0} cy={H} r={fs * 0.3} className="fill-accent-text" />
          </g>
        </svg>
      )}
      {noWebGL && !show3d && view3d ? (
        <p role="status" data-testid="preview3d-fallback" className="text-sm text-fg-muted">
          {noWebGL === 'slow' ? view3d.t.fallbackSlow : view3d.t.fallback}
        </p>
      ) : null}
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
      {footer ? <div className="border-t border-border-subtle pt-3">{footer}</div> : null}
    </figure>
  );
}
