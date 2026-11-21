import { applyPatches, enablePatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand, CommandStack } from '../commands';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import { PROFILE_BOUNDS } from '../machine/profile';
import { goldenProfile } from '../post/golden.testing';
import { cuttingHeader, spindleHeaders } from '../post/generate';
import { parseProject, SPINDLE_RPM_BOUNDS, type Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { rpmBand, spindleSettingsOf } from './spindle';
import { clone, machineOf, projectOf } from './toolpath.testing';

// T307 (D-098): spindle speed per tool, editable per project. Default = the material set's rpm;
// the override is a command, reaches the S word and the KESİM line, and never leaves the machine's
// spindle range (command, validation, toolpath, post).

enablePatches();

const machine = machineOf({ thickness: 18, spoilboard: 0.3 });
const at = '2026-11-21T10:00:00Z';

function project(): Project {
  const base = clone(
    projectOf({
      parts: [{ id: 'a', w: 300, h: 200, qty: 1 }],
      placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
    }),
  );
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

function run(p: Project, params: unknown, m = machine): Project {
  const r = applyCommand(p, 'setSpindleRpm', params, { machine: m });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(JSON.stringify(applyPatches(r.project, r.inversePatches))).toBe(JSON.stringify(p));
  return r.project;
}

/** The first tool row of the job (one tool here). */
function first(p: Project, m = machine) {
  const row = spindleSettingsOf(p, m)[0];
  if (!row) throw new Error('no tool row');
  return row;
}

const sWords = (p: Project) => {
  const r = buildToolpath(p, machine);
  expect(r.errors).toEqual([]);
  return [...new Set(r.toolpath.operations.map((o) => o.rpm))];
};

describe('setSpindleRpm (T307)', () => {
  it('the schema bounds equal the profile bounds', () => {
    expect(SPINDLE_RPM_BOUNDS).toEqual(PROFILE_BOUNDS.rpm);
  });

  it('stores per tool, null goes back; undo restores byte for byte', () => {
    const p = project();
    const tool = first(p).tool;
    const own = run(p, { tool, rpm: 20000 });
    expect(own.cutting.spindleRpm).toEqual({ [String(tool)]: 20000 });
    const back = run(own, { tool, rpm: null });
    expect(back.cutting).toEqual(p.cutting);
    expect('spindleRpm' in back.cutting).toBe(false);
  });

  it('refuses a value outside the machine range and a tool the machine lacks', () => {
    const p = project();
    const { minRpm, maxRpm } = machine.spindle;
    for (const rpm of [minRpm - 100, maxRpm + 100]) {
      const r = applyCommand(p, 'setSpindleRpm', { tool: 1, rpm }, { machine });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('PRECONDITION_FAILED');
    }
    expect(applyCommand(p, 'setSpindleRpm', { tool: 42, rpm: 18000 }, { machine }).ok).toBe(false);
    expect(applyCommand(p, 'setSpindleRpm', { tool: 1, rpm: 18000.5 }, { machine }).ok).toBe(false);
    expect(applyCommand(p, 'setSpindleRpm', { tool: 1, rpm: 999 }).ok).toBe(false);
  });

  it('the command stack checks against its machine', () => {
    const stack = new CommandStack(project(), { machine });
    const r = stack.execute('setSpindleRpm', { tool: 1, rpm: 30000 }, { actor: 'user', at });
    expect(r.ok).toBe(false);
    expect(stack.execute('setSpindleRpm', { tool: 1, rpm: 20000 }, { actor: 'user', at }).ok).toBe(
      true,
    );
    expect(stack.undo()).toBe(true);
    expect(stack.project.cutting.spindleRpm).toBeUndefined();
  });

  it('is not an AI tool', async () => {
    const { COMMANDS } = await import('../commands/registry');
    expect(COMMANDS.setSpindleRpm.aiTool).toBe(false);
  });
});

describe('toolpath and program (T307)', () => {
  it('no override = the material set rpm (goldens unchanged); an override reaches every op of the tool', () => {
    const p = project();
    const set = first(p);
    expect(set.override).toBe(false);
    expect(set.rpm).toBe(set.recommended);
    expect(sWords(p)).toEqual([set.recommended]);
    expect(sWords(run(p, { tool: set.tool, rpm: 21500 }))).toEqual([21500]);
  });

  it('an out-of-range value in an old or hand-edited project is caught by validation and toolpath', () => {
    const p = clone(project()) as Project;
    p.cutting.spindleRpm = { [String(first(project()).tool)]: machine.spindle.maxRpm + 1000 };
    const issues = validateProject(p, { machine });
    expect(issues.map((i) => i.code)).toContain('SPINDLE_RPM_OUT_OF_RANGE');
    const tp = buildToolpath(p, machine);
    expect(tp.ok).toBe(false);
    expect(tp.errors.map((e) => e.code)).toContain('SPINDLE_RPM_OUT_OF_RANGE');
    // A stale value of a tool the job does not use is never cut and never blocks.
    const stale = clone(project()) as Project;
    stale.cutting.spindleRpm = { '9': machine.spindle.maxRpm + 1000 };
    expect(validateProject(stale, { machine }).map((i) => i.code)).not.toContain(
      'SPINDLE_RPM_OUT_OF_RANGE',
    );
    expect(buildToolpath(stale, machine).ok).toBe(true);
  });

  it('the exported program carries the S word and the KESİM line names it', () => {
    const profile = goldenProfile('generic');
    const exp = (p: Project) => {
      const r = exportNc(p, { profile, version: 1, verification: 'draft' }, postConfig('generic'));
      expect(r.ok).toBe(true);
      return r.files[0]?.content ?? '';
    };
    const p = project();
    const tool = first(p, profile).tool;
    const plain = exp(p);
    expect(plain).not.toMatch(/DEV[İI]R/);
    const own = exp(run(p, { tool, rpm: 20000 }, profile));
    expect(own).toMatch(/M3 S20000/);
    expect(own).not.toMatch(/S18000/);
    const header = own.split(/\r?\n/).filter((l) => /^\((KESIM|DEVIR)/.test(l));
    expect(header[1]).toBe(`(DEVIR T${tool}: 20000 d/dk elle, onerilen 18000)`);
    expect(header[0]).not.toMatch(/devir/i);
    // Spindle on + dwell before cutting (§7.2 rule 4) still holds.
    const lines = own.split(/\r?\n/);
    const on = lines.findIndex((l) => /^M3 S20000/.test(l));
    expect(lines[on + 1]).toMatch(/^G4 /);
  });

  it('header wording: one DEVİR line per tool, none without overrides', () => {
    const base = {
      tabMode: 'small',
      tabCount: 4,
      tabWidth: 10,
      tabHeight: 3,
      skin: null,
      leadIn: 'arc',
      direction: 'climb',
    } as const;
    expect(spindleHeaders(base)).toEqual([]);
    const lines = spindleHeaders({
      ...base,
      spindle: [
        { tool: 2, rpm: 20000, recommended: 18000 },
        { tool: 5, rpm: 15500, recommended: 18000 },
      ],
    });
    expect(lines).toEqual([
      'DEVİR T2: 20000 d/dk elle, önerilen 18000',
      'DEVİR T5: 15500 d/dk elle, önerilen 18000',
    ]);
    expect(cuttingHeader({ ...base, spindle: [{ tool: 2, rpm: 20000, recommended: 18000 }] })).toBe(
      cuttingHeader(base),
    );
  });
});

describe('spindleSettingsOf / rpmBand (T307)', () => {
  it('band ±20 % around the recommended value, signed whole percent', () => {
    expect(rpmBand(18000, 18000)).toEqual({ band: 'ok', deviation: 0 });
    expect(rpmBand(21600, 18000)).toEqual({ band: 'ok', deviation: 20 });
    expect(rpmBand(23400, 18000)).toEqual({ band: 'high', deviation: 30 });
    expect(rpmBand(12600, 18000)).toEqual({ band: 'low', deviation: -30 });
  });

  it('chip load = feed / (rpm × flutes); hole tools join the job with the set rpm', () => {
    const p = project();
    const row = first(p);
    expect(row.chipLoad).toBeCloseTo(row.feed / (row.rpm * row.flutes), 9);
  });
});
