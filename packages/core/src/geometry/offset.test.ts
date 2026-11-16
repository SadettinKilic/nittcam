/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index results whose length is asserted */
/**
 * Fixture tests for `offset` (T007). Expected values are worked out by hand in the comments.
 * Sign convention: d > 0 is to the right of travel, so outer (CCW) contours grow and inner (CW)
 * contours (openings) shrink; d < 0 is the other way.
 */
import { describe, expect, it } from 'vitest';
import mixed from '../schema/__fixtures__/mixed.json';
import { rectOutline } from '../schema/outline';
import { EPS } from './constants';
import { offset, type OffsetResult } from './offset';
import { maxDeviation } from './offset.testing';
import { contour, orientation, reverse, signedArea } from './polyline';
import { translate } from './transform';
import type { Polyline, Vertex } from './types';

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const PI = Math.PI;

function expectOk(r: OffsetResult): Polyline[] {
  if (!r.ok) throw new Error(`offset failed: ${r.reason} ${r.message}`);
  return r.polylines;
}

const arcCount = (p: Polyline) => p.vertices.filter((x) => x.bulge !== 0).length;
const totalArea = (ps: readonly Polyline[]) => ps.reduce((s, p) => s + signedArea(p), 0);
const archPanel = mixed.parts[0] as { outline: Vertex[]; inners: Vertex[][] };

describe('offset: fixtures', () => {
  it('rect 600×400 outward by 3: 4 lines + 4 quarter arcs r=3, area 606·406 − (4 − π)·9', () => {
    const rect = contour(rectOutline({ w: 600, h: 400, r: 0 }));
    const [out] = expectOk(offset(rect, 3));
    expect(out?.vertices).toHaveLength(8);
    expect(arcCount(out!)).toBe(4);
    for (const x of out!.vertices.filter((q) => q.bulge !== 0))
      expect(x.bulge).toBeCloseTo(Math.tan(PI / 8), 12);
    expect(signedArea(out!)).toBeCloseTo(606 * 406 - (4 - PI) * 9, 6);
    expect(maxDeviation([out!], rect, 3)).toBeLessThan(EPS);
  });

  it('rect inward by 3: sharp 594×394 rectangle', () => {
    const rect = contour(rectOutline({ w: 600, h: 400, r: 0 }));
    const [out] = expectOk(offset(rect, -3));
    expect(out?.vertices).toHaveLength(4);
    expect(arcCount(out!)).toBe(0);
    expect(signedArea(out!)).toBeCloseTo(594 * 394, 6);
  });

  it('rounded rect 400×250 r20: out r23, in r17, arcs stay arcs', () => {
    const rr = contour(rectOutline({ w: 400, h: 250, r: 20 }));
    const out = expectOk(offset(rr, 3));
    const inn = expectOk(offset(rr, -3));
    expect(arcCount(out[0]!)).toBe(4);
    expect(arcCount(inn[0]!)).toBe(4);
    expect(out[0]!.vertices).toHaveLength(8);
    expect(signedArea(out[0]!)).toBeCloseTo(406 * 256 - (4 - PI) * 23 * 23, 6);
    expect(signedArea(inn[0]!)).toBeCloseTo(394 * 244 - (4 - PI) * 17 * 17, 6);
  });

  it('window: the CW inner of the arch panel offset by +3 goes into the opening (194×194)', () => {
    const win = contour(archPanel.inners[0]!);
    expect(orientation(win)).toBe('cw');
    const [out] = expectOk(offset(win, 3));
    expect(orientation(out!)).toBe('cw');
    expect(signedArea(out!)).toBeCloseTo(-(194 * 194), 6);
    expect(maxDeviation([out!], win, 3)).toBeLessThan(EPS);
  });

  it('corner radius 2 below tool radius 3 (CW opening): sharp 94×54 corners + ARC_COLLAPSED', () => {
    const hole = reverse(translate(contour(rectOutline({ w: 100, h: 60, r: 2 })), 100, 100));
    const r = offset(hole, 3);
    const [out] = expectOk(r);
    expect(r.ok && r.warnings).toContain('ARC_COLLAPSED');
    expect(out?.vertices).toHaveLength(4);
    expect(signedArea(out!)).toBeCloseTo(-(94 * 54), 6);
    expect(maxDeviation([out!], hole, 3)).toBeLessThan(EPS);
  });

  it('corner radius ≥ tool radius gives no warning', () => {
    const hole = reverse(contour(rectOutline({ w: 100, h: 60, r: 3 })));
    const r = offset(hole, 3);
    expect(r.ok && r.warnings).toEqual([]);
  });

  it('arch panel (mixed.json) outward and inward: the semicircle stays one arc', () => {
    const arch = contour(archPanel.outline);
    const out = expectOk(offset(arch, 3));
    const inn = expectOk(offset(arch, -3));
    // outward: semicircle r=303 + 2 corner joins (r=3) at the bottom corners
    expect(arcCount(out[0]!)).toBe(3);
    expect(out[0]!.vertices.some((x) => Math.abs(x.bulge - 1) < 1e-12)).toBe(true);
    // inward: only the semicircle r=297 is an arc
    expect(arcCount(inn[0]!)).toBe(1);
    // area: 594·497 (rect part) + π·297²/2 (half disc) for the inward offset
    expect(signedArea(inn[0]!)).toBeCloseTo(594 * 497 + (PI * 297 * 297) / 2, 4);
    expect(maxDeviation(out, arch, 3)).toBeLessThan(EPS);
    expect(maxDeviation(inn, arch, 3)).toBeLessThan(EPS);
  });

  describe('slot 200×20 with half-circle ends', () => {
    const slot = contour([v(0, 0), v(200, 0, 1), v(200, 20), v(0, 20, 1)]);
    it('inward by 9 leaves a thin slot 200×2 (area 400 + π)', () => {
      const [out] = expectOk(offset(slot, -9));
      expect(arcCount(out!)).toBe(2);
      expect(signedArea(out!)).toBeCloseTo(400 + PI, 8);
    });
    it('inward by 12 (more than half the width) collapses', () => {
      const r = offset(slot, -12);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toBe('COLLAPSED');
    });
    it('inward by exactly half the width collapses (zero-width result is not a path)', () => {
      expect(offset(slot, -10).ok).toBe(false);
    });
  });

  it('dumbbell: inward by 12 splits at the 20 mm neck into two loops (SPLIT)', () => {
    const dumbbell = contour([
      v(0, 0), v(100, 0), v(100, 40), v(160, 40), v(160, 0), v(260, 0),
      v(260, 100), v(160, 100), v(160, 60), v(100, 60), v(100, 100), v(0, 100),
    ]); // prettier-ignore
    const r = offset(dumbbell, -12);
    const loops = expectOk(r);
    expect(loops).toHaveLength(2);
    expect(r.ok && r.warnings).toContain('SPLIT');
    for (const l of loops) expect(orientation(l)).toBe('ccw');
    // each loop: 76×76 square + the bump towards the neck bounded by two r=12 arcs around
    // (100,40),(100,60): 2·∫₀¹⁰ (12 − √(144 − u²)) du = 2·(120 − 5√44 − 72·asin(5/6))
    const bump = 2 * (120 - 5 * Math.sqrt(44) - 72 * Math.asin(5 / 6));
    expect(totalArea(loops)).toBeCloseTo(2 * (76 * 76 + bump), 6);
    expect(maxDeviation(loops, dumbbell, 12)).toBeLessThan(EPS);
  });

  it('sheet-sized 2440×1220 r10 rounded rect: ±5 within EPS at large coordinates', () => {
    const sheet = translate(contour(rectOutline({ w: 2440, h: 1220, r: 10 })), 1000, 1000);
    const out = expectOk(offset(sheet, 5));
    const inn = expectOk(offset(sheet, -5));
    expect(signedArea(out[0]!)).toBeCloseTo(2450 * 1230 - (4 - PI) * 15 * 15, 4);
    expect(signedArea(inn[0]!)).toBeCloseTo(2430 * 1210 - (4 - PI) * 5 * 5, 4);
    expect(maxDeviation(out, sheet, 5)).toBeLessThan(EPS);
    expect(maxDeviation(inn, sheet, 5)).toBeLessThan(EPS);
  });

  it('circle of two half arcs: radius changes, still two arcs', () => {
    const circle = contour([v(-50, 0, 1), v(50, 0, 1)]);
    const [out] = expectOk(offset(circle, 5));
    expect(out?.vertices).toHaveLength(2);
    expect(signedArea(out!)).toBeCloseTo(PI * 55 * 55, 6);
    const [inn] = expectOk(offset(circle, -5));
    expect(signedArea(inn!)).toBeCloseTo(PI * 45 * 45, 6);
    expect(offset(circle, -50).ok).toBe(false);
  });
});

describe('offset: input checks', () => {
  const square = contour([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);

  it('rejects open polylines', () => {
    expect(offset({ ...square, closed: false }, 1)).toMatchObject({
      ok: false,
      reason: 'NOT_CLOSED',
    });
  });

  it('rejects a non-finite distance', () => {
    expect(offset(square, Number.NaN)).toMatchObject({ ok: false, reason: 'INVALID_DISTANCE' });
    expect(offset(square, Infinity)).toMatchObject({ ok: false, reason: 'INVALID_DISTANCE' });
  });

  it('rejects zero-area contours', () => {
    expect(offset(contour([v(0, 0), v(10, 0)]), 1)).toMatchObject({
      ok: false,
      reason: 'DEGENERATE',
    });
    // a there-and-back line also overlaps itself; either reason is fine, it must not offset
    expect(offset(contour([v(0, 0), v(10, 0), v(20, 0)]), 1).ok).toBe(false);
  });

  it('rejects a self-intersecting contour (bow tie)', () => {
    const bowTie = contour([v(0, 0), v(10, 10), v(10, 0), v(0, 10)]);
    expect(offset(bowTie, 1)).toMatchObject({ ok: false, reason: 'SELF_INTERSECTING' });
  });

  it('d below EPS returns a copy; duplicate vertices are ignored', () => {
    const r = offset(square, 0);
    expect(r).toEqual({ ok: true, polylines: [square], warnings: [] });
    const dup = contour([v(0, 0), v(10, 0), v(10, 0), v(10, 10), v(0, 10)]);
    expect(signedArea(expectOk(offset(dup, -1))[0]!)).toBeCloseTo(64, 9);
  });

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(square)) as Polyline;
    offset(square, 2);
    expect(square).toEqual(copy);
  });
});

describe('offset: regressions found against the CavalierContours port (T007 spike)', () => {
  it('rounded square with 0.001 corner radius, inward 0.00104: full square, not half', () => {
    // side 6.6200585897 (corner arcs r = 0.001 collapse); result side = 6.6200585897 − 2·0.0010414
    const s = 6.6200585897109185;
    const d = 0.0010414213562373043;
    const sq = contour([
      v(0.001, 0), v(s - 0.001, 0, Math.tan(PI / 8)), v(s, 0.001), v(s, s - 0.001, Math.tan(PI / 8)),
      v(s - 0.001, s), v(0.001, s, Math.tan(PI / 8)), v(0, s - 0.001), v(0, 0.001, Math.tan(PI / 8)),
    ]); // prettier-ignore
    const r = offset(sq, -d);
    const [out] = expectOk(r);
    expect(r.ok && r.warnings).toContain('ARC_COLLAPSED');
    expect(signedArea(out!)).toBeCloseTo((s - 2 * d) ** 2, 9);
    expect(maxDeviation([out!], sq, d)).toBeLessThan(EPS);
  });

  it('a 0.004 mm offset into a CW contour is not empty', () => {
    const cw = contour([
      v(21.225635291156223, 0), v(20.60885690561777, -5.0796270096284815),
      v(18.794366666871706, -9.864044561150276), v(12.05753513587852, -17.468355387964586),
      v(2.5584676143062017, -21.070876511899613), v(-7.526714004826516, -19.84631375854783),
      v(-18.794366666871706, -9.86404456115027), v(-20.608856905617774, -5.079627009628474),
      v(-18.794366666871696, 9.86404456115029), v(-12.05753513587854, 17.468355387964575, -1.0343802163843601e-8),
      v(3.3698135190757346, 27.752911208074728, 0.0009993897652427973), v(12.057535135878545, 17.46835538796457),
      v(15.887616152190272, 14.07519969712115), v(20.60885690561777, 5.079627009628481),
    ]); // prettier-ignore
    expect(orientation(cw)).toBe('cw');
    const out = expectOk(offset(cw, 0.004));
    expect(out).toHaveLength(1);
    // shrinks by about perimeter · d: strictly smaller, within 1 %
    const shrink = Math.abs(signedArea(cw)) - Math.abs(signedArea(out[0]!));
    expect(shrink).toBeGreaterThan(0);
    expect(shrink / Math.abs(signedArea(cw))).toBeLessThan(0.01);
    expect(maxDeviation(out, cw, 0.004)).toBeLessThan(EPS);
  });
});
