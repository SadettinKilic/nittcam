/** Pure helpers of the machine profile form (spec §7.1, T107). */
import {
  MATERIAL_KINDS,
  startingValueSourceNames,
  suggestCuttingSet,
  toolFitHint,
  type CuttingSuggestion,
  type StartingNoteKey,
  type ToolFitHint,
  type MachineProfile,
  type MaterialKind,
  type MaterialParams,
  toolTypeAllowed,
} from '@nittcam/core';
import type { NumberParseError } from '@nittcam/ui';
import type { Messages } from './messages';

/** Form sections in page order; also the side index and the `#sec-<id>` anchors. */
export const FORM_SECTIONS = [
  'identity',
  'envelope',
  'origin',
  'zZero',
  'spindle',
  'toolChanger',
  'holdDown',
  'post',
  'constraints',
  // T345: coolant, metal declaration, clamp height
  'metal',
  'tools',
  'materials',
] as const;
export type FormSection = (typeof FORM_SECTIONS)[number];

/** JSON with sorted object keys, so key order never counts as a change. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

/** True when the edited profile differs from the one the form was opened with. */
export function isDirty(initial: MachineProfile, current: MachineProfile): boolean {
  return canonical(initial) !== canonical(current);
}

/** Turkish text for a number the user is still typing (NumberInput parse state). */
export function parseErrorText(
  code: NumberParseError,
  t: Pick<Messages['machines']['errors'], 'required' | 'number'>,
): string {
  return code === 'empty' ? t.required : t.number;
}

/**
 * T265: the step-down never exceeds the sheet thickness. Kept for callers; the starting values now
 * come from the built-in table (T327, D-120).
 */
export const START_STEP_DOWN = 6;

type StartingFields = Pick<MaterialParams, 'feed' | 'plungeFeed' | 'rpm' | 'stepDown'>;

/**
 * The built-in starting values (T327, D-120) for `material` at `thickness` with the profile's
 * tool `toolNumber` on its spindle, or undefined when the table has no row (or the tool is not in
 * the profile). Never a guess.
 */
export function startingSuggestion(
  profile: Pick<MachineProfile, 'spindle' | 'tools'>,
  material: MaterialKind,
  thickness: number,
  toolNumber: number,
): CuttingSuggestion | undefined {
  const tool = profile.tools.find((x) => x.number === toolNumber);
  if (!tool) return undefined;
  return suggestCuttingSet(material, thickness, tool, profile.spindle);
}

/** The four value fields of a suggestion, or empty fields (NaN) when there is none (T328). */
function startingFields(s: CuttingSuggestion | undefined): StartingFields {
  return s
    ? { feed: s.feed, plungeFeed: s.plungeFeed, rpm: s.rpm, stepDown: s.stepDown }
    : { feed: NaN, plungeFeed: NaN, rpm: NaN, stepDown: NaN };
}

/**
 * The tool a new set starts with (PO B61): the first tool of the profile that suits the material
 * per the table (a row exists and no fit hint, e.g. the single-flute for acrylic and PVC, the
 * compression for melamine); else the first tool that has a table row for the material (filled,
 * with the fit hint; e.g. melamine on a two-flute spiral); only then the first tool (empty fields).
 */
export function suitingTool(
  profile: Pick<MachineProfile, 'spindle' | 'tools'>,
  material: MaterialKind,
  thickness: number,
): number {
  const fit = profile.tools.find(
    (t) =>
      toolFitHint(material, t) === null &&
      suggestCuttingSet(material, thickness, t, profile.spindle) !== undefined,
  );
  const withRow =
    fit ??
    profile.tools.find(
      (t) => suggestCuttingSet(material, thickness, t, profile.spindle) !== undefined,
    );
  // T349: never a tool type the material may not be cut with when another tool exists (no
  // compression for ACM / aluminium); with no allowed tool, the first one (validation says it).
  const allowed = profile.tools.find((t) => toolTypeAllowed(material, 'outer', t.type));
  return (withRow ?? allowed ?? profile.tools[0])?.number ?? 1;
}

/**
 * A new parameter set as the form's "Ekle" and the "Kesim ayarı ekle" flow add it (T107, T258):
 * the given kind and thickness, the first tool of the profile that suits the material (PO B61;
 * `suitingTool`), and the built-in starting values for
 * them (T328, D-120): always marked unverified until the user confirms or edits the row. No table
 * row → the value fields start empty (the form asks for them), never fixed numbers.
 */
export function newParamSet(
  profile: Pick<MachineProfile, 'spindle' | 'tools'>,
  material: MaterialKind = 'mdf',
  thickness = 18,
): MaterialParams {
  const tool = suitingTool(profile, material, thickness);
  return {
    material,
    thickness,
    ...startingFields(startingSuggestion(profile, material, thickness, tool)),
    tool,
    unverified: true,
  };
}

/**
 * T328: a starting-value row (unverified, not yet edited by hand) after its kind, thickness or tool
 * changed: the values follow the new choice. A row the user edited (no `unverified` mark) is never
 * overwritten; the caller only changes the chosen field then.
 */
export function refreshStartingValues(
  profile: Pick<MachineProfile, 'spindle' | 'tools'>,
  set: MaterialParams,
): void {
  if (!set.unverified) return;
  Object.assign(
    set,
    startingFields(startingSuggestion(profile, set.material, set.thickness, set.tool)),
  );
  delete set.copiedFrom;
}

/** What the form says under a starting-value row (T328). */
export type StartingNote =
  | { kind: 'table'; sources: string; note: StartingNoteKey | null; hint: ToolFitHint | null }
  | { kind: 'none'; hint: ToolFitHint | null }
  | { kind: 'other'; note: StartingNoteKey | null; hint: ToolFitHint | null };

/**
 * The note of an unverified row: "table" when its values are exactly the built-in suggestion,
 * "none" when the table has no row for it, "other" for older starting values (T265) or a copy.
 */
export function startingNote(
  profile: Pick<MachineProfile, 'spindle' | 'tools'>,
  set: MaterialParams,
): StartingNote {
  const tool = profile.tools.find((x) => x.number === set.tool);
  const hint = tool ? toolFitHint(set.material, tool) : null;
  const s = startingSuggestion(profile, set.material, set.thickness, set.tool);
  if (!s) return { kind: 'none', hint };
  const same =
    s.feed === set.feed &&
    s.plungeFeed === set.plungeFeed &&
    s.rpm === set.rpm &&
    s.stepDown === set.stepDown;
  const note = s.row.note ?? null;
  return same
    ? { kind: 'table', sources: startingValueSourceNames(s.row).join(', '), note, hint }
    : { kind: 'other', note, hint };
}

/**
 * "Kesim ayarı ekle" (T258, D-045): the step 1 error box opens the machine form with a new set
 * for the stock and a way back to the project. Query: `duzenle` = machine id, `ayar` =
 * `<kind>-<thickness>`, `donus` = the project path to return to (same-origin paths only).
 */
export interface ParamFix {
  machineId: string;
  set: { material: MaterialKind; thickness: number } | null;
  returnTo: string | null;
  /**
   * T302: `alan=kopru` lands on the set's tab fields instead of its feed; T349: `alan=metal` on the
   * machine's metal section (coolant, metal declaration).
   */
  field?: 'tabs' | 'metal' | null;
}

export function paramFixHref(fix: ParamFix): string {
  const q = new URLSearchParams({ duzenle: fix.machineId });
  if (fix.set) q.set('ayar', `${fix.set.material}-${fix.set.thickness}`);
  if (fix.field === 'tabs') q.set('alan', 'kopru');
  if (fix.field === 'metal') q.set('alan', 'metal');
  if (fix.returnTo) q.set('donus', fix.returnTo);
  return `/makineler?${q.toString()}`;
}

/** A safe in-app return path: starts with one `/`, never `//` or a scheme. */
export function safeReturnPath(value: string | undefined | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return null;
  return value;
}

export function parseParamFix(q: Record<string, string | string[] | undefined>): ParamFix | null {
  const one = (k: string) => (typeof q[k] === 'string' ? q[k] : undefined);
  const machineId = one('duzenle');
  if (!machineId) return null;
  let set: ParamFix['set'] = null;
  const m = /^([A-Za-z]+)-(\d+(?:\.\d+)?)$/.exec(one('ayar') ?? '');
  if (m) {
    const material = m[1] as MaterialKind;
    const thickness = Number(m[2]);
    if ((MATERIAL_KINDS as readonly string[]).includes(material) && thickness > 0)
      set = { material, thickness };
  }
  return {
    machineId,
    set,
    returnTo: safeReturnPath(one('donus')),
    field: one('alan') === 'kopru' ? 'tabs' : one('alan') === 'metal' ? 'metal' : null,
  };
}

/**
 * The profile with a new set for `set` appended, and the set's row index; when the profile already
 * has a set for that kind and thickness, the profile unchanged and that row's index.
 */
export function withParamSet(
  profile: MachineProfile,
  set: { material: MaterialKind; thickness: number },
): { profile: MachineProfile; index: number; added: boolean } {
  const existing = profile.materials.findIndex(
    (m) => m.material === set.material && Math.abs(m.thickness - set.thickness) <= 1e-6,
  );
  if (existing >= 0) return { profile, index: existing, added: false };
  return {
    profile: {
      ...profile,
      // T265 / T328: starting values from the table, marked until the user confirms or edits.
      materials: [...profile.materials, newParamSet(profile, set.material, set.thickness)],
    },
    index: profile.materials.length,
    added: true,
  };
}
