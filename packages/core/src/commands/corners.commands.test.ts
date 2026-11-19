/**
 * T131: fillet, inner-corner rule and convert to freeform. Property tests: a fillet keeps the
 * contour closed and CCW and makes the area smaller (convex corners); the clamp; auto-fix gives the
 * tool radius.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { boardPositions } from '../editor/board';
import { cornerTurn, filletOutline, fixTightCorners, tightCorners } from '../editor/corners';
import { checkOutline } from '../editor/edit';
import { contour, orientation, signedArea } from '../geometry/polyline';
import { arcOf } from '../geometry/segment';
import { deriveOutline, parseProject, type Part, type Project, type Vertex } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const ctx: CommandContext = { actor: 'user', at: '2026-11-19T10:00:00Z' };
const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const L: Vertex[] = [v(0, 0), v(600, 0), v(600, 200), v(300, 200), v(300, 400), v(0, 400)];

function load(): Project {
  const r = parseProject(JSON.parse(JSON.stringify(shelfSet)));
  if (!r.ok) throw new Error('fixture invalid');
  return r.project;
}

function byId(p: Project, id: string): Part {
  const found = p.parts.find((x) => x.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

const area = (vs: readonly Vertex[]) => signedArea(contour(vs));

/** Every segment ends where the next starts (implicitly closed), none has zero length. */
function closedChain(vs: readonly Vertex[]): boolean {
  return vs.every((a, i) => {
    const b = vs[(i + 1) % vs.length] as Vertex;
    return Math.hypot(b.x - a.x, b.y - a.y) > 0.0005;
  });
}

/** A convex polygon: n points on an ellipse at sorted angles (CCW). */
const convexPolygon = fc
  .tuple(
    fc.uniqueArray(fc.integer({ min: 0, max: 359 }), { minLength: 3, maxLength: 9 }),
    fc.integer({ min: 100, max: 2000 }),
    fc.integer({ min: 100, max: 2000 }),
  )
  .map(([angles, rx, ry]) =>
    [...angles]
      .sort((a, b) => a - b)
      .map((deg) => {
        const t = (deg * Math.PI) / 180;
        return v(Math.round(rx * Math.cos(t)), Math.round(ry * Math.sin(t)));
      }),
  )
  .filter(
    (vs) =>
      checkOutline(vs) === undefined && vs.every((_, i) => Math.abs(cornerTurn(vs, i)) > 1e-3),
  );

describe('filletOutline (T131) properties', () => {
  it('closed, CCW, area decreases; every arc has the (clamped) radius', () => {
    fc.assert(
      fc.property(
        convexPolygon,
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.integer({ min: 1, max: 511 }),
        (vs, r, mask) => {
          const corners = vs.map((_, i) => i).filter((i) => (mask >> i) & 1);
          if (corners.length === 0) return;
          const res = filletOutline(vs, corners, r);
          if (!res.ok) return; // a clamp can make the outline invalid only when degenerate
          expect(closedChain(res.vertices)).toBe(true);
          expect(orientation(contour(res.vertices))).toBe('ccw');
          // Smaller (vertices are kept to 1e-6 mm, so allow that rounding on tiny fillets).
          expect(area(res.vertices)).toBeLessThan(area(vs) + 1e-3);
          for (const got of res.radii) expect(got).toBeLessThanOrEqual(r + 1e-6);
          if (!res.clamped) for (const got of res.radii) expect(got).toBeCloseTo(r, 4);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('a 300 × 1800 rectangle, all corners r = 50: four quarter arcs of radius 50', () => {
    const res = filletOutline([v(0, 0), v(300, 0), v(300, 1800), v(0, 1800)], [0, 1, 2, 3], 50);
    if (!res.ok) throw new Error(res.error);
    expect(res.clamped).toBe(false);
    expect(res.vertices).toHaveLength(8);
    const arcs = res.vertices
      .map((a, i) => arcOf(a, res.vertices[(i + 1) % 8] as Vertex, a.bulge))
      .filter((x) => x !== undefined);
    expect(arcs).toHaveLength(4);
    for (const a of arcs) expect(a.radius).toBeCloseTo(50, 6);
    expect(res.vertices[0]).toEqual(v(0, 50, res.vertices[0]?.bulge));
    expect(res.vertices[1]).toEqual(v(50, 0));
  });

  it('clamps to the neighbour lengths and says so: 100 × 60, all corners r = 80 → r 30', () => {
    const res = filletOutline([v(0, 0), v(100, 0), v(100, 60), v(0, 60)], [0, 1, 2, 3], 80);
    if (!res.ok) throw new Error(res.error);
    expect(res.clamped).toBe(true);
    expect(res.radii).toEqual([30, 30, 30, 30]);
    expect(closedChain(res.vertices)).toBe(true);
  });

  it('refuses arc corners and collinear vertices', () => {
    expect(filletOutline([v(0, 0, 0.4), v(100, 0), v(100, 100), v(0, 100)], [1], 5)).toEqual({
      ok: false,
      error: 'corner',
    });
    expect(filletOutline([v(0, 0), v(50, 0), v(100, 0), v(100, 100)], [1], 5).ok).toBe(false);
  });
});

describe('inner-corner rule (T131, §4.4)', () => {
  it('the L has one sharp concave corner; auto-fix fillets it with the tool radius', () => {
    expect(tightCorners(L, 4)).toEqual([{ kind: 'corner', index: 3, radius: 0, fixable: true }]);
    const fixed = fixTightCorners(L, 4);
    if (!fixed?.ok) throw new Error('not fixed');
    expect(fixed.radii).toEqual([4]);
    // A concave fillet adds material back; the result has no tight corner left.
    expect(area(fixed.vertices)).toBeGreaterThan(area(L));
    expect(tightCorners(fixed.vertices, 4)).toEqual([]);
    // A larger tool flags the 4 mm arc again.
    expect(tightCorners(fixed.vertices, 6)).toEqual([
      { kind: 'arc', index: 3, radius: 4, fixable: false },
    ]);
  });

  it('convex corners stay sharp: a rectangle has nothing to fix', () => {
    expect(tightCorners(deriveOutline(byId(load(), 'side')), 4)).toEqual([]);
    expect(fixTightCorners(deriveOutline(byId(load(), 'side')), 4)).toBeUndefined();
  });
});

describe('filletCorners / convertToFreeform commands (T131)', () => {
  it('filletCorners on a rectangle: freeform, positions kept, one undo step', () => {
    const p0 = load();
    const stack = new CommandStack(p0);
    expect(stack.execute('filletCorners', { id: 'side', corners: [0, 2], r: 20 }, ctx).ok).toBe(
      true,
    );
    const part = byId(stack.project, 'side');
    expect(part.kind).toBe('freeform');
    expect(deriveOutline(part)).toHaveLength(6);
    expect(boardPositions(stack.project)).toEqual(boardPositions(p0));
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
  });

  it('refuses unknown parts, bad corners and r ≤ 0', () => {
    const p = load();
    expect(applyCommand(p, 'filletCorners', { id: 'nope', corners: [0], r: 5 }).ok).toBe(false);
    expect(applyCommand(p, 'filletCorners', { id: 'side', corners: [7], r: 5 }).ok).toBe(false);
    expect(applyCommand(p, 'filletCorners', { id: 'side', corners: [0], r: 0 }).ok).toBe(false);
    // "top" has rounded corners (r 5): its vertices sit between a line and an arc.
    expect(applyCommand(p, 'filletCorners', { id: 'top', corners: [0], r: 2 }).ok).toBe(false);
  });

  it('convertToFreeform keeps the exact outline (incl. rounded corners) and the board place', () => {
    const p0 = load();
    const r = applyCommand(p0, 'convertToFreeform', { id: 'top' });
    if (!r.ok) throw new Error(r.error.message);
    const part = byId(r.project, 'top');
    expect(part.kind).toBe('freeform');
    expect(deriveOutline(part)).toEqual(deriveOutline(byId(p0, 'top')));
    expect(boardPositions(r.project)).toEqual(boardPositions(p0));
    expect(applyCommand(r.project, 'convertToFreeform', { id: 'top' }).ok).toBe(false);
  });
});
