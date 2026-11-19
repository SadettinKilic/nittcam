/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * T273: tab placement must not depend on where a part lies. Exact fits (a tab that fills a
 * straight edge from corner to corner) are decided with the NOISE tolerance, and the lead's reach
 * comes from its definition, so the same cut-out is held (or refused) on any sheet position;
 * `unsecuredSlugs` (T270) relies on that.
 */
import { describe, expect, it } from 'vitest';
import { NOISE } from '../geometry/constants';
import type { Vertex } from '../geometry/types';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import type { PathSeg } from './path';
import { evenTabCentres, placeTabs, tabCentreIntervals } from './tabs';

const line = (x0: number, y0: number, x1: number, y1: number): PathSeg => ({
  p0: { x: x0, y: y0 },
  p1: { x: x1, y: y1 },
  bulge: 0,
});

/** 18 × 16 loop starting at the middle of its right edge (CW travel), shifted by (dx, dy). */
function loop(dx: number, dy: number): PathSeg[] {
  const pts: [number, number][] = [
    [18, 8],
    [18, 0],
    [0, 0],
    [0, 16],
    [18, 16],
    [18, 8],
  ];
  return pts.slice(1).map(([x, y], i) => {
    const [px, py] = pts[i] as [number, number];
    return line(px + dx, py + dy, x + dx, y + dy);
  });
}

describe('exact-fit tabs (T273)', () => {
  it('a tab exactly as long as a straight edge fits, also with rounding noise on the edge', () => {
    // a 10 mm tab + 8 mm tool on an 18 mm edge: the centre interval is a single point
    expect(tabCentreIntervals([line(0, 0, 18, 0)], 9, 0, 0)).toEqual([{ lo: 9, hi: 9 }]);
    // the same edge a few ulps short (as a placed copy may compute it) still fits
    const short = 18 - NOISE / 100;
    const ivs = tabCentreIntervals([line(0, 0, short, 0)], 9, 0, 0);
    expect(ivs).toHaveLength(1);
    expect(ivs[0]!.hi).toBe(ivs[0]!.lo);
    // a real shortfall (well above the noise) does not
    expect(tabCentreIntervals([line(0, 0, 18 - 10 * NOISE, 0)], 9, 0, 0)).toEqual([]);
  });

  it('evenTabCentres keeps a degenerate phase interval', () => {
    expect(evenTabCentres([{ lo: 17, hi: 17 - NOISE / 100 }], 68, 1)).not.toBeNull();
  });

  it('the same loop gets the same tabs wherever it lies on the sheet', () => {
    const o = {
      count: 2,
      width: 10,
      toolDiameter: 8,
      keepFwd: 4,
      // the last tab ends exactly where the keep-out before the start point begins
      keepBack: 8,
      minCount: 2,
      z: -15,
      onArcs: true,
    };
    const at = (dx: number, dy: number) => placeTabs(loop(dx, dy), o).map((t) => [t.start, t.end]);
    const home = at(0, 0);
    expect(home).toHaveLength(2);
    for (const [dx, dy] of [
      [62.3, 62.7],
      [648, 12],
      [1999.9, 1234.567],
    ] as const) {
      const moved = at(dx, dy);
      expect(moved).toHaveLength(2);
      moved.forEach(([s, e], k) => {
        expect(Math.abs(s! - home[k]![0]!)).toBeLessThan(1e-9);
        expect(Math.abs(e! - home[k]![1]!)).toBeLessThan(1e-9);
      });
    }
  });
});

describe('small slug held on any sheet position (T273, slug-check scan)', () => {
  const v = (x: number, y: number): Vertex => ({ x, y, bulge: 0 });
  const profile = goldenProfile('generic');

  // 26 × 24 opening, 8 mm tool: an 18 × 16 tool loop whose 2 tabs fill two edges exactly. On
  // main it was held at (62, 62) but refused at (648, 12), the nested position.
  it.each([
    [62, 62],
    [648, 12],
    [1203.25, 401.5],
  ])('26 × 24 opening at (%s, %s): 2 tabs, no SMALL_SLUG_UNSECURED', (x, y) => {
    const src = structuredClone(goldenProject(shelfSet, 8)) as unknown as {
      parts: Record<string, unknown>[];
      cutting: { tabs: Record<string, unknown> };
      layout: unknown;
    };
    src.cutting.tabs = { ...src.cutting.tabs, auto: false };
    src.layout = { sheets: [] };
    src.parts = [
      {
        ...(src.parts[0] as Record<string, unknown>),
        id: 'plate',
        qty: 1,
        holes: [],
        templates: [],
        params: { w: 596, h: 716, r: 0 },
        inners: [[v(100, 100), v(100, 124), v(126, 124), v(126, 100)]],
      },
    ];
    const parsed = parseProject(src);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const p: Project = {
      ...parsed.project,
      stock: {
        ...parsed.project.stock,
        sheet: { ...parsed.project.stock.sheet, width: 3000, height: 3000 },
      },
      layout: {
        sheets: [{ placements: [{ partId: 'plate', index: 0, x, y, rot: 0, locked: false }] }],
      },
    };
    const res = buildToolpath(p, profile);
    expect(res.errors.map((e) => e.code)).not.toContain('SMALL_SLUG_UNSECURED');
    const op = res.toolpath.operations.find((o) => o.id.endsWith('/inner0'));
    expect(op?.tabs).toHaveLength(2);
  });
});
