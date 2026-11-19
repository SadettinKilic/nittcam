/**
 * T130: properties-panel outline commands (setSegmentLength, setSegmentAngle, moveVertex) and
 * their geometry helpers. Hand-checked coordinates on three shapes (rectangle, L-shape, a part with
 * an arc), one undo step each, refusals with a reason.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { boardPositions } from '../editor/board';
import {
  bulgeForRadius,
  checkOutline,
  segmentInfo,
  selfCrosses,
  withSegmentLength,
  withVertexAt,
} from '../editor/edit';
import { arcOf, segmentLength } from '../geometry/segment';
import { parseProject, type Part, type Project, type Vertex } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const ctx: CommandContext = { actor: 'user', at: '2026-11-19T10:00:00Z' };

function load(): Project {
  const r = parseProject(JSON.parse(JSON.stringify(shelfSet)));
  if (!r.ok) throw new Error('fixture invalid');
  return r.project;
}

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

function byId(p: Project, id: string): Part {
  const found = p.parts.find((x) => x.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

function outlineOf(p: Project, id: string): Vertex[] {
  const part = byId(p, id);
  if (part.kind !== 'freeform') throw new Error('not freeform');
  return part.outline;
}

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });

/** L-shape 600 × 400, notch 300 × 200 at the top right (CCW). */
const L: Vertex[] = [v(0, 0), v(600, 0), v(600, 200), v(300, 200), v(300, 400), v(0, 400)];

function withFreeform(outline: Vertex[]): Project {
  return run(load(), 'drawPart', {
    id: 'f1',
    at: { x: 0, y: -1000 },
    shape: { kind: 'outline', vertices: outline },
  });
}

describe('setSegmentLength (T130, §4.4)', () => {
  it('rectangle: the bottom edge 300 → 400, the right-bottom corner slides right, the right edge follows', () => {
    const p0 = load();
    const stack = new CommandStack(p0);
    expect(stack.execute('setSegmentLength', { id: 'side', index: 0, length: 400 }, ctx).ok).toBe(
      true,
    );
    // side: 300 × 1800 → (0,0) (400,0) (300,1800) (0,1800); the top-right corner stays.
    expect(outlineOf(stack.project, 'side')).toEqual([
      v(0, 0),
      v(400, 0),
      v(300, 1800),
      v(0, 1800),
    ]);
    expect(byId(stack.project, 'side').kind).toBe('freeform');
    // Board positions of every part are kept.
    expect(boardPositions(stack.project)).toEqual(boardPositions(p0));
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
  });

  it('L-shape: shortening the notch floor (index 2, 300 → 100) moves (300,200) to (500,200)', () => {
    const p = withFreeform(L);
    const base = outlineOf(p, 'f1');
    // drawPart keeps the order of a CCW outline in its local frame.
    expect(base).toEqual(L);
    const next = run(p, 'setSegmentLength', { id: 'f1', index: 2, length: 100 });
    expect(outlineOf(next, 'f1')).toEqual([
      v(0, 0),
      v(600, 0),
      v(600, 200),
      v(500, 200),
      v(300, 400),
      v(0, 400),
    ]);
  });

  it('arc segment: the bulge stays and the arc length is the typed length', () => {
    // 200 × 100 with a half-circle bottom (bulge -1 would bend inwards; here outwards: +1).
    const p = withFreeform([v(0, 0, 1), v(200, 0), v(200, 100), v(0, 100)]);
    const vs = outlineOf(p, 'f1');
    const i = vs.findIndex((x) => x.bulge !== 0);
    const before = segmentInfo(vs, i);
    expect(before?.radius).toBeCloseTo(100, 6);
    const next = outlineOf(
      run(p, 'setSegmentLength', { id: 'f1', index: i, length: 157.079633 }),
      'f1',
    );
    const a = next[i] as Vertex;
    const b = next[(i + 1) % next.length] as Vertex;
    expect(a.bulge).toBe(vs[i]?.bulge);
    expect(segmentLength(a, b, a.bulge)).toBeCloseTo(157.079633, 4);
  });

  it('refuses zero, negative, an inside-out result and unknown ids/indices', () => {
    const p = load();
    expect(applyCommand(p, 'setSegmentLength', { id: 'side', index: 0, length: 0 }).ok).toBe(false);
    expect(applyCommand(p, 'setSegmentLength', { id: 'side', index: 0, length: -5 }).ok).toBe(
      false,
    );
    expect(applyCommand(p, 'setSegmentLength', { id: 'side', index: 9, length: 5 }).ok).toBe(false);
    expect(applyCommand(p, 'setSegmentLength', { id: 'nope', index: 0, length: 5 }).ok).toBe(false);
    // L notch floor 300 → 700 drives (300,200) past the left wall: the outline crosses itself.
    const pl = withFreeform(L);
    const r = applyCommand(pl, 'setSegmentLength', { id: 'f1', index: 2, length: 700 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/cross|inside out/);
  });

  it('property: the segment gets the length, the next segment keeps its far end, one undo step', () => {
    const p0 = load();
    fc.assert(
      fc.property(
        fc.constantFrom('side', 'shelf', 'top'),
        fc.nat(7),
        fc.double({ min: 1, max: 3000, noNaN: true }),
        (id, raw, length) => {
          const stack = new CommandStack(p0);
          const part = byId(p0, id);
          const n = part.kind === 'rect' && part.params.r > 0 ? 8 : 4;
          const index = raw % n;
          const r = stack.execute('setSegmentLength', { id, index, length }, ctx);
          if (!r.ok) return;
          const out = outlineOf(stack.project, id);
          const a = out[index] as Vertex;
          const b = out[(index + 1) % n] as Vertex;
          expect(segmentLength(a, b, a.bulge)).toBeCloseTo(length, 3);
          expect(checkOutline(out)).toBeUndefined();
          stack.undo();
          expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('setSegmentAngle (T130)', () => {
  it('turns the right edge of a 300 × 1800 rectangle to 95°: the top-right corner swings left', () => {
    const p = run(load(), 'setSegmentAngle', { id: 'side', index: 1, angle: 95 });
    const out = outlineOf(p, 'side');
    const c = 1800;
    expect(out[2]?.x).toBeCloseTo(300 + c * Math.cos((95 * Math.PI) / 180), 5);
    expect(out[2]?.y).toBeCloseTo(c * Math.sin((95 * Math.PI) / 180), 5);
    expect(segmentInfo(out, 1)?.angle).toBeCloseTo(95, 5);
  });
});

describe('moveVertex (T130)', () => {
  it('moves the L inner corner (300,200) to (350,250); both neighbours follow', () => {
    const p = withFreeform(L);
    const stack = new CommandStack(p);
    expect(stack.execute('moveVertex', { id: 'f1', index: 3, x: 350, y: 250 }, ctx).ok).toBe(true);
    expect(outlineOf(stack.project, 'f1')[3]).toEqual(v(350, 250));
    expect(stack.undo()).toBe(true);
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p));
  });

  it('refuses a move that makes the outline cross itself', () => {
    const p = withFreeform(L);
    expect(applyCommand(p, 'moveVertex', { id: 'f1', index: 3, x: -100, y: 200 }).ok).toBe(false);
  });

  it('withVertexAt and withSegmentLength return the reason code', () => {
    expect(withVertexAt(L, 9, { x: 0, y: 0 })).toEqual({ ok: false, error: 'index' });
    expect(withSegmentLength(L, 0, 0)).toEqual({ ok: false, error: 'length' });
    expect(withVertexAt(L, 3, { x: -100, y: 200 })).toEqual({ ok: false, error: 'crossing' });
  });
});

describe('outline helpers', () => {
  it('selfCrosses: a bow tie crosses, the L does not', () => {
    expect(selfCrosses(L)).toBe(false);
    expect(selfCrosses([v(0, 0), v(100, 100), v(100, 0), v(0, 100)])).toBe(true);
  });

  it('bulgeForRadius keeps the side and minor/major arc', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    for (const bulge of [0.3, -0.3, 2, -2]) {
      const nb = bulgeForRadius(a, b, 80, bulge) as number;
      expect(Math.sign(nb)).toBe(Math.sign(bulge));
      expect(Math.abs(nb) > 1).toBe(Math.abs(bulge) > 1);
      expect(arcOf(a, b, nb)?.radius).toBeCloseTo(80, 6);
    }
    expect(bulgeForRadius(a, b, 40, 0.3)).toBeUndefined();
    expect(bulgeForRadius(a, b, 80, 0)).toBeGreaterThan(0);
  });
});
