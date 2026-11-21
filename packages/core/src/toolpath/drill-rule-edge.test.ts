import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bestHoleTool, holeToolProblem, type HoleRuleTool } from '../editor/holes';
import { exportNc } from '../export/export';
import { postConfig } from '../gcode-check/check.testing';
import type { MachineProfile } from '../machine';
import { goldenProfile } from '../post/golden.testing';
import type { Hole, Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { clone, projectOf } from './toolpath.testing';

// T320 tester edge cases (D-108): no path lets a drill of the wrong size reach the NC file.

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

const through = (d: number, tool: number): Hole => ({
  type: 'through',
  id: 'h',
  d,
  cx: 100,
  cy: 100,
  tool,
});

function projectWith(holes: Hole[], tools?: Project['cutting']['tools']): Project {
  const p = clone(
    projectOf({
      parts: [{ id: 'a', w: 400, h: 300, qty: 1 }],
      placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
    }),
  ) as Project;
  const part = p.parts[0];
  if (!part) throw new Error('no part');
  part.holes = holes;
  if (tools) p.cutting.tools = tools;
  return p;
}

describe('drill size rule: boundaries (T320 tester)', () => {
  const tools = machine().tools;
  it('within 0.001 mm counts as the drill size; 0.01 mm over is a mismatch', () => {
    expect(holeToolProblem(through(5.0005, 3), tools)).toBeNull();
    expect(holeToolProblem(through(5.01, 3), tools)?.code).toBe('DRILL_SIZE_MISMATCH');
  });
  it('a hole smaller than the drill stays HOLE_SMALLER_THAN_TOOL', () => {
    expect(holeToolProblem(through(4, 3), tools)?.code).toBe('HOLE_SMALLER_THAN_TOOL');
  });
  it('a groove exactly as wide as the drill is still refused', () => {
    const groove: Hole = {
      type: 'groove',
      id: 'g',
      d: 5,
      cx: 100,
      cy: 100,
      depth: 3,
      grooveWidth: 5,
      tool: 3,
    };
    expect(holeToolProblem(groove, tools)?.code).toBe('DRILL_SIZE_MISMATCH');
    expect(buildToolpath(projectWith([groove]), machine()).errors.length).toBeGreaterThan(0);
  });
});

describe('bestHoleTool never hands a wrong drill (T320 tester)', () => {
  it('a set tool that is a drill of another size is not kept', () => {
    // Ø8 hole, set tool = Ø5 drill: must take the Ø8 mill, not the drill.
    expect(bestHoleTool(through(8, 3), machine().tools, 3)).toBe(2);
  });
  it('a V bit fallback is never picked when a mill suits', () => {
    expect(bestHoleTool(through(12, 5), machine().tools, 5)).toBe(2);
  });
  it('a tool table with only a wrong drill keeps the fallback; validation then blocks it', () => {
    const only: HoleRuleTool[] = [{ number: 3, type: 'drill', diameter: 5 }];
    const tool = bestHoleTool(through(8, 3), only, 3);
    expect(holeToolProblem(through(8, tool), only)?.code).toBe('DRILL_SIZE_MISMATCH');
  });
  it('property: the pick suits the hole, or it is the fallback', () => {
    const toolArb = fc.record({
      number: fc.integer({ min: 1, max: 9 }),
      type: fc.constantFrom('drill', 'flatEndMill', 'compression', 'vBit', undefined),
      diameter: fc.constantFrom(3, 5, 6, 8, 10, 35),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(toolArb, { minLength: 1, maxLength: 6, selector: (t) => t.number }),
        fc.constantFrom(3, 5, 6, 7, 8, 12, 35),
        fc.integer({ min: 1, max: 9 }),
        (raw, d, fallback) => {
          const tools: HoleRuleTool[] = raw.map(({ type, ...t }) =>
            type === undefined ? t : { ...t, type },
          );
          const pick = bestHoleTool(through(d, fallback), tools, fallback);
          const problem = holeToolProblem(through(d, pick), tools);
          if (pick !== fallback) expect(problem).toBeNull();
          const drill = tools.find((t) => t.type === 'drill' && Math.abs(t.diameter - d) < 1e-3);
          if (drill) {
            const picked = tools.find((t) => t.number === pick);
            expect(picked?.type).toBe('drill');
            expect(picked?.diameter).toBe(d);
          }
        },
      ),
    );
  });
});

describe('a wrong drill never reaches NC (T320 tester, gcode safety)', () => {
  it('export of a Ø35 cup with the Ø5 drill gives no files', () => {
    const cup: Hole = {
      type: 'pocket',
      id: 'cup',
      d: 35,
      cx: 100,
      cy: 100,
      depth: 12,
      tool: 3,
    };
    const r = exportNc(
      projectWith([cup]),
      { profile: machine(), version: 1, verification: 'draft' },
      postConfig('generic'),
      { projectName: 'cup' },
    );
    expect(r.ok).toBe(false);
  });
  it('a chosen drill for through holes on a bigger hole is blocked in validation and toolpath', () => {
    const p = projectWith([through(8, 2)], { hole: 3 });
    const v = validateProject(p, { machine: machine() }).filter((i) => i.severity === 'error');
    expect(v.length).toBeGreaterThan(0);
    expect(buildToolpath(p, machine()).errors.map((e) => e.code)).toContain(
      'OPERATION_TOOL_UNSUITABLE',
    );
  });
  it('a hole whose own tool is a matching drill still builds', () => {
    const res = buildToolpath(projectWith([through(5, 3)]), machine());
    expect(res.errors).toEqual([]);
  });
});
