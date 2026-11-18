import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { boardPositions } from '../editor/board';
import { circleOutline } from '../editor/draw';
import { contour, orientation } from '../geometry/polyline';
import { parseProject, type Part, type Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const ctx: CommandContext = { actor: 'user', at: '2026-11-18T10:00:00Z' };

function load(json: unknown): Project {
  const r = parseProject(JSON.parse(JSON.stringify(json)));
  if (!r.ok) throw new Error('fixture invalid');
  return r.project;
}

describe('drawPart (T127/T128)', () => {
  it('adds a parametric rectangle at the drawn corner, others keep their place, one undo step', () => {
    const p0 = load(shelfSet);
    const before = boardPositions(p0);
    const stack = new CommandStack(p0);
    const r = stack.execute(
      'drawPart',
      {
        id: 'drawn-1',
        name: 'Parça 6',
        at: { x: -800, y: 120.5 },
        shape: { kind: 'rect', params: { w: 596, h: 716, r: 0 } },
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const added = stack.project.parts.at(-1) as Part;
    expect(added).toMatchObject({
      id: 'drawn-1',
      name: 'Parça 6',
      kind: 'rect',
      qty: 1,
      params: { w: 596, h: 716, r: 0 },
      draw: { x: -800, y: 120.5 },
    });
    const after = boardPositions(stack.project);
    for (const [id, at] of before) expect(after.get(id)).toEqual(at);
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
  });

  it('a circle becomes a freeform part with two half arcs', () => {
    const p0 = load(shelfSet);
    const p1 = applyCommand(p0, 'drawPart', {
      id: 'c1',
      at: { x: 100, y: 100 },
      shape: { kind: 'outline', vertices: circleOutline(50) },
    });
    if (!p1.ok) throw new Error(p1.error.message);
    const c = p1.project.parts.at(-1) as Part;
    expect(c.kind).toBe('freeform');
    if (c.kind !== 'freeform') return;
    expect(c.outline.map((v) => v.bulge)).toEqual([1, 1]);
    expect(c.draw).toEqual({ x: 100, y: 100 });
  });

  it('a CW outline is stored CCW in a local frame; board corner is the box corner', () => {
    const p0 = load(shelfSet);
    const r = applyCommand(p0, 'drawPart', {
      id: 'f1',
      shape: {
        kind: 'outline',
        vertices: [
          { x: 1000, y: 1000, bulge: 0 },
          { x: 1000, y: 1300, bulge: 0 },
          { x: 1600, y: 1300, bulge: 0 },
          { x: 1600, y: 1000, bulge: 0 },
        ],
      },
    });
    if (!r.ok) throw new Error(r.error.message);
    const f = r.project.parts.at(-1) as Part;
    if (f.kind !== 'freeform') throw new Error('kind');
    expect(orientation(contour(f.outline))).toBe('ccw');
    expect(f.draw).toEqual({ x: 1000, y: 1000 });
    expect(Math.min(...f.outline.map((v) => v.x))).toBe(0);
  });

  it('refuses a taken id, a too-large corner radius and an open 2-point outline', () => {
    const p0 = load(shelfSet);
    const id = (p0.parts[0] as Part).id;
    const shape = { kind: 'rect', params: { w: 10, h: 10, r: 0 } };
    expect(applyCommand(p0, 'drawPart', { id, shape }).ok).toBe(false);
    expect(
      applyCommand(p0, 'drawPart', {
        id: 'x',
        shape: { kind: 'rect', params: { w: 10, h: 10, r: 6 } },
      }).ok,
    ).toBe(false);
    expect(
      applyCommand(p0, 'drawPart', {
        id: 'x',
        shape: {
          kind: 'outline',
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 0, bulge: 0 },
          ],
        },
      }).ok,
    ).toBe(false);
  });

  it('property: apply then undo restores the project byte for byte', () => {
    const p0 = load(shelfSet);
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 2800, noNaN: true }),
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (w, h, x) => {
          const stack = new CommandStack(p0);
          const ok = stack.execute(
            'drawPart',
            { id: 'p', at: { x, y: 0 }, shape: { kind: 'rect', params: { w, h, r: 0 } } },
            ctx,
          ).ok;
          expect(ok).toBe(true);
          stack.undo();
          expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
        },
      ),
      { numRuns: 30 },
    );
  });
});
