/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester review of T273 (PR #96), independent of the fix: NOISE-tolerant exact fits, lead reach
 * from the lead definition and `holdableStarts` in the cut order.
 *
 * - placeTabs on near-exact loops: a tab never reaches more than NOISE (1e-9 mm) past a straight
 *   edge (into a corner) or into the keep-out around the start point, and the result does not
 *   change when the loop is moved on the sheet.
 * - buildToolpath with a small rectangular opening at random sheet positions: the slug is either
 *   held by ≥ 2 tabs or refused with SMALL_SLUG_UNSECURED (never cut loose silently), the verdict
 *   (held or refused) is the same at every position, and the opening is cut before the outer contour.
 * Run count: env NITTCAM_RUNS (default 60).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NOISE } from '../geometry/constants';
import type { Vertex } from '../geometry/types';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import type { PathSeg } from './path';
import { placeTabs } from './tabs';

const RUNS = Number(
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .NITTCAM_RUNS ?? 60,
);

const line = (x0: number, y0: number, x1: number, y1: number): PathSeg => ({
  p0: { x: x0, y: y0 },
  p1: { x: x1, y: y1 },
  bulge: 0,
});

/** w × h rectangle loop (CW travel) starting at the midpoint of its right edge, moved by (dx, dy). */
function rectLoop(w: number, h: number, dx: number, dy: number): PathSeg[] {
  const pts: [number, number][] = [
    [w, h / 2],
    [w, 0],
    [0, 0],
    [0, h],
    [w, h],
    [w, h / 2],
  ];
  return pts.slice(1).map(([x, y], i) => {
    const [px, py] = pts[i] as [number, number];
    return line(px + dx, py + dy, x + dx, y + dy);
  });
}

/** Arc-length intervals of the straight segments of a loop of lines. */
function straightSpans(segs: readonly PathSeg[]): { lo: number; hi: number }[] {
  let s = 0;
  return segs.map((g) => {
    const l = Math.hypot(g.p1.x - g.p0.x, g.p1.y - g.p0.y);
    const out = { lo: s, hi: s + l };
    s += l;
    return out;
  });
}

describe('T273 tester: NOISE never lets a tab into a corner or a keep-out', () => {
  // Edge lengths are built as an exact fit (tab + tool) plus a perturbation of a few ulps up to
  // 10 NOISE, so the generator hits the hi ≈ lo boundary on purpose.
  const caseArb = fc.record({
    width: fc.constantFrom(1, 4, 6, 10),
    tool: fc.constantFrom(3, 6, 8),
    count: fc.integer({ min: 2, max: 6 }),
    // side lengths as multiples of the raised span with a tiny perturbation
    kw: fc.integer({ min: 1, max: 4 }),
    kh: fc.integer({ min: 1, max: 4 }),
    ew: fc.double({ min: -10 * NOISE, max: 10 * NOISE, noNaN: true }),
    eh: fc.double({ min: -10 * NOISE, max: 10 * NOISE, noNaN: true }),
    keepFwdFrac: fc.double({ min: 0, max: 0.5, noNaN: true }),
    keepBackFrac: fc.double({ min: 0, max: 0.5, noNaN: true }),
    dx: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 3000, noNaN: true })),
    dy: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 2000, noNaN: true })),
  });

  it('property: every tab within a straight edge and outside the keep-outs (± NOISE)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const span = c.width + c.tool;
        const w = c.kw * span + c.ew;
        const h = c.kh * span + c.eh;
        const segs = rectLoop(w, h, c.dx, c.dy);
        const total = 2 * (w + h);
        // keep-outs end exactly on a corner or a tab boundary often (h/2 = half the start edge)
        const keepFwd = c.keepFwdFrac * h;
        const keepBack = c.keepBackFrac * h;
        const tabs = placeTabs(segs, {
          count: c.count,
          width: c.width,
          toolDiameter: c.tool,
          keepFwd,
          keepBack,
          minCount: 2,
          z: -1,
        });
        const spans = straightSpans(segs);
        for (const t of tabs) {
          expect(t.end - t.start).toBeCloseTo(span, 9);
          // inside one straight segment (a corner is a segment end), at most NOISE past it
          const inside = spans.some((s) => t.start >= s.lo - NOISE && t.end <= s.hi + NOISE);
          expect(inside, `tab [${t.start}, ${t.end}] crosses a corner`).toBe(true);
          expect(t.start).toBeGreaterThanOrEqual(keepFwd - NOISE);
          expect(t.end).toBeLessThanOrEqual(total - keepBack + NOISE);
        }
        // neighbouring raised spans never touch
        for (let k = 1; k < tabs.length; k++)
          expect(tabs[k]!.start).toBeGreaterThan(tabs[k - 1]!.end);
      }),
      { numRuns: RUNS * 5 },
    );
  });

  it('property: the same loop gets the same tabs wherever it lies on the sheet', () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        (c, mx, my) => {
          const span = c.width + c.tool;
          const w = c.kw * span;
          const h = c.kh * span;
          const o = {
            count: c.count,
            width: c.width,
            toolDiameter: c.tool,
            keepFwd: c.keepFwdFrac * h,
            keepBack: c.keepBackFrac * h,
            minCount: 2,
            z: -1,
          };
          const home = placeTabs(rectLoop(w, h, 0, 0), o);
          const moved = placeTabs(rectLoop(w, h, mx, my), o);
          expect(moved.length).toBe(home.length);
          moved.forEach((t, k) => {
            expect(Math.abs(t.start - home[k]!.start)).toBeLessThan(1e-6);
          });
        },
      ),
      { numRuns: RUNS * 5 },
    );
  });
});

describe('T273 tester: small slug held or refused, never by position', () => {
  const v = (x: number, y: number): Vertex => ({ x, y, bulge: 0 });
  const profile = goldenProfile('generic');

  function plateAt(a: number, b: number, x: number, y: number, tabsOn: boolean): Project {
    const src = structuredClone(goldenProject(shelfSet, 8)) as unknown as {
      parts: Record<string, unknown>[];
      cutting: { tabs: Record<string, unknown> };
      layout: unknown;
    };
    src.cutting.tabs = { ...src.cutting.tabs, auto: tabsOn };
    src.layout = { sheets: [] };
    src.parts = [
      {
        ...(src.parts[0] as Record<string, unknown>),
        id: 'plate',
        qty: 1,
        holes: [],
        templates: [],
        params: { w: 300, h: 300, r: 0 },
        inners: [[v(100, 100), v(100, 100 + b), v(100 + a, 100 + b), v(100 + a, 100)]],
      },
    ];
    const parsed = parseProject(src);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    return {
      ...parsed.project,
      stock: {
        ...parsed.project.stock,
        sheet: { ...parsed.project.stock.sheet, width: 3000, height: 2000 },
      },
      layout: {
        sheets: [{ placements: [{ partId: 'plate', index: 0, x, y, rot: 0, locked: false }] }],
      },
    };
  }

  function verdict(p: Project) {
    const res = buildToolpath(p, profile);
    const refused = res.errors.some((e) => e.code === 'SMALL_SLUG_UNSECURED');
    const ops = res.toolpath.operations;
    const iInner = ops.findIndex((o) => o.id.endsWith('/inner0'));
    const inner = ops[iInner];
    const iOuter = ops.findIndex((o) => o.partId === 'plate' && !o.id.includes('/inner'));
    return { refused, tabs: inner?.tabs.length ?? 0, iInner, iOuter, ok: res.ok };
  }

  it('property: same held/refused verdict at every position; held = ≥ 2 tabs; opening before outline', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 12, max: 45 }),
        fc.integer({ min: 12, max: 45 }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.boolean(),
        (a, b, fx, fy, tabsOn) => {
          const home = verdict(plateAt(a, b, 62, 62, tabsOn));
          const moved = verdict(plateAt(a, b, 12 + fx * 2680, 12 + fy * 1680, tabsOn));
          for (const r of [home, moved]) {
            // never silently loose: held by ≥ 2 tabs or refused (export blocked)
            expect(r.refused || r.tabs >= 2).toBe(true);
            if (r.refused) expect(r.ok).toBe(false);
            if (r.iInner >= 0 && r.iOuter >= 0) expect(r.iInner).toBeLessThan(r.iOuter);
          }
          expect(moved.refused).toBe(home.refused);
          // the tab count may differ (2 vs 3): the cut order may pick another holdable start edge
          // by travel (D-023), e.g. 27 × 45 at (62, 62) vs (648, 12). Held vs refused may not.
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('27 × 45 opening: held at (62, 62), (648, 12) and (1999.37, 1234.567)', () => {
    for (const [x, y] of [
      [62, 62],
      [648, 12],
      [1999.37, 1234.567],
    ] as const) {
      const r = verdict(plateAt(27, 45, x, y, false));
      expect(r.refused).toBe(false);
      expect(r.tabs).toBeGreaterThanOrEqual(2);
    }
  });

  it('an opening too small for 2 tabs on any edge is still refused (12 × 12, 8 mm tool)', () => {
    const r = verdict(plateAt(12, 12, 648, 12, false));
    expect(r.refused).toBe(true);
    expect(r.ok).toBe(false);
  });
});
