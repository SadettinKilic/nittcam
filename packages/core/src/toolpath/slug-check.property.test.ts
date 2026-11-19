/**
 * T270: `unsecuredSlugs` (and the validation rule `INNER_SLUG_UNSECURED`) flags exactly the
 * cut-outs the toolpath of the nested project refuses with `SMALL_SLUG_UNSECURED` (same rule,
 * caught on the Parçalar step). With an 8 mm tool: Ø24 is flagged, Ø35 and 80 × 80 pass.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vertex } from '../geometry/types';
import { nestProject } from '../nesting';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { unsecuredSlugs } from './slug-check';

const TOOL_D = 8;
const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const circle = (cx: number, cy: number, r: number): Vertex[] => [
  v(cx - r, cy, -1),
  v(cx + r, cy, -1),
];
const rect = (x0: number, y0: number, x1: number, y1: number): Vertex[] => [
  v(x0, y0),
  v(x0, y1),
  v(x1, y1),
  v(x1, y0),
];
const profile = goldenProfile('generic');

function withOpenings(inners: Vertex[][], tabsOn = false): Project {
  const src = structuredClone(goldenProject(shelfSet, TOOL_D)) as unknown as {
    parts: Record<string, unknown>[];
    cutting: { tabs: Record<string, unknown> };
  };
  src.cutting.tabs = { ...src.cutting.tabs, auto: tabsOn };
  src.parts.push({
    ...(src.parts[0] as Record<string, unknown>),
    id: 'plate',
    name: 'Kapak',
    qty: 1,
    holes: [],
    templates: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    params: { w: 596, h: 716, r: 0 },
    inners,
  });
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return {
    ...parsed.project,
    layout: nestProject(parsed.project, { toolDiameter: TOOL_D }).layout,
  };
}

const refusedByToolpath = (p: Project) =>
  [
    ...new Set(
      buildToolpath(p, profile)
        .errors.filter((e) => e.code === 'SMALL_SLUG_UNSECURED')
        .map((e) => e.inner),
    ),
  ].sort();

describe('unsecuredSlugs (T270)', () => {
  it('Ø24 is flagged by name and path; Ø35 and 80 × 80 pass', () => {
    const p = withOpenings([
      rect(100, 100, 400, 350),
      rect(100, 450, 180, 530),
      circle(400, 600, 12),
    ]);
    const part = p.parts.findIndex((x) => x.id === 'plate');
    expect(unsecuredSlugs(p, profile)).toEqual([{ partId: 'plate', part, inner: 2 }]);
    const issues = validateProject(p, { machine: profile }).filter(
      (i) => i.code === 'INNER_SLUG_UNSECURED',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', path: `parts[${part}].inners[2]` });
    expect(refusedByToolpath(p)).toEqual([2]);

    const ok = withOpenings([circle(300, 300, 17.5), rect(100, 100, 180, 180)]);
    expect(unsecuredSlugs(ok, profile)).toEqual([]);
    expect(refusedByToolpath(ok)).toEqual([]);
    // without a machine the rule is skipped
    expect(validateProject(p).some((i) => i.code === 'INNER_SLUG_UNSECURED')).toBe(false);
  });

  it('property: flags exactly what the nested toolpath refuses (tabs on and off)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 8, max: 60 }).map((r) => ({ kind: 'circle' as const, a: r, b: r })),
          fc
            .tuple(fc.integer({ min: 12, max: 200 }), fc.integer({ min: 12, max: 99 }))
            .map(([a, b]) => ({ kind: 'rect' as const, a, b })),
        ),
        fc.boolean(),
        (o, tabsOn) => {
          const inner =
            o.kind === 'circle' ? circle(300, 300, o.a) : rect(100, 100, 100 + o.a, 100 + o.b);
          const p = withOpenings([inner], tabsOn);
          const flagged = unsecuredSlugs(p, profile).map((s) => s.inner);
          expect(flagged).toEqual(refusedByToolpath(p));
        },
      ),
      {
        numRuns: 60,
        examples: [
          // T273 (CI seed -1772635311): the cut order started this opening on its long edge, where
          // the lead/ramp keep-out left no room for 2 tabs, while the part alone started on the
          // short edge and held. The order now only offers start edges that hold a small slug.
          [{ kind: 'rect', a: 22, b: 35 }, false],
        ],
      },
    );
  });
});
