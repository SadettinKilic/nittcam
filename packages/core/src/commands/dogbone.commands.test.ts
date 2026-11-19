/**
 * T132: dogbone / T-bone overcuts. The tool-centre path (offset by the tool radius, the same
 * offset the toolpath uses) reaches the corner point within EPS after the overcut, and does not
 * before it.
 */
import { describe, expect, it } from 'vitest';
import { dogboneOutline } from '../editor/corners';
import { EPS } from '../geometry/constants';
import { offset } from '../geometry/offset';
import { contour, forEachSegment, orientation } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Point, Vertex } from '../geometry/types';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const L: Vertex[] = [v(0, 0), v(600, 0), v(600, 200), v(300, 200), v(300, 400), v(0, 400)];
const CORNER = { x: 300, y: 200 };
const R = 4;

/** Distance from p to the closest point of segment a–b. */
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How far the tool edge stays from `p`: min distance from p to the centre path minus R. */
function gap(vs: Vertex[], p: Point, r: number): number {
  const res = offset(contour(vs), r);
  if (!res.ok) throw new Error(res.message);
  let best = Infinity;
  for (const pl of res.polylines) {
    forEachSegment(pl, (a, b, bulge) => {
      const pts = sampleSegment(a, b, bulge, 2048);
      for (let i = 0; i + 1 < pts.length; i++) {
        best = Math.min(best, toSegment(p, pts[i] as Point, pts[i + 1] as Point));
      }
    });
  }
  return best - r;
}

describe('dogboneOutline (T132)', () => {
  it('without an overcut the tool cannot reach the inner corner', () => {
    expect(gap(L, CORNER, R)).toBeGreaterThan(1);
  });

  for (const style of ['dogbone', 'tbone-prev', 'tbone-next'] as const) {
    it(`${style}: the tool reaches the corner point within EPS; CCW kept`, () => {
      const res = dogboneOutline(L, 3, R, style);
      if (!res.ok) throw new Error(res.error);
      expect(orientation(contour(res.vertices))).toBe('ccw');
      expect(Math.abs(gap(res.vertices, CORNER, R))).toBeLessThanOrEqual(EPS);
    });
  }

  it('dogbone geometry: tangent points √2·R along each edge, the arc passes the corner', () => {
    const res = dogboneOutline(L, 3, R, 'dogbone');
    if (!res.ok) throw new Error(res.error);
    expect(res.vertices).toHaveLength(7);
    expect(res.vertices[3]?.x).toBeCloseTo(300 + Math.SQRT2 * R, 6);
    expect(res.vertices[3]?.y).toBeCloseTo(200, 6);
    expect(res.vertices[4]).toEqual(v(300, Number((200 + Math.SQRT2 * R).toFixed(6))));
  });

  it('T-bone along the incoming edge overcuts below it (into the material), half circle', () => {
    const res = dogboneOutline(L, 3, R, 'tbone-prev');
    if (!res.ok) throw new Error(res.error);
    expect(res.vertices[3]).toMatchObject({ x: 308, y: 200 });
    expect(Math.abs(res.vertices[3]?.bulge ?? 0)).toBeCloseTo(1, 6);
    expect(res.vertices[4]).toMatchObject({ x: 300, y: 200, bulge: 0 });
  });

  it('refuses convex corners, arc corners and a radius that does not fit', () => {
    expect(dogboneOutline(L, 1, R, 'dogbone')).toEqual({ ok: false, error: 'corner' });
    expect(dogboneOutline(L, 3, 200, 'tbone-prev')).toEqual({ ok: false, error: 'length' });
    expect(dogboneOutline(L, 9, R, 'dogbone')).toEqual({ ok: false, error: 'index' });
  });
});

describe('addDogbone command (T132)', () => {
  it('one undo step; refused on a rectangle corner', () => {
    const r0 = parseProject(JSON.parse(JSON.stringify(shelfSet)));
    if (!r0.ok) throw new Error('fixture');
    const drawn = applyCommand(r0.project, 'drawPart', {
      id: 'f1',
      at: { x: 0, y: -1000 },
      shape: { kind: 'outline', vertices: L },
    });
    if (!drawn.ok) throw new Error(drawn.error.message);
    const p: Project = drawn.project;
    const stack = new CommandStack(p);
    const ctx: CommandContext = { actor: 'user', at: '2026-11-19T10:00:00Z' };
    expect(
      stack.execute('addDogbone', { id: 'f1', corner: 3, r: R, style: 'dogbone' }, ctx).ok,
    ).toBe(true);
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p));
    expect(
      applyCommand(p, 'addDogbone', { id: 'side', corner: 0, r: R, style: 'dogbone' }).ok,
    ).toBe(false);
  });
});
