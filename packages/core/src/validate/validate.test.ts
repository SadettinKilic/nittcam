/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit raw JSON to build projects */
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { defaultMachineProfile } from '../machine';
import { CommandStack } from '../commands';
import {
  exportBlockingIssues,
  holeDepthBelowThickness,
  holeVsTool,
  partLargerThanSheet,
  partNotInLayout,
  validateProject,
} from './index';

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
  // The mixed fixture keeps a partial layout on purpose (2 of 3 trays unplaced, see (a2)).
  const placedAll = (i: { code: string }) => i.code !== 'PART_NOT_IN_LAYOUT';

  it('the example projects are clean', () => {
    for (const fixture of [cabinetDoors, shelfSet, mixed]) {
      expect(validateProject(project(() => {}, fixture)).filter(placedAll)).toEqual([]);
    }
  });
});

describe('(a) part larger than the sheet', () => {
  const onSheet = (part: object) =>
    project((j) => {
      j.layout.sheets = [];
      j.stock.sheet = { width: 2800, height: 2100, grain: 0 };
      // Raw-sheet rules first; the margin (T012) is tested below.
      j.nesting.margin = 0;
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

  it('pocket just below the thickness: no error, only the thin-skin warning (T140)', () => {
    const p = project((j) => {
      j.parts[0].holes[0].depth = j.stock.thickness - 0.01;
    });
    expect(holeDepthBelowThickness(p).map((i) => [i.code, i.severity])).toEqual([
      ['HOLE_DEPTH_NEAR_THICKNESS', 'warning'],
    ]);
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

describe('(a) freeform parts use the arc-aware bbox (T006)', () => {
  // mixed.json "arch-panel": 600 × 500 rectangle with a semicircle (r = 300) on top → 600 × 800
  const archOn = (width: number, height: number, grainLock = false) =>
    project((j) => {
      j.layout.sheets = [];
      j.stock.sheet = { width, height, grain: 0 };
      j.nesting.margin = 0;
      j.parts = j.parts.filter((p: any) => p.id === 'arch-panel');
      j.parts[0].grainLock = grainLock;
    }, mixed);

  it('the arc counts: a sheet only as tall as the vertices is too small', () => {
    const issues = partLargerThanSheet(archOn(700, 790));
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'PART_LARGER_THAN_SHEET',
        severity: 'error',
        path: 'parts[0].outline',
      }),
    ]);
    expect(issues[0]?.message).toContain('600 × 800 mm');
  });

  it('an exact fit passes (EPS slack for arc rounding), turned too when free', () => {
    expect(partLargerThanSheet(archOn(600, 800, true))).toEqual([]);
    expect(partLargerThanSheet(archOn(800, 600, false))).toEqual([]);
    expect(partLargerThanSheet(archOn(800, 600, true))).toHaveLength(1);
  });
});

describe('(c) hole / groove vs tool diameter (spec §4.5, T010)', () => {
  // Example profile: T1 = 6 mm, T2 = 8 mm flat end mills. Its table (2440 × 1220) is smaller than the
  // fixture sheets and it has no plywood/melamine sets; those rules (D-029) are tested separately,
  // so the table is enlarged here and the stock rule is filtered out.
  const machine = { ...defaultMachineProfile(), table: { width: 3100, depth: 2200 } };
  const notStock = (i: { code: string }) =>
    i.code !== 'NO_CUTTING_PARAMS' && i.code !== 'PART_NOT_IN_LAYOUT';
  const withHoles = (holes: object[]) =>
    project((j) => {
      j.parts[0].holes = holes;
    });

  it('the example projects are clean with the example profile', () => {
    for (const fixture of [cabinetDoors, shelfSet, mixed]) {
      expect(
        validateProject(
          project(() => {}, fixture),
          { machine },
        ).filter(notStock),
      ).toEqual([]);
    }
  });

  it('without a profile the rule is skipped', () => {
    const p = withHoles([{ id: 'a', type: 'through', d: 3, cx: 50, cy: 50, tool: 2 }]);
    expect(holeVsTool(p)).toEqual([]);
    expect(validateProject(p)).toEqual([]);
  });

  it('pocket / through smaller than the tool: error; equal (within EPS) or larger: fine', () => {
    const p = withHoles([
      { id: 'small', type: 'through', d: 5.99, cx: 50, cy: 50, tool: 1 },
      { id: 'equal', type: 'through', d: 5.9995, cx: 60, cy: 50, tool: 1 },
      { id: 'pocket', type: 'pocket', d: 7, cx: 70, cy: 50, depth: 5, tool: 2 },
      { id: 'big', type: 'pocket', d: 35, cx: 120, cy: 50, depth: 5, tool: 2 },
    ]);
    const issues = holeVsTool(p, { machine });
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'HOLE_SMALLER_THAN_TOOL',
        severity: 'error',
        path: 'parts[0].holes[0].d',
      }),
      expect.objectContaining({
        code: 'HOLE_SMALLER_THAN_TOOL',
        severity: 'error',
        path: 'parts[0].holes[2].d',
      }),
    ]);
    expect(issues[0]?.message).toContain('5.99 mm, smaller than the 6 mm tool T1');
  });

  it('groove narrower than the tool: error like the toolpath (T275); equal or wider: fine', () => {
    const p = withHoles([
      { id: 'narrow', type: 'groove', d: 60, cx: 100, cy: 100, depth: 5, grooveWidth: 5, tool: 1 },
      { id: 'single', type: 'groove', d: 60, cx: 200, cy: 100, depth: 5, grooveWidth: 6, tool: 1 },
      { id: 'multi', type: 'groove', d: 60, cx: 300, cy: 100, depth: 5, grooveWidth: 12, tool: 2 },
    ]);
    expect(holeVsTool(p, { machine })).toEqual([
      expect.objectContaining({
        code: 'GROOVE_NARROWER_THAN_TOOL',
        severity: 'error',
        path: 'parts[0].holes[0].grooveWidth',
      }),
    ]);
  });

  it('a tool number missing from the profile: error, no diameter check', () => {
    const p = withHoles([{ id: 'x', type: 'through', d: 2, cx: 50, cy: 50, tool: 7 }]);
    expect(holeVsTool(p, { machine })).toEqual([
      expect.objectContaining({
        code: 'TOOL_NOT_IN_PROFILE',
        severity: 'error',
        path: 'parts[0].holes[0].tool',
      }),
    ]);
  });

  it('the command stack runs the rule with the machine it was given', () => {
    const p = withHoles([{ id: 'a', type: 'through', d: 5, cx: 50, cy: 50, tool: 1 }]);
    expect(new CommandStack(p).issues).toEqual([]);
    expect(new CommandStack(p, { machine }).issues.filter(notStock).map((i) => i.code)).toEqual([
      'HOLE_SMALLER_THAN_TOOL',
    ]);
  });
});

describe('(a) part larger than the sheet subtracts nesting.margin (T012)', () => {
  const withMargin = (margin: number, part: object) =>
    project((j) => {
      j.layout.sheets = [];
      j.stock.sheet = { width: 2800, height: 2100, grain: 0 };
      j.nesting.margin = margin;
      j.parts = [part];
    });

  it('a part that fits the raw sheet but not the sheet minus the margin: error', () => {
    const issues = partLargerThanSheet(withMargin(10, rectPart('p', 2790, 1000, true)));
    expect(issues.map((i) => i.code)).toEqual(['PART_LARGER_THAN_SHEET']);
    expect(issues[0]?.message).toContain('2780 × 2080 mm usable area');
    expect(issues[0]?.message).toContain('margin 10 mm');
  });

  it('an exact fit in the usable area passes, as is and turned', () => {
    expect(partLargerThanSheet(withMargin(10, rectPart('p', 2780, 2080, true)))).toEqual([]);
    expect(partLargerThanSheet(withMargin(10, rectPart('p', 2080, 2780, false)))).toEqual([]);
    expect(partLargerThanSheet(withMargin(10, rectPart('p', 2080, 2780, true)))).toHaveLength(1);
  });

  it('freeform parts use their bbox against the usable area', () => {
    const p = project((j) => {
      j.layout.sheets = [];
      j.stock.sheet = { width: 620, height: 820, grain: 0 };
      j.nesting.margin = 10;
      j.parts = j.parts.filter((x: any) => x.id === 'arch-panel');
      j.parts[0].grainLock = true;
    }, mixed);
    expect(partLargerThanSheet(p)).toEqual([]);
    const tight = project((j) => {
      j.layout.sheets = [];
      j.stock.sheet = { width: 620, height: 820, grain: 0 };
      j.nesting.margin = 11;
      j.parts = j.parts.filter((x: any) => x.id === 'arch-panel');
      j.parts[0].grainLock = true;
    }, mixed);
    expect(partLargerThanSheet(tight).map((i) => i.path)).toEqual(['parts[0].outline']);
  });
});

describe('(a2) part not in the layout (T287)', () => {
  it('a fully nested project has no issue', () => {
    expect(partNotInLayout(project())).toEqual([]);
  });

  it('a part added after nesting is one error on its row, counting the missing copies', () => {
    const p = project((j) => {
      j.parts.push({ ...rectPart('late', 300, 200, false), qty: 2 });
    });
    const issues = partNotInLayout(p);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'PART_NOT_IN_LAYOUT',
      severity: 'error',
      path: `parts[${p.parts.length - 1}]`,
    });
    expect(issues[0]?.message).toContain('2 of 2 copies');
    // Same list as the export gate.
    expect(exportBlockingIssues(p).map((i) => i.code)).toContain('PART_NOT_IN_LAYOUT');
  });

  it('a raised quantity reports only the missing copies', () => {
    const p = project((j) => {
      j.parts[0].qty += 1;
    });
    expect(partNotInLayout(p).map((i) => i.message)).toEqual([
      expect.stringContaining('1 of 3 copies'),
    ]);
  });

  it('an oversize part is reported once, as PART_LARGER_THAN_SHEET', () => {
    const p = project((j) => {
      j.parts.push(rectPart('huge', 9000, 600, false));
    });
    const codes = validateProject(p).map((i) => i.code);
    expect(codes).toContain('PART_LARGER_THAN_SHEET');
    expect(codes).not.toContain('PART_NOT_IN_LAYOUT');
  });

  it('without a layout nothing is reported (the user has not nested yet)', () => {
    const p = project((j) => {
      j.layout.sheets = [];
    });
    expect(partNotInLayout(p)).toEqual([]);
  });

  it('deleting the unplaced part makes the export gate clean again', () => {
    const added = project((j) => {
      j.parts.push(rectPart('late', 300, 200, false));
    });
    const removed = { ...added, parts: added.parts.slice(0, -1) };
    expect(exportBlockingIssues(removed)).toEqual([]);
  });
});
