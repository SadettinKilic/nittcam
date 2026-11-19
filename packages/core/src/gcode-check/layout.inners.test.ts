/**
 * Layout check with cut-outs (T134, B12 round 1 B1): each cut-out of a placed copy is an expected
 * closed through cut at the centre of its tool-centre loop; a missing or an unexpected loop is
 * still caught (§7.2 rule 9, "nothing else cut through").
 */
import { describe, expect, it } from 'vitest';
import { exportNc, postAndCheck } from '../export';
import type { Vertex } from '../geometry/types';
import { nestProject } from '../nesting';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from '../toolpath';
import { postConfig } from './check.testing';
import { expectedLayouts } from './layout';
import type { ExpectedPart } from './types';

const TOOL_D = 8;
const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const pv = { profile: goldenProfile('generic'), version: 1, verification: 'draft' as const };

/** Shelf set + a part with an asymmetric (triangle) and an L-shaped cut-out. */
function project(): Project {
  const src = structuredClone(goldenProject(shelfSet, TOOL_D)) as unknown as {
    parts: Record<string, unknown>[];
  };
  src.parts.push({
    ...(src.parts[0] as Record<string, unknown>),
    id: 'tri',
    name: 'Üçgen',
    qty: 2,
    holes: [],
    templates: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    params: { w: 500, h: 400, r: 0 },
    inners: [
      [v(60, 60), v(100, 300), v(260, 80)],
      [v(300, 60), v(300, 340), v(440, 340), v(440, 280), v(360, 280), v(360, 60)],
    ],
  });
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return {
    ...parsed.project,
    layout: nestProject(parsed.project, { toolDiameter: TOOL_D }).layout,
  };
}

function check(p: Project, layout: Map<number, ExpectedPart[]>) {
  const tp = buildToolpath(p, pv.profile);
  expect(tp.errors).toEqual([]);
  return postAndCheck(tp.toolpath, [], pv, postConfig('generic'), {
    projectName: 'B12',
    revision: 1,
    stock: { material: 'mdf', thickness: 18, sheetWidth: 2800, sheetHeight: 2100 },
    layout,
  });
}

describe('layout check with cut-outs (T134)', () => {
  it('asymmetric cut-outs: expected at their tool-centre loop, the export passes', () => {
    const r = exportNc(project(), pv, postConfig('generic'));
    expect(r.check?.violations.map((x) => `${x.code}: ${x.message}`) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
    const files = r.check?.files ?? [];
    for (const f of files) expect(f.result.summary.partsCut).toBe(f.result.summary.partsExpected);
  });

  it('a cut loop the layout does not expect is still refused (PART_COUNT, PART_POSITION)', () => {
    const p = project();
    const layout = expectedLayouts(p, TOOL_D);
    for (const parts of layout.values()) for (const e of parts) e.inners = [];
    const r = check(p, layout);
    const codes = r.check?.violations.map((x) => x.code) ?? [];
    expect(codes).toContain('PART_COUNT');
    expect(codes).toContain('PART_POSITION');
    expect(r.ok).toBe(false);
  });

  it('an expected cut-out that is not cut is refused (PART_MISSING names the cut-out)', () => {
    const p = project();
    const layout = expectedLayouts(p, TOOL_D);
    const first = [...layout.values()].flat().find((e) => (e.inners?.length ?? 0) > 0);
    if (!first) throw new Error('no cut-out');
    first.inners = [...(first.inners ?? []), { cx: first.cx + 1, cy: first.cy + 1 }];
    const r = check(p, layout);
    const missing = r.check?.violations.filter((x) => x.code === 'PART_MISSING') ?? [];
    expect(missing.map((x) => x.message)).toEqual([
      expect.stringContaining(`Cut-out 3 of part ${first.partId}`),
    ]);
    expect(r.ok).toBe(false);
  });
});
