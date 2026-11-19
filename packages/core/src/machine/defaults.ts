/**
 * Example profile "Genel düz G-code router" (spec §7.1 machine library; D-016). It is marked
 * `example: true`: the values are typical, not measured, and the user must check them against
 * the real machine and verify it (§7.3) before production.
 */
import {
  MACHINE_PROFILE_SCHEMA_VERSION,
  machineProfileSchema,
  type MachineProfile,
} from './profile';

/** Name of the seeded example profile (data, shown as is). */
export const DEFAULT_PROFILE_NAME = 'Genel düz G-code router';

const DEFAULT_PROFILE_INPUT = {
  schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
  example: true,
  identity: {
    name: DEFAULT_PROFILE_NAME,
    brand: '',
    model: '',
    controller: { family: 'Genel G-code', version: '' },
    notes: '',
  },
  workEnvelope: { x: 2500, y: 1300, z: 150 },
  table: { width: 2440, depth: 1220 },
  origin: {
    corner: 'frontLeft',
    xPositive: 'right',
    yPositive: 'back',
    sheetOffset: { x: 0, y: 0 },
  },
  zZero: { reference: 'materialTop', spoilboardAllowance: 0.5 },
  safeZ: 20,
  rapidFeed: 10000,
  spindle: { powerKw: 3, minRpm: 6000, maxRpm: 24000, warmupSeconds: 5 },
  toolChanger: { type: 'manual', capacity: 1, lengthCompensation: false },
  holdDown: { type: 'vacuum', vacuumOn: 'M7', vacuumOff: 'M9' },
  post: { id: 'generic', version: '1.0' },
  constraints: {
    maxFileNameLength: 32,
    maxFileSizeMb: 10,
    arcs: true,
    lineNumbers: false,
    drillCycles: false,
  },
  tools: [
    { number: 1, type: 'flatEndMill', diameter: 6, fluteLength: 22, flutes: 2 },
    { number: 2, type: 'flatEndMill', diameter: 8, fluteLength: 25, flutes: 2 },
  ],
  materials: [
    // Typical MDF 18 mm with the 8 mm two-flute end mill: 3 passes of 6 mm.
    {
      material: 'mdf',
      thickness: 18,
      feed: 6000,
      plungeFeed: 1500,
      rpm: 18000,
      stepDown: 6,
      tool: 2,
    },
  ],
} as const;

/**
 * A fresh copy of the generic example profile (validated, so a bad edit here fails the tests).
 * It was the seeded example until T020 and stays **frozen**: the golden files, many tests and the
 * legacy-seed detection (`isLegacyExampleProfile`) depend on it. Its generic post writes
 * automatic `T M6` while its changer is manual, so it cannot export (D-028).
 */
export function defaultMachineProfile(): MachineProfile {
  return machineProfileSchema.parse(JSON.parse(JSON.stringify(DEFAULT_PROFILE_INPUT)));
}

/** Name of the seeded example machine since T020 (data, shown as is). */
export const EXAMPLE_PROFILE_NAME = 'Örnek router (Mach3)';

/**
 * The example machine seeded for every new company since T020 (D-016, D-028): a Mach3 router
 * with a manual tool change, 3100 × 2200 × 200 mm travel and a 3050 × 2150 table, so the draft
 * sheet (2800 × 2070) and the example post export end to end. Same tools (6 and 8 mm) and MDF
 * 18 parameters as the generic profile, plus Melamin 18 and Kontrplak 18 sets copied from MDF 18
 * (D-046). Still an unverified example (`example: true`).
 */
export function exampleMachineProfile(): MachineProfile {
  const p = defaultMachineProfile();
  p.identity = {
    ...p.identity,
    name: EXAMPLE_PROFILE_NAME,
    controller: { family: 'Mach3', version: '' },
  };
  p.workEnvelope = { x: 3100, y: 2200, z: 200 };
  p.table = { width: 3050, depth: 2150 };
  p.origin = {
    corner: 'frontLeft',
    xPositive: 'right',
    yPositive: 'back',
    sheetOffset: { x: 0, y: 0 },
  };
  p.zZero = { reference: 'materialTop', spoilboardAllowance: 0.5 };
  p.rapidFeed = 10000;
  p.toolChanger = { type: 'manual', capacity: 1, lengthCompensation: false };
  p.post = { id: 'mach3', version: '1.0.0' };
  // D-046 (owner, T257): the seeded library's Melamin 18 and Kontrplak 18 cut out of the box with
  // the MDF 18 values, marked as copied; the profile stays an unverified example (air cut first).
  const mdf = p.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
  if (mdf) {
    for (const material of ['melamine', 'plywood'] as const) {
      p.materials.push({ ...mdf, material, copiedFrom: 'mdf' });
    }
  }
  return machineProfileSchema.parse(p);
}

/**
 * True when `profile` is exactly the old seeded example (`defaultMachineProfile`), as seeded
 * before T020: with or without `rapidFeed` (added in T017). Used to upgrade untouched seeds.
 */
export function isLegacyExampleProfile(profile: MachineProfile): boolean {
  const strip = (p: MachineProfile) => {
    const copy = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    delete copy.rapidFeed;
    return JSON.stringify(sortKeys(copy));
  };
  const legacy = defaultMachineProfile();
  if (profile.rapidFeed !== undefined && profile.rapidFeed !== legacy.rapidFeed) return false;
  return strip(profile) === strip(legacy);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
