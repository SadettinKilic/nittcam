/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit raw JSON to build profiles */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE_NAME,
  defaultMachineProfile,
  machineProfileSchema,
  parseMachineProfile,
  PROFILE_BOUNDS,
} from './index';

/** The default profile as raw JSON, edited by `mutate`. */
function raw(mutate: (p: any) => void = () => {}): unknown {
  const json = JSON.parse(JSON.stringify(defaultMachineProfile()));
  mutate(json);
  return json;
}

function issuesOf(json: unknown) {
  const r = parseMachineProfile(json);
  if (r.ok) return [];
  return r.issues;
}

describe('default profile "Genel düz G-code router"', () => {
  it('is valid, marked as an example and has the §7.1 groups', () => {
    const p = defaultMachineProfile();
    expect(p.identity.name).toBe(DEFAULT_PROFILE_NAME);
    expect(p.example).toBe(true);
    expect(p.table).toEqual({ width: 2440, depth: 1220 });
    expect(p.zZero.reference).toBe('materialTop');
    expect(p.tools.map((t) => [t.number, t.type, t.diameter])).toEqual([
      [1, 'flatEndMill', 6],
      [2, 'flatEndMill', 8],
    ]);
    expect(p.materials).toEqual([
      expect.objectContaining({ material: 'mdf', thickness: 18, tool: 2 }),
    ]);
  });

  it('returns a fresh copy each time', () => {
    const a = defaultMachineProfile();
    a.tools.pop();
    expect(defaultMachineProfile().tools).toHaveLength(2);
  });
});

describe('schema bounds', () => {
  const cases: [string, (p: any) => void, string, string][] = [
    ['zero X travel', (p) => (p.workEnvelope.x = 0), 'workEnvelope.x', 'too_small'],
    ['X travel above 10 m', (p) => (p.workEnvelope.x = 10_001), 'workEnvelope.x', 'too_big'],
    ['Z travel above 1 m', (p) => (p.workEnvelope.z = 1_001), 'workEnvelope.z', 'too_big'],
    ['negative table', (p) => (p.table.depth = -1), 'table.depth', 'too_small'],
    ['NaN table width', (p) => (p.table.width = Number.NaN), 'table.width', 'invalid_type'],
    [
      'negative sheet offset',
      (p) => (p.origin.sheetOffset.x = -1),
      'origin.sheetOffset.x',
      'too_small',
    ],
    ['unknown corner', (p) => (p.origin.corner = 'middle'), 'origin.corner', 'invalid_value'],
    [
      'spoilboard > 5 mm',
      (p) => (p.zZero.spoilboardAllowance = 5.1),
      'zZero.spoilboardAllowance',
      'too_big',
    ],
    [
      'negative spoilboard',
      (p) => (p.zZero.spoilboardAllowance = -0.1),
      'zZero.spoilboardAllowance',
      'too_small',
    ],
    ['rpm below 1000', (p) => (p.spindle.minRpm = 999), 'spindle.minRpm', 'too_small'],
    ['rpm above 60000', (p) => (p.spindle.maxRpm = 60_001), 'spindle.maxRpm', 'too_big'],
    ['fractional rpm', (p) => (p.spindle.maxRpm = 24_000.5), 'spindle.maxRpm', 'invalid_type'],
    [
      'warm-up > 10 min',
      (p) => (p.spindle.warmupSeconds = 601),
      'spindle.warmupSeconds',
      'too_big',
    ],
    ['capacity 0', (p) => (p.toolChanger.capacity = 0), 'toolChanger.capacity', 'too_small'],
    ['bad M code', (p) => (p.holdDown.vacuumOn = 'G7'), 'holdDown.vacuumOn', 'invalid_format'],
    ['bad post version', (p) => (p.post.version = 'v1'), 'post.version', 'invalid_format'],
    [
      'file name length 7',
      (p) => (p.constraints.maxFileNameLength = 7),
      'constraints.maxFileNameLength',
      'too_small',
    ],
    ['no tools', (p) => (p.tools = []), 'tools', 'too_small'],
    ['tool diameter 0', (p) => (p.tools[0].diameter = 0), 'tools[0].diameter', 'too_small'],
    ['tool diameter > 50', (p) => (p.tools[0].diameter = 51), 'tools[0].diameter', 'too_big'],
    ['9 flutes', (p) => (p.tools[0].flutes = 9), 'tools[0].flutes', 'too_big'],
    ['tool number 100', (p) => (p.tools[0].number = 100), 'tools[0].number', 'too_big'],
    ['feed below 100', (p) => (p.materials[0].feed = 99), 'materials[0].feed', 'too_small'],
    ['step-down 0', (p) => (p.materials[0].stepDown = 0), 'materials[0].stepDown', 'too_small'],
    ['empty name', (p) => (p.identity.name = '   '), 'identity.name', 'too_small'],
    ['unknown key', (p) => (p.spindle.colour = 'red'), 'spindle', 'unrecognized_keys'],
    ['wrong schemaVersion', (p) => (p.schemaVersion = 2), 'schemaVersion', 'invalid_value'],
  ];

  it.each(cases)('%s → %s %s', (_name, mutate, path, code) => {
    expect(issuesOf(raw(mutate))).toContainEqual(expect.objectContaining({ path, code }));
  });

  it('bounds are inclusive where the spec allows the edge value', () => {
    expect(
      issuesOf(
        raw((p) => {
          p.workEnvelope.x = PROFILE_BOUNDS.axisXY.max;
          p.zZero.spoilboardAllowance = 0;
          p.spindle.warmupSeconds = 0;
          p.tools[0].diameter = PROFILE_BOUNDS.toolDiameter.max;
          p.holdDown.vacuumOn = '';
          p.holdDown.vacuumOff = '';
        }),
      ),
    ).toEqual([]);
  });

  it('reports bounds for the UI message', () => {
    expect(issuesOf(raw((p) => (p.spindle.minRpm = 10)))).toContainEqual({
      path: 'spindle.minRpm',
      code: 'too_small',
      message: expect.any(String),
      minimum: 1000,
      inclusive: true,
      origin: 'number',
    });
  });

  it('normalises M codes to upper case and fills defaults', () => {
    const r = machineProfileSchema.parse(
      raw((p) => {
        p.holdDown.vacuumOn = ' m8 ';
        delete p.example;
        delete p.identity.brand;
      }),
    );
    expect(r.holdDown.vacuumOn).toBe('M8');
    expect(r.example).toBe(false);
    expect(r.identity.brand).toBe('');
  });
});

describe('cross-field rules', () => {
  const cases: [string, (p: any) => void, string, string][] = [
    ['min rpm above max', (p) => (p.spindle.minRpm = 30_000), 'spindle.minRpm', 'minAboveMax'],
    ['safe Z above Z travel', (p) => (p.safeZ = 151), 'safeZ', 'safeZAboveTravel'],
    [
      'vacuum off without on',
      (p) => {
        p.holdDown.vacuumOn = '';
      },
      'holdDown.vacuumOn',
      'vacuumOnMissing',
    ],
    ['duplicate tool number', (p) => (p.tools[1].number = 1), 'tools[1].number', 'duplicateTool'],
    [
      'tool above auto changer capacity',
      (p) => {
        p.toolChanger = { type: 'auto', capacity: 1, lengthCompensation: true };
      },
      'tools[1].number',
      'toolAboveCapacity',
    ],
    [
      'duplicate material + thickness',
      (p) => p.materials.push({ ...p.materials[0] }),
      'materials[1].thickness',
      'duplicateMaterial',
    ],
    [
      'material tool not in table',
      (p) => (p.materials[0].tool = 9),
      'materials[0].tool',
      'unknownTool',
    ],
    [
      'plunge faster than feed',
      (p) => (p.materials[0].plungeFeed = 7000),
      'materials[0].plungeFeed',
      'plungeAboveFeed',
    ],
    [
      'rpm outside spindle range',
      (p) => (p.materials[0].rpm = 25_000),
      'materials[0].rpm',
      'rpmOutsideSpindle',
    ],
  ];

  it.each(cases)('%s → %s (%s)', (_name, mutate, path, key) => {
    expect(issuesOf(raw(mutate))).toContainEqual(
      expect.objectContaining({ path, code: 'custom', key }),
    );
  });

  it('manual changer ignores the capacity', () => {
    expect(issuesOf(raw((p) => (p.toolChanger.capacity = 1)))).toEqual([]);
  });
});
