/** T284 tester: end-to-end corner-arc tab rules. */
import { describe, expect, it } from 'vitest';
import { EPS } from '../geometry/constants';
import type { Vertex } from '../geometry/types';
import { nestProject } from '../nesting';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';

const TOOL_D = 8;
const pv = (post: 'generic' | 'mach3') => ({
  profile: goldenProfile(post),
  version: 1,
  verification: 'draft' as const,
});

/** Shelf set (tabs off) + freeform parts with the given outlines, nested. */
function withParts(outlines: Vertex[][]): Project {
  const src = structuredClone(goldenProject(shelfSet, TOOL_D)) as unknown as {
    parts: Record<string, unknown>[];
    cutting: { tabs: Record<string, unknown> };
  };
  src.cutting.tabs = { ...src.cutting.tabs, auto: false };
  const base = src.parts[0] as Record<string, unknown>;
  outlines.forEach((outline, i) => {
    const part: Record<string, unknown> = {
      ...base,
      id: `f${i}`,
      name: `Serbest ${i + 1}`,
      qty: 1,
      holes: [],
      templates: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      kind: 'freeform',
      outline,
      inners: [],
    };
    delete part['params'];
    src.parts.push(part);
  });
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return {
    ...parsed.project,
    layout: nestProject(parsed.project, { toolDiameter: TOOL_D }).layout,
  };
}

/** Stadium: two straight sides of length `l` and two half circles of diameter `d` (CCW). */
const stadium = (l: number, d: number): Vertex[] => [
  { x: d / 2, y: 0, bulge: 0 },
  { x: d / 2 + l, y: 0, bulge: 1 },
  { x: d / 2 + l, y: d, bulge: 0 },
  { x: d / 2, y: d, bulge: 1 },
];

/** Rounded rectangle w × h, corner radius r (CCW, bulge on the corner vertices). */
const rrect = (w: number, h: number, r: number): Vertex[] => {
  const Q = Math.tan(Math.PI / 8);
  return [
    { x: r, y: 0, bulge: 0 },
    { x: w - r, y: 0, bulge: Q },
    { x: w, y: r, bulge: 0 },
    { x: w, y: h - r, bulge: Q },
    { x: w - r, y: h, bulge: 0 },
    { x: r, y: h, bulge: Q },
    { x: 0, y: h - r, bulge: 0 },
    { x: 0, y: r, bulge: Q },
  ];
};
const build = (p: Project) => buildToolpath(p, pv('generic').profile);
const outer = (tp: ReturnType<typeof build>) =>
  tp.toolpath.operations.find((o) => o.partId === 'f0' && o.kind === 'outerContour');

describe('T284 tester: corner arcs never hold tabs (D-058), end to end', () => {
  it('rounded rectangles: tabs only on straight sides, else SMALL_PART_UNSECURED', () => {
    for (const [w, h, r] of [
      [25, 25, 8],
      [30, 30, 12],
      [24, 18, 8.1],
      [40, 40, 6],
      [80, 50, 10],
      [120, 80, 20],
    ] as const) {
      const tp = build(withParts([rrect(w, h, r)]));
      const codes = tp.errors.map((e) => e.code);
      const op = outer(tp);
      if (op && op.tabs.length > 0) {
        expect(codes).toEqual([]);
        for (const t of op.tabs) {
          const flat = Math.abs(t.y1 - t.y0) < EPS || Math.abs(t.x1 - t.x0) < EPS;
          expect(flat, `${w}x${h} r${r} tab on a corner arc`).toBe(true);
        }
      } else expect(codes, `${w}x${h} r${r}`).toContain('SMALL_PART_UNSECURED');
    }
  });

  it('a small rounded square with no fitting straight side is refused, not left untabbed', () => {
    expect(build(withParts([rrect(25, 25, 8)])).errors.map((e) => e.code)).toEqual([
      'SMALL_PART_UNSECURED',
    ]);
  });

  it('a stadium with sides too short for a tab still gets tabs on its end arcs', () => {
    const tp = build(withParts([stadium(8, 40)]));
    expect(tp.errors).toEqual([]);
    expect(outer(tp)?.tabs.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
