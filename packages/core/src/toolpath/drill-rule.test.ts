import { describe, expect, it } from 'vitest';
import { bestHoleTool, holeToolProblem } from '../editor/holes';
import type { MachineProfile } from '../machine';
import { goldenProfile } from '../post/golden.testing';
import type { Hole, Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { clone, projectOf } from './toolpath.testing';

// T320 (D-108, usta 1): a Ø35 hinge cup with a Ø5 drill was accepted silently. A drill only drills
// a hole of its own size; a bigger hole or a groove needs a mill. New holes default to a drill of
// the hole's size when the machine has one, else a mill that suits.

function machine(): MachineProfile {
  const m = goldenProfile('generic'); // T1 Ø6, T2 Ø8 flat end mills
  m.tools = [
    ...m.tools,
    { number: 3, type: 'drill', diameter: 5, fluteLength: 40, flutes: 2 },
    { number: 4, type: 'drill', diameter: 35, fluteLength: 30, flutes: 2 },
    { number: 5, type: 'vBit', diameter: 10, fluteLength: 30, flutes: 2 },
  ];
  return m;
}

const cup = (tool: number): Hole => ({
  type: 'pocket',
  id: 'cup',
  d: 35,
  cx: 100,
  cy: 100,
  depth: 12,
  tool,
});

function projectWith(holes: Hole[]): Project {
  const p = clone(
    projectOf({
      parts: [{ id: 'a', w: 400, h: 300, qty: 1 }],
      placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
    }),
  ) as Project;
  const part = p.parts[0];
  if (!part) throw new Error('no part');
  part.holes = holes;
  return p;
}

describe('holeToolProblem: drill size (T320)', () => {
  const tools = machine().tools;
  it('a Ø5 drill in a Ø35 cup is a drill size mismatch', () => {
    expect(holeToolProblem(cup(3), tools)).toEqual({
      code: 'DRILL_SIZE_MISMATCH',
      toolDiameter: 5,
    });
  });
  it('a drill of the hole size is fine, through or blind', () => {
    expect(holeToolProblem(cup(4), tools)).toBeNull();
    expect(
      holeToolProblem({ type: 'through', id: 'h', d: 5, cx: 0, cy: 0, tool: 3 }, tools),
    ).toBeNull();
  });
  it('a drill never cuts a groove', () => {
    const groove: Hole = {
      type: 'groove',
      id: 'g',
      d: 40,
      cx: 0,
      cy: 0,
      depth: 3,
      grooveWidth: 5,
      tool: 3,
    };
    expect(holeToolProblem(groove, tools)?.code).toBe('DRILL_SIZE_MISMATCH');
  });
  it('a mill smaller than the hole stays fine (helical / pocket)', () => {
    expect(holeToolProblem(cup(1), tools)).toBeNull();
  });
});

describe('validation and toolpath refuse a wrong drill (T320)', () => {
  it('validation: one blocking DRILL_SIZE_MISMATCH on the hole tool', () => {
    const issues = validateProject(projectWith([cup(3)]), { machine: machine() });
    const hit = issues.filter((i) => i.code === 'DRILL_SIZE_MISMATCH');
    expect(hit).toHaveLength(1);
    expect(hit[0]?.severity).toBe('error');
    expect(hit[0]?.path).toBe('parts[0].holes[0].tool');
  });
  it('toolpath backstop: no program with a Ø5 drill in a Ø35 cup', () => {
    const res = buildToolpath(projectWith([cup(3)]), machine());
    expect(res.errors.map((e) => `${e.code}@${e.hole}`)).toEqual(['DRILL_SIZE_MISMATCH@0']);
  });
});

describe('bestHoleTool (T320)', () => {
  const tools = machine().tools;
  const through = (d: number): Hole => ({ type: 'through', id: 'h', d, cx: 0, cy: 0, tool: 1 });
  it('picks the drill of the hole size', () => {
    expect(bestHoleTool(through(5), tools, 1)).toBe(3);
    expect(bestHoleTool(cup(1), tools, 1)).toBe(4);
  });
  it('without a matching drill keeps the set tool when it suits', () => {
    expect(bestHoleTool(through(8), tools, 2)).toBe(2);
    expect(bestHoleTool(through(12), tools, 1)).toBe(1);
  });
  it('a set tool too big for the hole falls to the widest mill that suits, never a V bit', () => {
    expect(bestHoleTool(through(7), tools, 2)).toBe(1);
  });
  it('nothing suits: the fallback stays (validation names it)', () => {
    expect(bestHoleTool(through(3), tools, 1)).toBe(1);
  });
});
