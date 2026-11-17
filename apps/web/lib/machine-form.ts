/** Pure helpers of the machine profile form (spec §7.1, T107). */
import type { MachineProfile } from '@nittcam/core';
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
