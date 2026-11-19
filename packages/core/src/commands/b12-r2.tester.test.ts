/**
 * B12 tester round 2 (delta): the round-1 fixes and D-049, read back from the G-code.
 * - B1: asymmetric cut-outs (triangle, L) on a copy turned by 30° and on a mirrored part pass the
 *   independent layout check; every cut-out loop is counted as expected, not as an extra part.
 * - D-049: a small slug is held by ≥ 2 tabs read from the program (rise to the tab top, a raised
 *   span of width + tool diameter, back down), the same tabs on every pass below the tab top,
 *   spread around the opening; a large slug follows the project's tab setting; a slug too small
 *   for 2 tabs blocks the export.
 */
import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { bbox } from '../geometry/polyline';
import type { Vertex } from '../geometry/types';
import { nestProject } from '../nesting';
import { exportNc } from '../export';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { buildToolpath, placedInners } from '../toolpath/build';

const TOOL_D = 8;
const THICK = 18;
const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const rect = (x0: number, y0: number, x1: number, y1: number): Vertex[] => [
  v(x0, y0),
  v(x0, y1),
  v(x1, y1),
  v(x1, y0),
];
const circle = (cx: number, cy: number, r: number): Vertex[] => [
  v(cx - r, cy, -1),
  v(cx + r, cy, -1),
];
const pv = (post: 'generic' | 'mach3') => ({
  profile: goldenProfile(post),
  version: 1,
  verification: 'draft' as const,
});

type RawPart = Record<string, unknown>;

/** Only the given parts (grain free), nested; `place` may override the placements. */
function projectWith(
  parts: RawPart[],
  opts: { tabsOn?: boolean; place?: (p: Project) => Project } = {},
): Project {
  const src = structuredClone(goldenProject(shelfSet, TOOL_D)) as unknown as {
    parts: RawPart[];
    cutting: { tabs: Record<string, unknown> };
  };
  const proto = src.parts[0] as RawPart;
  src.cutting.tabs = { ...src.cutting.tabs, auto: opts.tabsOn ?? false };
  (src as unknown as { layout: unknown }).layout = { sheets: [] };
  src.parts = parts.map((p) => ({
    ...proto,
    holes: [],
    templates: [],
    grain: { mode: 'free', angle: 0 },
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    ...p,
  }));
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const p = {
    ...parsed.project,
    layout: nestProject(parsed.project, { toolDiameter: TOOL_D }).layout,
  };
  return opts.place ? opts.place(p) : p;
}

const TRI = [v(60, 60), v(100, 300), v(260, 80)];
const L = [v(300, 60), v(300, 340), v(440, 340), v(440, 280), v(360, 280), v(360, 60)];
const mirrorX = (vs: Vertex[], w: number) => [...vs].reverse().map((q) => v(w - q.x, q.y));

describe('B12 r2 tester (B1): asymmetric cut-outs at 30° and mirrored pass the layout check', () => {
  const cases: [string, Vertex[][], number][] = [
    ['triangle + L at 30°', [TRI, L], 30],
    ['mirrored triangle + L at 0°', [mirrorX(TRI, 500), mirrorX(L, 500)], 0],
    ['mirrored triangle + L at 30°', [mirrorX(TRI, 500), mirrorX(L, 500)], 30],
    ['triangle + L at 212.5°', [TRI, L], 212.5],
  ];
  it.each(cases)('%s', (_, inners, rot) => {
    const p = projectWith(
      [{ id: 'asym', name: 'Asimetrik', qty: 1, params: { w: 500, h: 400, r: 0 }, inners }],
      {
        place: (q) => ({
          ...q,
          layout: {
            ...q.layout,
            sheets: [
              {
                ...q.layout.sheets[0],
                placements: [{ partId: 'asym', index: 0, x: 900, y: 800, rot }],
              },
            ],
          } as Project['layout'],
        }),
      },
    );
    for (const post of ['generic', 'mach3'] as const) {
      const r = exportNc(p, pv(post), postConfig(post));
      expect(r.check?.violations.map((x) => `${x.code}: ${x.message}`) ?? []).toEqual([]);
      expect(r.ok).toBe(true);
      const s = r.check?.files[0]?.result.summary;
      expect(s?.partsExpected).toBe(3); // the part + 2 cut-outs
      expect(s?.partsCut).toBe(3);
    }
  });
});

interface Flight {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z: number;
  /** XY length flown at the tab top (arcs by arc length). */
  len: number;
  /** pass depth the tool rose from */
  from: number;
}

/** Raised spans read from the program: vertical rise from z < top, flight, vertical descent. */
function flights(content: string, inBox: (x: number, y: number) => boolean): Flight[] {
  const read = readGcode(content);
  expect(read.errors).toEqual([]);
  const out: Flight[] = [];
  let cur: Flight | null = null;
  for (const m of read.moves) {
    const vertical = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) < 1e-6;
    if (m.type !== 'rapid' && vertical && m.to.z > m.from.z && m.from.z < 0 && m.to.z < 0) {
      if (inBox(m.from.x, m.from.y))
        cur = { x0: m.to.x, y0: m.to.y, x1: m.to.x, y1: m.to.y, z: m.to.z, len: 0, from: m.from.z };
      continue;
    }
    if (!cur) continue;
    if (vertical && m.to.z < m.from.z) {
      out.push(cur);
      cur = null;
      continue;
    }
    expect(m.type, 'only feed moves on a tab').not.toBe('rapid');
    expect(m.from.z).toBeCloseTo(cur.z, 6);
    expect(m.to.z).toBeCloseTo(cur.z, 6);
    cur.len += m.arc
      ? Math.abs(m.arc.sweep) * m.arc.radius
      : Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
    cur.x1 = m.to.x;
    cur.y1 = m.to.y;
  }
  expect(cur).toBeNull();
  return out;
}

/** Plate 600 × 600 (large) with the given openings, alone on the sheet. */
const plate = (inners: Vertex[][], tabsOn = false) =>
  projectWith([{ id: 'plate', name: 'Plaka', qty: 1, params: { w: 600, h: 600, r: 0 }, inners }], {
    tabsOn,
  });

function slugFlights(p: Project, post: 'generic' | 'mach3', k: number) {
  const r = exportNc(p, pv(post), postConfig(post));
  expect(r.check?.violations.map((x) => `${x.code}: ${x.message}`) ?? []).toEqual([]);
  expect(r.ok).toBe(true);
  const pl = p.layout.sheets[0]?.placements[0];
  if (!pl) throw new Error('placement');
  const slug = placedInners(p.parts[0] as never, pl)[k];
  if (!slug) throw new Error('slug');
  const b = bbox(slug);
  const f = flights(
    r.files[0]?.content ?? '',
    (x, y) => x > b.minX && x < b.maxX && y > b.minY && y < b.maxY,
  );
  return { f, b, r };
}

describe('B12 r2 tester (D-049): small slugs held by tabs, read from the G-code', () => {
  const tabTop = -(THICK - 3); // default height min(3, t/2) = 3 mm left in the bridge
  const span = 10 + TOOL_D; // default width + tool diameter

  it.each([
    ['round Ø80', [circle(300, 300, 40)]],
    ['round Ø40', [circle(300, 300, 20)]],
    ['rectangle 60 × 40', [rect(200, 200, 260, 240)]],
    ['rectangle 400 × 80 (short side < 100)', [rect(100, 200, 500, 280)]],
  ] as const)(
    '%s with tabs off: ≥ 2 tabs on every pass below the top, spread around',
    (_, inners) => {
      for (const post of ['generic', 'mach3'] as const) {
        const p = plate(inners.map((x) => [...x]));
        const tp = buildToolpath(p, goldenProfile(post));
        expect(tp.warnings.map((w) => w.code)).toContain('SMALL_SLUG_AUTO_TABS');
        const { f, b } = slugFlights(p, post, 0);
        const passes = [...new Set(f.map((x) => x.from.toFixed(4)))];
        expect(passes.length).toBeGreaterThan(0);
        const perPass = passes.map((d) => f.filter((x) => x.from.toFixed(4) === d));
        const n = perPass[0]?.length ?? 0;
        expect(n, `${post}: tabs per pass`).toBeGreaterThanOrEqual(2);
        for (const pp of perPass) {
          expect(pp).toHaveLength(n);
          // same XY on every pass
          pp.forEach((t, i) => {
            expect(t.x0).toBeCloseTo(perPass[0]?.[i]?.x0 ?? NaN, 3);
            expect(t.y0).toBeCloseTo(perPass[0]?.[i]?.y0 ?? NaN, 3);
          });
        }
        for (const t of f) {
          expect(t.z).toBeCloseTo(tabTop, 3);
          expect(t.from).toBeLessThan(tabTop);
          expect(t.len).toBeCloseTo(span, 2);
        }
        // spread: tab midpoints seen from the opening centre leave no gap above 180° + slack
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const ang = (perPass[0] ?? [])
          .map((t) => Math.atan2((t.y0 + t.y1) / 2 - cy, (t.x0 + t.x1) / 2 - cx))
          .sort((a, c) => a - c);
        const gaps = ang.map((a, i) =>
          i + 1 < ang.length ? (ang[i + 1] as number) - a : (ang[0] as number) + 2 * Math.PI - a,
        );
        expect(Math.max(...gaps), `${post}: tabs not all on one side`).toBeLessThanOrEqual(
          Math.PI + 0.35,
        );
      }
    },
  );

  it('round Ø20 (too small for 2 tabs, 8 mm tool): SMALL_SLUG_UNSECURED, no file', () => {
    const p = plate([circle(300, 300, 10)]);
    const r = exportNc(p, pv('generic'), postConfig('generic'));
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('toolpath');
    expect(r.files).toEqual([]);
    const tp = buildToolpath(p, goldenProfile('generic'));
    expect(tp.errors.map((e) => e.code)).toEqual(['SMALL_SLUG_UNSECURED']);
  });

  it('large slug 300 × 300: no tab with tabs off, tabs with tabs on', () => {
    const big = [rect(100, 100, 400, 400)];
    expect(slugFlights(plate(big, false), 'generic', 0).f).toEqual([]);
    const on = slugFlights(plate(big, true), 'generic', 0).f;
    expect(on.length).toBeGreaterThan(0);
    for (const t of on) expect(t.z).toBeCloseTo(tabTop, 3);
  });
});
