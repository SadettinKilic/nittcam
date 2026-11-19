/**
 * T133: linear dimensions are non-cut annotations. They are stored in the part frame, follow
 * board edits, and never reach nesting or the toolpath.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boardPositions } from '../editor/board';
import { nest, nestingInputFromProject } from '../nesting/nest';
import { buildToolpath } from '../toolpath/build';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import type { Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('missing');
  return x;
}

const ctx: CommandContext = { actor: 'user', at: '2026-11-19T10:00:00Z' };

function base(): Project {
  return projectOf({
    parts: [
      { id: 'a', w: 300, h: 200 },
      { id: 'b', w: 120, h: 80, qty: 2 },
    ],
    placements: [
      [
        { partId: 'a', index: 0, x: 20, y: 20, rot: 0 },
        { partId: 'b', index: 0, x: 400, y: 20, rot: 0 },
        { partId: 'b', index: 1, x: 600, y: 20, rot: 90 },
      ],
    ],
  });
}

function withDim(p: Project, id: string, a: { x: number; y: number }, b: { x: number; y: number }) {
  const r = applyCommand(p, 'addDimension', { id, dimId: `d-${a.x}-${b.x}`, a, b });
  if (!r.ok) throw new Error(r.error.message);
  return r.project;
}

describe('addDimension / removeDimension (T133)', () => {
  it('stores the points in the part frame; one undo step each', () => {
    const p = base();
    const at = must(boardPositions(p).get('a'));
    const stack = new CommandStack(p);
    const res = stack.execute(
      'addDimension',
      { id: 'a', dimId: 'd1', a: { x: at.x, y: at.y }, b: { x: at.x + 300, y: at.y } },
      ctx,
    );
    expect(res.ok).toBe(true);
    const dims = stack.project.parts[0]?.dims;
    expect(dims).toEqual([{ id: 'd1', a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }]);
    expect(stack.execute('removeDimension', { id: 'a', dimId: 'd1' }, ctx).ok).toBe(true);
    expect(stack.project.parts[0]?.dims).toBeUndefined();
    stack.undo();
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p));
  });

  it('refuses a zero-length dimension, a duplicate id and an unknown part', () => {
    const p = withDim(base(), 'a', { x: 0, y: 0 }, { x: 10, y: 0 });
    const dimId = must(p.parts[0]?.dims?.[0]).id;
    expect(
      applyCommand(p, 'addDimension', { id: 'a', dimId: 'z', a: { x: 1, y: 1 }, b: { x: 1, y: 1 } })
        .ok,
    ).toBe(false);
    expect(
      applyCommand(p, 'addDimension', { id: 'a', dimId, a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }).ok,
    ).toBe(false);
    expect(
      applyCommand(p, 'addDimension', { id: 'x', dimId: 'q', a: { x: 0, y: 0 }, b: { x: 5, y: 0 } })
        .ok,
    ).toBe(false);
    expect(applyCommand(p, 'removeDimension', { id: 'a', dimId: 'nope' }).ok).toBe(false);
  });

  it('turns with the part (rotatePart keeps the measured length)', () => {
    const at = must(boardPositions(base()).get('a'));
    const p = withDim(base(), 'a', { x: at.x, y: at.y }, { x: at.x + 300, y: at.y });
    const r = applyCommand(p, 'rotatePart', { ids: ['a'], turns: 90 });
    if (!r.ok) throw new Error(r.error.message);
    const d = must(r.project.parts[0]?.dims?.[0]);
    expect(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)).toBeCloseTo(300, 9);
    expect(Math.abs(d.b.x - d.a.x)).toBeLessThan(1e-9); // now vertical
  });

  it('property: dimensions never change the toolpath or the nesting result', () => {
    const machine = machineOf({ toolDiameter: 6, thickness: 18 });
    const plain = base();
    const tp = JSON.stringify(buildToolpath(plain, machine));
    const nested = JSON.stringify(nest(nestingInputFromProject(plain, { toolDiameter: 6 })));
    const pt = fc.record({
      x: fc.integer({ min: -500, max: 3000 }),
      y: fc.integer({ min: -500, max: 3000 }),
    });
    fc.assert(
      fc.property(fc.constantFrom('a', 'b'), pt, pt, (id, a, b) => {
        fc.pre(a.x !== b.x || a.y !== b.y);
        const p = withDim(plain, id, a, b);
        expect(p.parts.some((x) => (x.dims?.length ?? 0) > 0)).toBe(true);
        expect(JSON.stringify(buildToolpath(p, machine))).toBe(tp);
        expect(JSON.stringify(nest(nestingInputFromProject(p, { toolDiameter: 6 })))).toBe(nested);
      }),
      { numRuns: 40 },
    );
  });
});
