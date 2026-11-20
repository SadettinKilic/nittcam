/**
 * B50: splitSegment adds a corner in the middle of a segment (CTO #5 "köşe ekle"); the shape does
 * not change, a moved new corner makes an L / a notch; arcs split into two arcs of the same circle.
 */
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { withSegmentSplit } from '../editor/edit';
import { arcOf, segmentLength } from '../geometry/segment';
import { deriveOutline, parseProject, type Project, type Vertex } from '../schema';
import { applyCommand } from './index';

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });

function load(): Project {
  const r = parseProject(JSON.parse(JSON.stringify(shelfSet)));
  if (!r.ok) throw new Error('fixture invalid');
  return r.project;
}

describe('withSegmentSplit (B50)', () => {
  it('puts a new vertex in the middle of a line', () => {
    const r = withSegmentSplit([v(0, 0), v(600, 0), v(600, 400), v(0, 400)], 0);
    expect(r.ok && r.vertices).toEqual([v(0, 0), v(300, 0), v(600, 0), v(600, 400), v(0, 400)]);
  });

  it('cuts an arc into two arcs of the same circle', () => {
    const b = Math.tan(Math.PI / 8); // quarter arc
    const vs = [v(0, 0), v(100, 0, b), v(200, 100), v(0, 100)];
    const r = withSegmentSplit(vs, 1);
    if (!r.ok) throw new Error(r.error);
    const [a, m, c] = [r.vertices[1], r.vertices[2], r.vertices[3]] as Vertex[];
    const whole = arcOf(vs[1] as Vertex, vs[2] as Vertex, b);
    const h1 = arcOf(a, m, a.bulge);
    expect(h1?.radius).toBeCloseTo(whole?.radius ?? NaN, 4);
    expect(segmentLength(a, m, a.bulge) + segmentLength(m, c, m.bulge)).toBeCloseTo(
      segmentLength(vs[1] as Vertex, vs[2] as Vertex, b),
      4,
    );
  });

  it('refuses a missing segment', () => {
    expect(withSegmentSplit([v(0, 0), v(1, 0), v(1, 1)], 5)).toEqual({ ok: false, error: 'index' });
  });
});

describe('splitSegment command (B50)', () => {
  it('turns a rectangle into a freeform part with one more corner, then moveVertex makes a notch', () => {
    const p0 = load();
    const id = p0.parts[0]?.id ?? '';
    const n = deriveOutline(p0.parts[0] as never).length;
    const r = applyCommand(p0, 'splitSegment', { id, index: 2 });
    if (!r.ok) throw new Error(r.error.message);
    const part = r.project.parts[0];
    expect(part?.kind).toBe('freeform');
    expect(deriveOutline(part as never)).toHaveLength(n + 1);
    const mid = deriveOutline(part as never)[3] as Vertex;
    const moved = applyCommand(r.project, 'moveVertex', {
      id,
      index: 3,
      x: mid.x,
      y: mid.y - 50,
    });
    expect(moved.ok).toBe(true);
  });

  it('refuses an index past the outline', () => {
    const p0 = load();
    const r = applyCommand(p0, 'splitSegment', { id: p0.parts[0]?.id, index: 99 });
    expect(r.ok).toBe(false);
  });
});
