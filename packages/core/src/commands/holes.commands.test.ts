import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import {
  checkHolePlacement,
  contourDistance,
  holeOuterRadius,
  insideContour,
} from '../editor/holes';
import { defaultMachineProfile } from '../machine';
import { deriveOutline, parseProject, type Hole, type Part, type Project } from '../schema';
import { validateProject } from '../validate';
import { applyCommand } from './index';

function load(): Project {
  const r = parseProject(JSON.parse(JSON.stringify(shelfSet)));
  if (!r.ok) throw new Error('fixture invalid');
  return r.project;
}

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message} ${JSON.stringify(r.error.issues)}`);
  return r.project;
}

function refused(project: Project, name: string, params: unknown): string {
  const r = applyCommand(project, name, params);
  if (r.ok) throw new Error(`${name} should be refused`);
  return r.error.message;
}

function part(p: Project, id = 'side'): Part {
  const found = p.parts.find((x) => x.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

/** shelf-set "side" is a 300 × 1800 rectangle. */
const cup: Hole = { id: 'h1', type: 'pocket', d: 35, cx: 22.5, cy: 100, depth: 13, tool: 2 };

describe('hole commands (T138)', () => {
  it('addHole / updateHole / removeHole change only the hole, each one undo step', () => {
    const p0 = load();
    const p1 = run(p0, 'addHole', { id: 'side', hole: cup });
    expect(part(p1).holes).toEqual([cup]);
    const p2 = run(p1, 'updateHole', { id: 'side', holeId: 'h1', patch: { d: 30, depth: 12 } });
    expect(part(p2).holes[0]).toMatchObject({ d: 30, depth: 12, cx: 22.5 });
    const p3 = run(p2, 'removeHole', { id: 'side', holeId: 'h1' });
    expect(part(p3).holes).toEqual([]);
    expect(part(p3)).toEqual(part(p0));
  });

  it('updateHole switches type: pocket → groove needs a width, → through drops depth', () => {
    const p1 = run(load(), 'addHole', { id: 'side', hole: { ...cup, cx: 100 } });
    expect(
      refused(p1, 'updateHole', { id: 'side', holeId: 'h1', patch: { type: 'groove' } }),
    ).toMatch(/invalid hole/);
    const g = run(p1, 'updateHole', {
      id: 'side',
      holeId: 'h1',
      patch: { type: 'groove', grooveWidth: 8 },
    });
    expect(part(g).holes[0]).toEqual({ ...cup, cx: 100, type: 'groove', grooveWidth: 8 });
    const t = run(g, 'updateHole', { id: 'side', holeId: 'h1', patch: { type: 'through' } });
    expect(part(t).holes[0]).toEqual({
      id: 'h1',
      type: 'through',
      d: 35,
      cx: 100,
      cy: 100,
      tool: 2,
    });
  });

  it('refuses a duplicate id, an unknown part or hole, and a hole outside the part', () => {
    const p1 = run(load(), 'addHole', { id: 'side', hole: cup });
    expect(refused(p1, 'addHole', { id: 'side', hole: { ...cup, cy: 300 } })).toMatch(/already/);
    expect(refused(p1, 'addHole', { id: 'nope', hole: cup })).toMatch(/no part/);
    expect(refused(p1, 'removeHole', { id: 'side', holeId: 'x' })).toMatch(/no hole/);
    // 300 wide: a 35 mm hole at cx 10 crosses the left edge.
    expect(refused(p1, 'addHole', { id: 'side', hole: { ...cup, id: 'h2', cx: 10 } })).toMatch(
      /inside the part/,
    );
    expect(refused(p1, 'updateHole', { id: 'side', holeId: 'h1', patch: { cx: 290 } })).toMatch(
      /inside the part/,
    );
    // A groove counts with its outer edge (d + width)/2.
    const groove: Hole = {
      id: 'g',
      type: 'groove',
      d: 40,
      cx: 24,
      cy: 500,
      depth: 3,
      grooveWidth: 8,
      tool: 1,
    };
    expect(refused(p1, 'addHole', { id: 'side', hole: groove })).toMatch(/inside the part/);
    run(p1, 'addHole', { id: 'side', hole: { ...groove, cx: 25 } });
  });

  it('refuses a hole in or touching a cut-out', () => {
    const p0 = load();
    const withInner = structuredClone(p0);
    const side = part(withInner);
    side.inners = [
      [
        { x: 100, y: 400, bulge: 0 },
        { x: 100, y: 600, bulge: 0 },
        { x: 200, y: 600, bulge: 0 },
        { x: 200, y: 400, bulge: 0 },
      ],
    ];
    const hole: Hole = { id: 'h', type: 'through', d: 10, cx: 150, cy: 500, tool: 1 };
    expect(refused(withInner, 'addHole', { id: 'side', hole })).toMatch(/cut-out/);
    expect(refused(withInner, 'addHole', { id: 'side', hole: { ...hole, cy: 396 } })).toMatch(
      /cut-out/,
    );
    run(withInner, 'addHole', { id: 'side', hole: { ...hole, cy: 390 } });
  });

  it('holes keep their place on the part through rotatePart and mirrorPart', () => {
    const p1 = run(load(), 'addHole', { id: 'side', hole: cup });
    const r = run(p1, 'rotatePart', { ids: ['side'], turns: 90 });
    const h = part(r).holes[0];
    // 300 × 1800 turned 90° CCW → 1800 × 300; a point at (22.5, 100) goes to (1800 − 100, 22.5).
    expect(h?.cx).toBeCloseTo(1700, 9);
    expect(h?.cy).toBeCloseTo(22.5, 9);
    expect(validateProject(r).filter((i) => i.code === 'HOLE_OUTSIDE_PART')).toEqual([]);
    const m = run(p1, 'mirrorPart', { ids: ['side'], axis: 'h' });
    expect(part(m).holes[0]?.cx).toBeCloseTo(300 - 22.5, 9);
  });

  it('validation: outside, depth, tool size and groove width', () => {
    const p1 = run(load(), 'addHole', { id: 'side', hole: cup });
    const bad = structuredClone(p1);
    const side = part(bad);
    side.holes = [
      { ...cup, cx: 5 },
      { ...cup, id: 'deep', cy: 300, depth: 18 },
      { id: 'small', type: 'through', d: 6, cx: 100, cy: 600, tool: 2 },
      { id: 'g', type: 'groove', d: 60, cx: 150, cy: 900, depth: 3, grooveWidth: 4, tool: 2 },
    ];
    const codes = validateProject(bad, { machine: defaultMachineProfile() }).map(
      (i) => `${i.code}@${i.path}`,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        'HOLE_OUTSIDE_PART@parts[0].holes[0]',
        'HOLE_DEPTH_NOT_BELOW_THICKNESS@parts[0].holes[1].depth',
        'HOLE_SMALLER_THAN_TOOL@parts[0].holes[2].d',
        'GROOVE_NARROWER_THAN_TOOL@parts[0].holes[3].grooveWidth',
      ]),
    );
  });
});

describe('hole geometry (T138)', () => {
  const square = deriveOutline(rectPart(200, 100, 20));

  it('distance to a rounded rectangle is exact on lines and arcs', () => {
    expect(contourDistance({ x: 100, y: 50 }, square)).toBeCloseTo(50, 9);
    // Corner arc centre (20, 20), radius 20: the corner point (0, 0) is 20√2 − 20 from the arc.
    expect(contourDistance({ x: 0, y: 0 }, square)).toBeCloseTo(20 * Math.SQRT2 - 20, 9);
    expect(insideContour({ x: 1, y: 1 }, square)).toBe(false);
    expect(insideContour({ x: 100, y: 50 }, square)).toBe(true);
  });

  it('property: a hole is accepted exactly when its circle fits inside (rectangle, EPS)', () => {
    const rect = deriveOutline(rectPart(300, 200, 0));
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 350, noNaN: true }),
        fc.double({ min: -50, max: 250, noNaN: true }),
        fc.double({ min: 1, max: 120, noNaN: true }),
        (cx, cy, d) => {
          const hole: Hole = { id: 'h', type: 'through', d, cx, cy, tool: 1 };
          const r = holeOuterRadius(hole);
          const fits = cx - r > 0.002 && cy - r > 0.002 && cx + r < 299.998 && cy + r < 199.998;
          const outside = cx - r < 0 || cy - r < 0 || cx + r > 300 || cy + r > 200;
          const got = checkHolePlacement(rect, [], hole);
          if (fits) expect(got).toBeUndefined();
          if (outside) expect(got).toBe('outside');
        },
      ),
    );
  });
});

function rectPart(w: number, h: number, r: number): Part {
  return {
    id: 's',
    name: 's',
    qty: 1,
    grain: { mode: 'free', angle: 0 },
    kind: 'rect',
    params: { w, h, r },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
  };
}
