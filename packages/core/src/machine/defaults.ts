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

/** A fresh copy of the example profile (validated, so a bad edit here fails the tests). */
export function defaultMachineProfile(): MachineProfile {
  return machineProfileSchema.parse(JSON.parse(JSON.stringify(DEFAULT_PROFILE_INPUT)));
}
