import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import mixed from './__fixtures__/mixed.json';
import {
  deriveOutline,
  parseProject,
  QUARTER_ARC_BULGE,
  rectOutline,
  type Part,
  type Vertex,
} from './index';

const TOL = 1e-9;

/** Points along the segment from a to b (bulge of a), arcs sampled. */
function sampleSegment(a: Vertex, b: Vertex, steps = 16): { x: number; y: number }[] {
  if (a.bulge === 0) return [a, b];
  const theta = 4 * Math.atan(a.bulge); // signed sweep, + = CCW
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
  // centre is on the left of the chord for a CCW arc (bulge > 0)
  const h = radius * Math.cos(Math.abs(theta) / 2) * Math.sign(theta);
  const cx = (a.x + b.x) / 2 - (dy / chord) * h;
  const cy = (a.y + b.y) / 2 + (dx / chord) * h;
  const start = Math.atan2(a.y - cy, a.x - cx);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = start + (theta * i) / steps;
    return { x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) };
  });
}

/** Signed area of a closed bulge polyline (positive = CCW). */
function signedArea(vs: Vertex[]): number {
  let area = 0;
  vs.forEach((a, i) => {
    const b = vs[(i + 1) % vs.length] as Vertex;
    area += (a.x * b.y - b.x * a.y) / 2;
    if (a.bulge !== 0) {
      const theta = 4 * Math.atan(a.bulge);
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
      area += (Math.sign(theta) * r * r * (Math.abs(theta) - Math.sin(Math.abs(theta)))) / 2;
    }
  });
  return area;
}

function sampledBbox(vs: Vertex[]) {
  const pts = vs.flatMap((a, i) => sampleSegment(a, vs[(i + 1) % vs.length] as Vertex));
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

const size = fc.double({ min: 1, max: 5000, noNaN: true, noDefaultInfinity: true });
const rectParams = fc
  .record({ w: size, h: size, k: fc.double({ min: 0, max: 1, noNaN: true }) })
  .map(({ w, h, k }) => {
    const r = (k * Math.min(w, h)) / 2;
    // Radii below 1 µm are not physical; snapping them to the kernel EPS is T006's job.
    return { w, h, r: r < 0.001 ? 0 : r };
  });

function checkRectOutline(params: { w: number; h: number; r: number }): void {
  const vs = rectOutline(params);
  // closed: every segment ends at the next vertex; no zero-length line segments
  vs.forEach((a, i) => {
    const b = vs[(i + 1) % vs.length] as Vertex;
    expect(a.bulge === 0 && a.x === b.x && a.y === b.y).toBe(false);
  });
  // CCW
  expect(signedArea(vs)).toBeGreaterThan(0);
  const expectedArea = params.w * params.h - (4 - Math.PI) * params.r * params.r;
  expect(Math.abs(signedArea(vs) - expectedArea)).toBeLessThan(1e-6 * params.w * params.h);
  // bbox equals w × h at the local origin (arcs sampled)
  const bb = sampledBbox(vs);
  expect(bb.minX).toBeGreaterThan(-TOL * params.w);
  expect(bb.minY).toBeGreaterThan(-TOL * params.h);
  expect(Math.abs(bb.maxX - bb.minX - params.w)).toBeLessThan(1e-9 * params.w + TOL);
  expect(Math.abs(bb.maxY - bb.minY - params.h)).toBeLessThan(1e-9 * params.h + TOL);
}

describe('rectOutline / deriveOutline', () => {
  it('r = 0 gives the 4 corners, CCW from the origin', () => {
    expect(rectOutline({ w: 396, h: 716, r: 0 })).toEqual([
      { x: 0, y: 0, bulge: 0 },
      { x: 396, y: 0, bulge: 0 },
      { x: 396, y: 716, bulge: 0 },
      { x: 0, y: 716, bulge: 0 },
    ]);
  });

  it('r > 0 uses quarter arcs with bulge tan(22.5°)', () => {
    const vs = rectOutline({ w: 100, h: 50, r: 10 });
    expect(vs).toHaveLength(8);
    expect(QUARTER_ARC_BULGE).toBeCloseTo(Math.tan((22.5 * Math.PI) / 180), 15);
    expect(vs.filter((v) => v.bulge === QUARTER_ARC_BULGE)).toHaveLength(4);
  });

  it('r = half the shorter side drops zero-length edges', () => {
    expect(rectOutline({ w: 100, h: 100, r: 50 })).toHaveLength(4); // a circle
    expect(rectOutline({ w: 100, h: 40, r: 20 })).toHaveLength(6); // a stadium
    checkRectOutline({ w: 100, h: 100, r: 50 });
    checkRectOutline({ w: 100, h: 40, r: 20 });
  });

  it('property: closed CCW polyline with bbox w × h (r = 0)', () => {
    fc.assert(fc.property(size, size, (w, h) => checkRectOutline({ w, h, r: 0 })));
  });

  it('property: closed CCW polyline with bbox w × h (0 ≤ r ≤ min(w, h) / 2)', () => {
    fc.assert(fc.property(rectParams, checkRectOutline));
  });

  it('rect parts derive from params and ignore a stale stored outline', () => {
    const part = {
      id: 'p',
      name: '',
      qty: 1,
      grainLock: false,
      kind: 'rect',
      params: { w: 10, h: 20, r: 0 },
      outline: [{ x: 0, y: 0, bulge: 0 }],
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    } satisfies Part;
    expect(deriveOutline(part)).toEqual(rectOutline(part.params));
  });

  it('freeform parts return their stored outline (a copy)', () => {
    const result = parseProject(mixed);
    if (!result.ok) throw new Error('fixture invalid');
    const part = result.project.parts.find((p) => p.kind === 'freeform');
    if (part?.kind !== 'freeform') throw new Error('no freeform part');
    const outline = deriveOutline(part);
    expect(outline).toEqual(part.outline);
    expect(outline).not.toBe(part.outline);
    expect(signedArea(outline)).toBeGreaterThan(0); // fixture outline is CCW
    for (const inner of part.inners) expect(signedArea(inner)).toBeLessThan(0); // inners CW
  });
});
