/* eslint-disable @typescript-eslint/no-non-null-assertion -- test lookups on known fixtures */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CURVE_TOL } from '../geometry/constants';
import { sampleSegment } from '../geometry/segment';
import type { Point, Polyline } from '../geometry/types';
import { distToSegment, nurbsPoint } from './curves';
import { convertDxf, detectDxfFormat, parseDxf, readDxf } from './read';
import type { DxfDrawing } from './types';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

function load(name: string): DxfDrawing {
  const r = readDxf(fixture(name));
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Distance from p to a polyline (arcs sampled finely). */
function distToPoly(p: Point, poly: Polyline): number {
  const vs = poly.vertices;
  const n = vs.length;
  const count = poly.closed ? n : n - 1;
  let best = Infinity;
  for (let i = 0; i < count; i++) {
    const a = vs[i]!;
    const b = vs[(i + 1) % n]!;
    const pts = a.bulge === 0 ? [a, b] : sampleSegment(a, b, a.bulge, 256);
    for (let k = 0; k + 1 < pts.length; k++)
      best = Math.min(best, distToSegment(p, pts[k]!, pts[k + 1]!));
  }
  return best;
}

/** A minimal DXF with the given ENTITIES groups. */
function dxf(entities: string, insunits = 4): string {
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${insunits}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}

describe('file detection', () => {
  it('recognises DWG and binary DXF by their first bytes', () => {
    expect(detectDxfFormat('AC1032\u0000\u0000')).toBe('dwg');
    expect(detectDxfFormat('AutoCAD Binary DXF\r\n')).toBe('binary-dxf');
    expect(detectDxfFormat('  0\nSECTION')).toBe('dxf');
    expect(parseDxf('AC1027 junk')).toEqual({ ok: false, error: 'DWG' });
  });

  it('refuses unreadable and empty files', () => {
    expect(parseDxf('hello world')).toEqual({ ok: false, error: 'PARSE_FAILED' });
    expect(parseDxf('0\nSECTION\n2\nENTITIES\n0\nLINE\n10\nabc\n')).toEqual({
      ok: false,
      error: 'PARSE_FAILED',
    });
    expect(readDxf(dxf('0\nTEXT\n8\nA\n10\n0\n20\n0\n40\n5\n1\nHi\n'))).toEqual({
      ok: false,
      error: 'EMPTY',
    });
  });
});

describe('fixture reports', () => {
  it('rect-lines-gaps: lines kept open, annotations counted as ignored (CRLF file)', () => {
    const d = load('rect-lines-gaps.dxf');
    expect(d.report.supported).toEqual({ LINE: 6 });
    expect(d.report.ignored).toEqual({ TEXT: 1, MTEXT: 1, DIMENSION: 1, HATCH: 1 });
    expect(d.layers).toEqual(['CUT', 'SCRIBE']);
    expect(d.paths.every((p) => !p.poly.closed)).toBe(true);
    expect(d.units).toEqual({ insunits: 4, unit: 'mm', scale: 1 });
  });

  it('lwpoly-bulge: bulge signs preserved, mirrored OCS arc flips direction', () => {
    const d = load('lwpoly-bulge.dxf');
    expect(d.report.supported).toEqual({ LWPOLYLINE: 2, CIRCLE: 1, ARC: 2 });
    const outer = d.paths.find((p) => p.layer === 'OUTER')!;
    expect(outer.poly.closed).toBe(true);
    expect(outer.poly.vertices.filter((v) => v.bulge > 0)).toHaveLength(4);
    const slot = d.paths.find((p) => p.layer === 'INNER')!;
    expect(slot.poly.vertices.map((v) => v.bulge)).toEqual([-1, 0, -1, 0]);
    const hole = d.paths.find((p) => p.layer === 'HOLES')!;
    expect(hole.circle).toEqual({ cx: 50, cy: 50, d: 20 });
    const [plain, mirrored] = d.paths.filter((p) => p.layer === 'MISC');
    expect(plain!.poly.vertices[0]!.bulge).toBeGreaterThan(0);
    // OCS (−250, 150) with extrusion −Z = world (250, 150); 0°→90° CCW in OCS is CW in the world.
    expect(mirrored!.poly.vertices[0]!.x).toBeCloseTo(235, 9);
    expect(mirrored!.poly.vertices[0]!.y).toBeCloseTo(150, 9);
    expect(mirrored!.poly.vertices[1]!.y).toBeCloseTo(165, 9);
    expect(mirrored!.poly.vertices[0]!.bulge).toBeCloseTo(-Math.tan(Math.PI / 8), 12);
  });

  it('polyline-r12: closed POLYLINE with a bulge; a non-flat 3D polyline is skipped', () => {
    const d = load('polyline-r12.dxf');
    expect(d.report.supported).toEqual({ POLYLINE: 1 });
    expect(d.report.skipped).toEqual({ NOT_FLAT: 1 });
    expect(d.paths[0]!.poly.closed).toBe(true);
    expect(d.paths[0]!.poly.vertices.map((v) => v.bulge)).toEqual([0, 1, 0, 0]);
    expect(d.bbox).toEqual({ minX: 0, minY: 0, maxX: 250, maxY: 100 });
  });

  it('insert-block: one level expanded, nested/missing/paper space counted', () => {
    const d = load('insert-block.dxf');
    // 4 INSERTs + one 2×2 array = 8 copies of 3 entities each.
    expect(d.report.inserts).toBe(5);
    expect(d.report.supported).toEqual({ LWPOLYLINE: 8, CIRCLE: 8, ARC: 8 });
    expect(d.report.skipped).toEqual({ NESTED_INSERT: 8, MISSING_BLOCK: 1, PAPER_SPACE: 1 });
    // Layer "0" inside the block takes the INSERT's layer; DRILL stays DRILL.
    expect(d.layers).toEqual(['CUT', 'DRILL']);
    const rects = d.paths.filter((p) => p.type === 'LWPOLYLINE');
    const box = (p: (typeof rects)[number]) => {
      const xs = p.poly.vertices.map((v) => v.x);
      const ys = p.poly.vertices.map((v) => v.y);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(
        (n) => Math.round(n * 1e6) / 1e6,
      );
    };
    expect(box(rects[0]!)).toEqual([0, 0, 100, 50]); // base point (10, 10) moved to the origin
    expect(box(rects[1]!)).toEqual([400, 0, 500, 200]); // ×2, rotated 90°, at (500, 0)
    expect(box(rects[2]!)).toEqual([900, 0, 1000, 50]); // mirrored in X
    expect(box(rects[3]!)).toEqual([0, 500, 200, 550]); // non-uniform ×2 / ×1
    expect(rects.slice(4).map(box)).toEqual([
      [0, 1000, 100, 1050],
      [150, 1000, 250, 1050],
      [0, 1100, 100, 1150],
      [150, 1100, 250, 1150],
    ]);
    const arcs = d.paths.filter((p) => p.type === 'ARC');
    expect(arcs[0]!.poly.vertices[0]!.bulge).toBeGreaterThan(0);
    expect(arcs[2]!.poly.vertices[0]!.bulge).toBeLessThan(0); // mirror flips the arc
    // Non-uniform scale: the arc becomes lines within CURVE_TOL and the circle loses its marker.
    expect(arcs[3]!.poly.vertices.every((v) => v.bulge === 0)).toBe(true);
    const circles = d.paths.filter((p) => p.type === 'CIRCLE');
    expect(circles[1]!.circle!.d).toBeCloseTo(20, 9);
    expect(circles[3]!.circle).toBeUndefined();
    // The flattened ellipse of the non-uniform circle stays within tolerance of the true curve.
    const c = circles[3]!;
    for (let k = 0; k < 360; k++) {
      const t = (k * Math.PI) / 180;
      // Block circle (30, 30) r 5 → base (10, 10) → ×(2, 1) → at (0, 500).
      const p = { x: 2 * (20 + 5 * Math.cos(t)), y: 500 + 20 + 5 * Math.sin(t) };
      expect(distToPoly(p, c.poly)).toBeLessThanOrEqual(CURVE_TOL);
    }
  });

  it('sign-letters: letters as polylines, O rings as circles, hatch and text ignored', () => {
    const d = load('sign-letters.dxf');
    expect(d.report.supported).toEqual({ LWPOLYLINE: 3, LINE: 6 });
    expect(d.report.ignored).toEqual({ HATCH: 1, MTEXT: 1 });
    expect(d.paths.filter((p) => p.poly.closed)).toHaveLength(3);
  });
});

describe('units', () => {
  it('reads $INSUNITS (inch → ×25.4)', () => {
    const d = load('inch-units.dxf');
    expect(d.units).toEqual({ insunits: 1, unit: 'in', scale: 25.4 });
    expect(d.bbox).toEqual({ minX: 0, minY: 0, maxX: 254, maxY: 127 });
  });

  it('missing units → UNIT_UNCERTAIN with a suggestion; a chosen unit clears it', () => {
    const d = load('no-units-small.dxf');
    expect(d.units.uncertain).toEqual({
      code: 'UNIT_UNCERTAIN',
      reason: 'missing',
      suggested: 'in',
    });
    const r = readDxf(fixture('no-units-small.dxf'), { unit: 'cm' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.units).toEqual({ insunits: undefined, unit: 'cm', scale: 10 });
    expect(r.value.bbox).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 30 });
  });

  it('a known unit with an implausible size is suspicious too', () => {
    const tiny = dxf('0\nLINE\n8\n0\n10\n0\n20\n0\n11\n2\n21\n0\n');
    const r = readDxf(tiny, {});
    if (!r.ok) throw new Error(r.error);
    expect(r.value.units.uncertain).toEqual({
      code: 'UNIT_UNCERTAIN',
      reason: 'size',
      suggested: 'in',
    });
    const unitless = readDxf(dxf('0\nLINE\n8\n0\n10\n0\n20\n0\n11\n200\n21\n0\n', 0));
    if (!unitless.ok) throw new Error(unitless.error);
    expect(unitless.value.units.uncertain).toEqual({ code: 'UNIT_UNCERTAIN', reason: 'unitless' });
  });
});

describe('curves', () => {
  const d = load('spline-ellipse.dxf');

  it('counts SPLINE and ELLIPSE as converted, fit-point splines separately', () => {
    expect(d.report.converted).toEqual({ SPLINE: 3, ELLIPSE: 3 });
    expect(d.report.fitPointSplines).toBe(1);
    expect(d.report.supported).toEqual({});
  });

  it('rational quarter circle: every vertex on the circle, chords within CURVE_TOL', () => {
    const q = d.paths[0]!;
    expect(q.poly.closed).toBe(false);
    for (const v of q.poly.vertices) expect(Math.hypot(v.x, v.y)).toBeCloseTo(100, 9);
    for (let k = 0; k <= 900; k++) {
      const t = (k / 900) * (Math.PI / 2);
      expect(
        distToPoly({ x: 100 * Math.cos(t), y: 100 * Math.sin(t) }, q.poly),
      ).toBeLessThanOrEqual(CURVE_TOL);
    }
  });

  it('closed cubic B-spline: closed, within CURVE_TOL of the de Boor curve', () => {
    const s = d.paths[1]!;
    expect(s.poly.closed).toBe(true);
    const curve = {
      degree: 3,
      knots: [0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 4],
      controls: [
        { x: 300, y: 0 },
        { x: 400, y: 0 },
        { x: 450, y: 80 },
        { x: 400, y: 160 },
        { x: 300, y: 160 },
        { x: 250, y: 80 },
        { x: 300, y: 0 },
      ],
    };
    for (let k = 0; k <= 2000; k++) {
      expect(distToPoly(nurbsPoint(curve, (4 * k) / 2000), s.poly)).toBeLessThanOrEqual(CURVE_TOL);
    }
  });

  it('ellipses: full one closed, half one open, circular one exact with a circle marker', () => {
    const [full, half, round] = d.paths.filter((p) => p.type === 'ELLIPSE');
    expect(full!.poly.closed).toBe(true);
    for (let k = 0; k < 720; k++) {
      const t = (k * Math.PI) / 360;
      const p = { x: 600 + 80 * Math.cos(t), y: 100 + 40 * Math.sin(t) };
      expect(distToPoly(p, full!.poly)).toBeLessThanOrEqual(CURVE_TOL);
    }
    expect(half!.poly.closed).toBe(false);
    expect(round!.circle).toEqual({ cx: 1000, cy: 100, d: 100 });
    expect(round!.poly.vertices).toHaveLength(2);
  });

  it('property: any DXF ARC keeps its end points, radius and CCW sweep', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 0.5, max: 500, noNaN: true }),
        fc.integer({ min: 0, max: 359 }),
        fc.integer({ min: 1, max: 359 }),
        (cx, cy, r, a0, sweep) => {
          const a1 = (a0 + sweep) % 360;
          const text = dxf(`0\nARC\n8\nA\n10\n${cx}\n20\n${cy}\n40\n${r}\n50\n${a0}\n51\n${a1}\n`);
          const res = readDxf(text, { unit: 'mm' });
          if (!res.ok) throw new Error(res.error);
          const poly = res.value.paths[0]!.poly;
          const first = poly.vertices[0]!;
          const last = poly.vertices[poly.vertices.length - 1]!;
          const rad = Math.PI / 180;
          expect(first.x).toBeCloseTo(cx + r * Math.cos(a0 * rad), 6);
          expect(first.y).toBeCloseTo(cy + r * Math.sin(a0 * rad), 6);
          expect(last.x).toBeCloseTo(cx + r * Math.cos(a1 * rad), 6);
          expect(last.y).toBeCloseTo(cy + r * Math.sin(a1 * rad), 6);
          const total = poly.vertices.slice(0, -1).reduce((s, v) => s + 4 * Math.atan(v.bulge), 0);
          expect(total).toBeCloseTo(sweep * rad, 9);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('purity', () => {
  it('same text, same result', () => {
    const text = fixture('insert-block.dxf');
    const a = parseDxf(text);
    const b = parseDxf(text);
    if (!a.ok || !b.ok) throw new Error('parse');
    expect(convertDxf(a.value)).toEqual(convertDxf(b.value));
  });
});
