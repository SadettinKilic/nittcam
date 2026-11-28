import {
  hasVGeometry,
  PROFILE_BOUNDS,
  startingValueRow,
  toolTypeAllowed,
  type MachineProfile,
  type Tool,
} from '@nittcam/core';

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
  return withTool(profile, SAMPLE_V_BIT);
}

/**
 * T425 (CTO #15 M3): the example contour cutter "Örnek ACM ayarlarını ekle" adds when no tool of
 * the machine has an ACM row in the starting-value table: a single-flute O-flute Ø6, so the example
 * ACM sets get researched values (2000 / 500 / 18 000 / 4) instead of empty fields.
 */
export const SAMPLE_ACM_CUTTER = {
  type: 'flatEndMill',
  diameter: 6,
  fluteLength: 12,
  flutes: 1,
} as const satisfies Omit<Tool, 'number'>;

/** True when the tool may cut ACM and the starting-value table has an ACM row for it. */
export function hasAcmStartingRow(tool: Tool): boolean {
  return toolTypeAllowed('acm', 'outer', tool.type) && startingValueRow('acm', tool) !== undefined;
}

/** T425: the profile with `SAMPLE_ACM_CUTTER`, unless a tool already has an ACM starting row. */
export function withSampleAcmCutter(profile: MachineProfile): {
  profile: MachineProfile;
  added: boolean;
} {
  if (profile.tools.some(hasAcmStartingRow)) return { profile, added: false };
  return withTool(profile, SAMPLE_ACM_CUTTER);
}

function withTool(
  profile: MachineProfile,
  tool: Omit<Tool, 'number'>,
): { profile: MachineProfile; added: boolean } {
  const used = new Set(profile.tools.map((t) => t.number));
  let number = PROFILE_BOUNDS.toolNumber.min;
  while (used.has(number) && number < PROFILE_BOUNDS.toolNumber.max) number++;
  if (used.has(number)) return { profile, added: false };
  return { profile: { ...profile, tools: [...profile.tools, { number, ...tool }] }, added: true };
}
