import { describe, expect, it } from 'vitest';
import {
  defaultMachineProfile,
  parseMachineProfile,
  parseMachineProfileForSave,
  type MachineProfile,
  type Tool,
} from '../machine';
import { MATERIAL_KIND_IDS } from '../machine/material-kinds';
import { goldenProfile } from '../post/golden.testing';
import type { Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { operationToolProblem, operationToolProblemText } from './op-tool-choice';
import { OPERATION_TOOL_TYPES, operationToolTypes, toolTypeAllowed } from './op-tools';
import { clone, projectOf } from './toolpath.testing';

// T344: tool types per material (traits row) and the optional V-bit geometry of the tool table.

const VBIT: Tool = { number: 5, type: 'vBit', diameter: 6, fluteLength: 30, flutes: 2 };

function profileWith(tools: Tool[]): unknown {
  const p = clone(defaultMachineProfile()) as MachineProfile;
  p.tools = [...p.tools, ...tools];
  return p;
}

const issueKeys = (json: unknown) => {
  const r = parseMachineProfile(json);
  return r.ok ? [] : r.issues.map((i) => `${i.path}:${i.key ?? i.code}`);
};

describe('tool types per material (T344)', () => {
  it("the six kinds and an unknown material give today's lists", () => {
    for (const k of [...MATERIAL_KIND_IDS, 'MDF', 'unknown-stuff']) {
      expect(operationToolTypes(k)).toEqual(OPERATION_TOOL_TYPES);
    }
    expect(toolTypeAllowed('mdf', 'hole', 'drill')).toBe(true);
    expect(toolTypeAllowed('mdf', 'outer', 'vBit')).toBe(false);
  });

  it('OPERATION_TOOL_UNSUITABLE names the material when the type is not allowed for it', () => {
    const machine = goldenProfile('generic');
    machine.tools = [...machine.tools, VBIT];
    const p = clone(
      projectOf({
        parts: [{ id: 'a', w: 300, h: 200, qty: 1 }],
        placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
      }),
    ) as Project;
    p.cutting.tools = { outer: 5 };
    expect(operationToolProblem(p, machine, 'outer', 5)).toBe('TYPE');
    expect(operationToolProblemText(p, 'TYPE')).toContain('mdf');
    const r = buildToolpath(p, machine);
    const e = r.errors.find((i) => i.code === 'OPERATION_TOOL_UNSUITABLE');
    expect(e?.message).toBe(
      'The tool chosen for the outer operation (T5) is a vBit, which does not cut the outer operation in mdf.',
    );
    const v = validateProject(p, { machine }).find((i) => i.code === 'OPERATION_TOOL_UNSUITABLE');
    expect(v?.message).toContain('in mdf');
  });
});

describe('V-bit geometry in the tool table (T344)', () => {
  it('a V-bit without angle or tip still saves; with both it saves', () => {
    expect(issueKeys(profileWith([VBIT]))).toEqual([]);
    expect(parseMachineProfileForSave(profileWith([VBIT])).ok).toBe(true);
    const full = profileWith([{ ...VBIT, angleDeg: 90, tipDiameter: 0.2 }]);
    expect(issueKeys(full)).toEqual([]);
    const r = parseMachineProfile(full);
    expect(r.ok && r.profile.tools.at(-1)).toMatchObject({ angleDeg: 90, tipDiameter: 0.2 });
    expect(issueKeys(profileWith([{ ...VBIT, angleDeg: 10, tipDiameter: 0 }]))).toEqual([]);
    expect(issueKeys(profileWith([{ ...VBIT, angleDeg: 179 }]))).toEqual([]);
  });

  it('angle 10–179, tip ≥ 0 and below the diameter', () => {
    const n = 2; // index of the added tool in the default profile (two tools + the V-bit)
    const at = (k: string) => `tools[${n}].${k}`;
    const keys = (t: Partial<Tool>) =>
      issueKeys(profileWith([{ ...VBIT, ...t } as Tool])).filter((x) => x.startsWith('tools['));
    expect(defaultMachineProfile().tools).toHaveLength(2);
    expect(keys({ angleDeg: 9.9 })).toEqual([`${at('angleDeg')}:too_small`]);
    expect(keys({ angleDeg: 180 })).toEqual([`${at('angleDeg')}:too_big`]);
    expect(keys({ tipDiameter: -0.1 })).toEqual([`${at('tipDiameter')}:too_small`]);
    expect(keys({ tipDiameter: 6 })).toEqual([`${at('tipDiameter')}:tipNotBelowDiameter`]);
    expect(keys({ tipDiameter: 5.9 })).toEqual([]);
  });

  it('only a V-bit carries the geometry', () => {
    const flat = { ...VBIT, type: 'flatEndMill', angleDeg: 90, tipDiameter: 0 } as Tool;
    expect(issueKeys(profileWith([flat]))).toEqual([
      'tools[2].angleDeg:vBitOnly',
      'tools[2].tipDiameter:vBitOnly',
    ]);
  });

  it('existing profiles round-trip unchanged (no new keys appear)', () => {
    for (const json of [
      defaultMachineProfile(),
      goldenProfile('generic'),
      goldenProfile('mach3'),
    ]) {
      const r = parseMachineProfile(clone(json));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.profile).toEqual(json);
      if (r.ok) for (const t of r.profile.tools) expect(Object.keys(t)).not.toContain('angleDeg');
    }
  });
});
