/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit raw JSON to build projects */
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { holeDepthBelowThickness, partLargerThanSheet, validateProject } from './index';

function project(mutate: (json: any) => void = () => {}, base: unknown = cabinetDoors): Project {
  const json = JSON.parse(JSON.stringify(base));
  mutate(json);
  const result = parseProject(json);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

const rectPart = (id: string, w: number, h: number, grainLock: boolean) => ({
  id,
  name: id,
  qty: 1,
  grainLock,
  kind: 'rect',
  params: { w, h, r: 0 },
  inners: [],
  holes: [],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  templates: [],
});

describe('validateProject', () => {
  it('the example projects are clean', () => {
    for (const fixture of [cabinetDoors, shelfSet, mixed]) {
      expect(validateProject(project(() => {}, fixture))).toEqual([]);
    }
  });
});

describe('(a) part larger than the sheet', () => {
  const onSheet = (part: object) =>
    project((j) => {
      j.layout.sheets = [];
      j.stock.sheet = { width: 2800, height: 2100, grain: 0 };
      j.parts = [part];
    });

  it('a part that fits as is: no issue (exact fit included)', () => {
    expect(partLargerThanSheet(onSheet(rectPart('p', 2800, 2100, true)))).toEqual([]);
  });

  it('a free part that only fits turned 90°: no issue', () => {
    expect(partLargerThanSheet(onSheet(rectPart('p', 2000, 2700, false)))).toEqual([]);
  });

  it('a grain-locked part that would only fit turned 90°: error', () => {
    const issues = partLargerThanSheet(onSheet(rectPart('p', 2000, 2700, true)));
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'PART_LARGER_THAN_SHEET',
        severity: 'error',
        path: 'parts[0].params',
      }),
    ]);
    expect(issues[0]?.message).toMatch(/grain-locked/);
  });

  it('a part larger in both orientations: error even when free', () => {
    const issues = partLargerThanSheet(onSheet(rectPart('p', 2900, 100, false)));
    expect(issues.map((i) => i.code)).toEqual(['PART_LARGER_THAN_SHEET']);
  });

  it('reports every offending part with its own path', () => {
    const p = project((j) => {
      j.layout.sheets = [];
      j.stock.sheet = { width: 1000, height: 500, grain: 0 };
      j.parts = [rectPart('ok', 400, 400, true), rectPart('big', 1200, 10, false)];
    });
    expect(partLargerThanSheet(p).map((i) => i.path)).toEqual(['parts[1].params']);
  });
});

describe('(b) blind depth must be below the stock thickness (spec §4.5)', () => {
  // The schema accepts depth >= thickness on purpose (tester finding on PR #5, D-010); this rule flags it.
  it('pocket depth equal to the thickness: error with the hole path', () => {
    const p = project((j) => {
      j.parts[0].holes[1].depth = j.stock.thickness;
    });
    expect(holeDepthBelowThickness(p)).toEqual([
      expect.objectContaining({
        code: 'HOLE_DEPTH_NOT_BELOW_THICKNESS',
        severity: 'error',
        path: 'parts[0].holes[1].depth',
      }),
    ]);
  });

  it('pocket deeper than the thickness: error', () => {
    const p = project((j) => {
      j.parts[1].holes[0].depth = j.stock.thickness + 5;
    });
    expect(holeDepthBelowThickness(p).map((i) => i.path)).toEqual(['parts[1].holes[0].depth']);
  });

  it('pocket just below the thickness: no error', () => {
    const p = project((j) => {
      j.parts[0].holes[0].depth = j.stock.thickness - 0.01;
    });
    expect(holeDepthBelowThickness(p)).toEqual([]);
  });

  it('groove depth is checked too; through holes have no depth', () => {
    const p = project((j) => {
      j.parts[0].holes = [
        { id: 'g', type: 'groove', d: 60, cx: 100, cy: 100, depth: 18, grooveWidth: 6, tool: 1 },
        { id: 't', type: 'through', d: 8, cx: 50, cy: 50, tool: 1 },
      ];
    });
    expect(holeDepthBelowThickness(p).map((i) => i.path)).toEqual(['parts[0].holes[0].depth']);
  });

  it('thinner stock makes existing pockets invalid', () => {
    const p = project((j) => {
      j.stock.thickness = 12;
    });
    expect(validateProject(p)).toHaveLength(4);
  });
});
