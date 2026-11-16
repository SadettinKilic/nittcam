/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/** T013 tester: LOCKED_PLACEMENT_INVALID against independent geometry, lockPlacement undo, re-nest. */
import { describe, expect, it } from 'vitest';
import { CommandStack, type CommandContext } from '../commands';
import { commandToolDefinitions } from '../commands/registry';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import { parseProject, type Placement, type Project } from '../schema';
import { validateProject } from '../validate';

const user: CommandContext = { actor: 'user', at: '2026-11-17T10:00:00Z' };
const TOOL = 6;
const GAP = 4;
const MARGIN = 10;
const SW = 1000;
const SH = 800;
const SPACING = TOOL + GAP; // 10

function load(json: unknown): Project {
  const r = parseProject(JSON.parse(JSON.stringify(json)));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

const part = (id: string, w: number, h: number, qty = 1) => ({
  id,
  name: id,
  qty,
  grainLock: false,
  kind: 'rect',
  params: { w, h, r: 0 },
  inners: [],
  holes: [],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  templates: [],
});

function base(placements: Placement[]): Project {
  return load({
    schemaVersion: 1,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: SW, height: SH, grain: 0 },
      useOffcuts: false,
    },
    parts: [part('a', 100, 50, 2), part('b', 60, 60), part('c', 200, 40)],
    nesting: { mode: 'minWaste', gap: GAP, margin: MARGIN },
    layout: { sheets: [{ placements }] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  });
}

const SIZES: Record<string, [number, number]> = { a: [100, 50], b: [60, 60], c: [200, 40] };
const pl = (
  partId: string,
  index: number,
  x: number,
  y: number,
  locked = true,
  rot: Placement['rot'] = 0,
): Placement => ({ partId, index, x, y, rot, locked });

/** Own footprint: rotation by 90/270 swaps the box; x,y is its bottom-left corner. */
function box(p: Placement) {
  const [w, h] = SIZES[p.partId]!;
  const swap = p.rot === 90 || p.rot === 270;
  return { x0: p.x, y0: p.y, x1: p.x + (swap ? h : w), y1: p.y + (swap ? w : h) };
}

/** Independent oracle: separate axis-gap reasoning, no import of the production check. */
function oracle(all: Placement[], target: Placement): boolean {
  const b = box(target);
  if (b.x0 < 0 || b.y0 < 0 || b.x1 > SW || b.y1 > SH) return false;
  if (b.x0 < MARGIN || b.y0 < MARGIN || b.x1 > SW - MARGIN || b.y1 > SH - MARGIN) return false;
  for (const o of all) {
    if (o === target) continue;
    const c = box(o);
    const gx = Math.max(c.x0 - b.x1, b.x0 - c.x1);
    const gy = Math.max(c.y0 - b.y1, b.y0 - c.y1);
    if (Math.max(gx, gy) < SPACING) return false;
  }
  return true;
}

function invalidPaths(placements: Placement[]): string[] {
  return validateProject(base(placements), { toolDiameter: TOOL })
    .filter((i) => i.code === 'LOCKED_PLACEMENT_INVALID')
    .map((i) => i.path);
}

describe('T013 tester: LOCKED_PLACEMENT_INVALID, independent geometry', () => {
  const cases: [string, Placement[], boolean][] = [
    ['clean', [pl('a', 0, 100, 100)], true],
    ['margin exact edge ok', [pl('a', 0, MARGIN, MARGIN)], true],
    ['0.01 into the margin (left)', [pl('a', 0, MARGIN - 0.01, 100)], false],
    ['0.01 into the margin (bottom)', [pl('a', 0, 100, MARGIN - 0.01)], false],
    ['right edge exact ok', [pl('a', 0, SW - MARGIN - 100, 100)], true],
    ['right edge 0.01 over', [pl('a', 0, SW - MARGIN - 100 + 0.01, 100)], false],
    ['top edge exact ok', [pl('a', 0, 100, SH - MARGIN - 50)], true],
    ['top edge 0.01 over', [pl('a', 0, 100, SH - MARGIN - 50 + 0.01)], false],
    ['outside the sheet', [pl('a', 0, SW - 50, 100)], false],
    ['negative coordinate', [pl('a', 0, -5, 100)], false],
    ['overlap', [pl('a', 0, 100, 100), pl('b', 0, 120, 110, false)], false],
    [
      'x spacing exactly at limit',
      [pl('a', 0, 100, 100), pl('b', 0, 100 + 100 + SPACING, 100)],
      true,
    ],
    [
      'x spacing 0.01 under limit',
      [pl('a', 0, 100, 100), pl('b', 0, 100 + 100 + SPACING - 0.01, 100)],
      false,
    ],
    [
      'y spacing exactly at limit',
      [pl('a', 0, 100, 100), pl('b', 0, 100, 100 + 50 + SPACING)],
      true,
    ],
    [
      'y spacing 0.01 under limit',
      [pl('a', 0, 100, 100), pl('b', 0, 100, 100 + 50 + SPACING - 0.01)],
      false,
    ],
    [
      'diagonal: x gap at limit, y gap small -> Chebyshev clearance ok',
      [pl('a', 0, 100, 100), pl('b', 0, 100 + 100 + SPACING, 100 + 50 + 1)],
      true,
    ],
    [
      'rot 90 footprint is 50 wide x 100 tall (fits at top edge)',
      [pl('a', 0, 100, SH - MARGIN - 100, true, 90)],
      true,
    ],
    [
      'rot 90 footprint 0.01 over top edge',
      [pl('a', 0, 100, SH - MARGIN - 100 + 0.01, true, 90)],
      false,
    ],
    [
      'rot 90 spacing in x uses 50 wide box (exactly at limit)',
      [pl('a', 0, 100, 100, true, 90), pl('b', 0, 100 + 50 + SPACING, 100)],
      true,
    ],
    [
      'rot 90 spacing in x 0.01 under',
      [pl('a', 0, 100, 100, true, 90), pl('b', 0, 100 + 50 + SPACING - 0.01, 100)],
      false,
    ],
    [
      'rot 270 vertical spacing uses 100 tall box',
      [pl('a', 0, 100, 100, true, 270), pl('b', 0, 100, 100 + 100 + SPACING)],
      true,
    ],
    [
      'rot 270 vertical 0.01 under',
      [pl('a', 0, 100, 100, true, 270), pl('b', 0, 100, 100 + 100 + SPACING - 0.01)],
      false,
    ],
    [
      'rot 180 same box as rot 0',
      [pl('a', 0, 100, 100, true, 180), pl('b', 0, 100 + 100 + SPACING - 0.01, 100)],
      false,
    ],
  ];

  for (const [name, placements, expectValid] of cases) {
    it(`${name} -> ${expectValid ? 'valid' : 'LOCKED_PLACEMENT_INVALID'}`, () => {
      // The oracle and the rule must agree, and both match the intended verdict.
      expect(oracle(placements, placements[0]!)).toBe(expectValid);
      const paths = invalidPaths(placements);
      expect(paths.includes('layout.sheets[0].placements[0]')).toBe(!expectValid);
    });
  }

  it('unlocked bad placements are not reported, but still block a locked neighbour', () => {
    const paths = invalidPaths([pl('a', 0, 100, 100, false), pl('b', 0, 105, 100, true)]);
    expect(paths).toEqual(['layout.sheets[0].placements[1]']);
    expect(invalidPaths([pl('a', 0, 5, 5, false)])).toEqual([]);
  });

  it('issue severity is error and the path names the placement', () => {
    const issues = validateProject(base([pl('a', 0, 5, 100)]), { toolDiameter: TOOL });
    const i = issues.find((x) => x.code === 'LOCKED_PLACEMENT_INVALID')!;
    expect(i.severity).toBe('error');
    expect(i.path).toBe('layout.sheets[0].placements[0]');
  });

  it('randomised integer layouts agree with the oracle (500 cases, own LCG)', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >> 8) % n;
    };
    const rots: Placement['rot'][] = [0, 90, 180, 270];
    for (let k = 0; k < 500; k += 1) {
      const placements: Placement[] = [
        pl('a', 0, rnd(300), rnd(300), true, rots[rnd(4)]),
        pl('b', 0, rnd(300), rnd(300), true, rots[rnd(4)]),
        pl('c', 0, rnd(300), rnd(300), true, rots[rnd(4)]),
      ];
      const bad = new Set(invalidPaths(placements));
      placements.forEach((p, idx) => {
        expect(bad.has(`layout.sheets[0].placements[${idx}]`)).toBe(!oracle(placements, p));
      });
    }
  });
});

describe('T013 tester: lockPlacement', () => {
  it('move + lock undo restores byte for byte; redo reapplies; no-op records nothing', () => {
    const stack = new CommandStack(
      base([pl('a', 0, 100, 100, false), pl('b', 0, 400, 400, false)]),
    );
    const before = JSON.stringify(stack.project);
    const r = stack.execute(
      'lockPlacement',
      { partId: 'a', index: 0, x: 333, y: 222, rot: 90 },
      user,
    );
    expect(r.ok).toBe(true);
    const after = JSON.stringify(stack.project);
    expect(after).not.toBe(before);
    expect(stack.project.layout.sheets[0]!.placements[0]).toMatchObject({
      x: 333,
      y: 222,
      rot: 90,
      locked: true,
    });
    expect(stack.undo()).toBe(true);
    expect(JSON.stringify(stack.project)).toBe(before);
    expect(stack.redo()).toBe(true);
    expect(JSON.stringify(stack.project)).toBe(after);
    const n = stack.log.length;
    stack.execute('lockPlacement', { partId: 'a', index: 0, x: 333, y: 222, rot: 90 }, user);
    expect(stack.log.length).toBe(n);
  });

  it('rejects a copy that is not placed, x without y, and bad rot', () => {
    const stack = new CommandStack(base([pl('a', 0, 100, 100, false)]));
    expect(stack.execute('lockPlacement', { partId: 'a', index: 1 }, user).ok).toBe(false);
    expect(stack.execute('lockPlacement', { partId: 'nope', index: 0 }, user).ok).toBe(false);
    expect(stack.execute('lockPlacement', { partId: 'a', index: 0, x: 5 }, user).ok).toBe(false);
    expect(stack.execute('lockPlacement', { partId: 'a', index: 0, rot: 45 }, user).ok).toBe(false);
    expect(stack.canUndo).toBe(false);
  });

  it('is not an AI tool (placements are geometry, spec 5.4)', () => {
    const names = commandToolDefinitions().map((d) => d.name);
    expect(names).not.toContain('lockPlacement');
    expect(names).toContain('runNesting');
  });

  it('locked re-nest keeps the part; unlock then re-nest moves it back', () => {
    const stack = new CommandStack(load(cabinetDoors));
    stack.execute('runNesting', { toolDiameter: 8 }, user);
    const find = () =>
      stack.project.layout.sheets
        .flatMap((s) => s.placements)
        .find((p) => p.partId === 'door-left' && p.index === 0)!;
    const first = { ...find() };
    const lock = stack.execute(
      'lockPlacement',
      { partId: 'door-left', index: 0, x: 1900, y: 1300 },
      user,
    );
    expect(lock.ok).toBe(true);
    stack.execute('runNesting', { toolDiameter: 8 }, user);
    expect(find()).toMatchObject({ x: 1900, y: 1300, locked: true });
    stack.execute('lockPlacement', { partId: 'door-left', index: 0, locked: false }, user);
    stack.execute('runNesting', { toolDiameter: 8 }, user);
    const moved = find();
    expect(moved.locked).toBe(false);
    expect([moved.x, moved.y]).not.toEqual([1900, 1300]);
    expect([moved.x, moved.y]).toEqual([first.x, first.y]);
  });
});

describe('T013 tester: cabinet-doors fixture edit', () => {
  it('spacing is >= 8 mm tool + 8 mm gap; the old 8 mm coordinates would be flagged', () => {
    const p = load(cabinetDoors);
    const xs = p.layout.sheets[0]!.placements.map((q) => q.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]! - (xs[i - 1]! + 396)).toBeGreaterThanOrEqual(16);
    }
    expect(p.nesting.gap).toBe(8);
    const rule = (proj: Project) =>
      validateProject(proj, { toolDiameter: 8 }).filter(
        (i) => i.code === 'LOCKED_PLACEMENT_INVALID',
      );
    expect(rule(p)).toEqual([]);
    const old = JSON.parse(JSON.stringify(cabinetDoors));
    old.layout.sheets[0].placements.forEach((q: Placement, i: number) => {
      q.x = [10, 414, 818, 1222][i]!;
    });
    expect(rule(load(old)).length).toBeGreaterThan(0);
  });
});
