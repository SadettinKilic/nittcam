/** Pure helpers of the machine profile form (spec §7.1, T107). */
import {
  MATERIAL_KINDS,
  type MachineProfile,
  type MaterialKind,
  type MaterialParams,
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
 * A new parameter set as the form's "Ekle" adds it (T107): the given kind and thickness, the
 * form's starting values for feed, plunge, rpm (clamped to the spindle) and step-down, and the
 * profile's first tool. The user reviews and saves it; nothing is written without the form.
 * T265: the step-down never exceeds the sheet thickness (5 mm acrylic starts at 5, not 6).
 */
export const START_STEP_DOWN = 6;

export function newParamSet(
  profile: Pick<MachineProfile, 'spindle' | 'tools'>,
  material: MaterialKind = 'mdf',
  thickness = 18,
): MaterialParams {
  return {
    material,
    thickness,
    feed: 5000,
    plungeFeed: 1500,
    rpm: Math.min(Math.max(18000, profile.spindle.minRpm), profile.spindle.maxRpm),
    stepDown: thickness > 0 ? Math.min(START_STEP_DOWN, thickness) : START_STEP_DOWN,
    tool: profile.tools[0]?.number ?? 1,
  };
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
}

export function paramFixHref(fix: ParamFix): string {
  const q = new URLSearchParams({ duzenle: fix.machineId });
  if (fix.set) q.set('ayar', `${fix.set.material}-${fix.set.thickness}`);
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
  return { machineId, set, returnTo: safeReturnPath(one('donus')) };
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
      // T265: generic starting values, marked until the user confirms or edits the row.
      materials: [
        ...profile.materials,
        { ...newParamSet(profile, set.material, set.thickness), unverified: true },
      ],
    },
    index: profile.materials.length,
    added: true,
  };
}
