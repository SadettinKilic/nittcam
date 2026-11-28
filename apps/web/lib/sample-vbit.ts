import { hasVGeometry, PROFILE_BOUNDS, type MachineProfile, type Tool } from '@nittcam/core';

/**
 * B70 rider: the example V-bit "Örnek ACM ayarlarını ekle" adds when the machine has no V-bit with
 * an angle: 90°, Ø12, 0,2 mm tip, so an ACM tray (V-grooves) can be planned on a new machine. A
 * starting value like the example sets: the user checks it against the real bit.
 */
export const SAMPLE_V_BIT = {
  type: 'vBit',
  diameter: 12,
  fluteLength: 10,
  flutes: 2,
  angleDeg: 90,
  tipDiameter: 0.2,
} as const satisfies Omit<Tool, 'number'>;

/** The profile with `SAMPLE_V_BIT` at the next free tool number, unless it has a V-bit already. */
export function withSampleVBit(profile: MachineProfile): {
  profile: MachineProfile;
  added: boolean;
} {
  if (profile.tools.some(hasVGeometry)) return { profile, added: false };
  const used = new Set(profile.tools.map((t) => t.number));
  let number = PROFILE_BOUNDS.toolNumber.min;
  while (used.has(number) && number < PROFILE_BOUNDS.toolNumber.max) number++;
  if (used.has(number)) return { profile, added: false };
  return {
    profile: { ...profile, tools: [...profile.tools, { number, ...SAMPLE_V_BIT }] },
    added: true,
  };
}
