import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EPS } from '../geometry/constants';
import { defaultMachineProfile } from '../machine';
import { holeFixtureProject } from '../post/golden.testing';
import { buildToolpath } from './build';
import { pocketRings } from './holes';
import { operationMoves, toolpathSafetyViolations } from './safety';
import type { Operation, ToolpathResult } from './types';

// T139: drilling and through holes (spec §4.5, §6.3, D-050).

const profile = () => defaultMachineProfile(); // T1 Ø6, T2 Ø8; MDF 18: T2, stepDown 6

function run(holes: unknown[], mutate?: (p: ReturnType<typeof profile>) => void): ToolpathResult {
  const p = profile();
  p.workEnvelope = { x: 3100, y: 2200, z: 150 };
  p.table = { width: 3050, depth: 2150 };
  mutate?.(p);
  return buildToolpath(holeFixtureProject(holes), p);
}

const holeOps = (r: ToolpathResult) => r.toolpath.operations.filter((o) => o.holeId);
const codes = (r: ToolpathResult) => r.errors.map((e) => e.code);

function centreOf(op: Operation): { x: number; y: number } {
  const first = operationMoves(op)[0];
  if (!first) throw new Error('empty op');
  return op.kind === 'drill' ? { x: first.x, y: first.y } : { x: Number.NaN, y: Number.NaN };
}

describe('T139 drilling (d = tool)', () => {
  it('one plunge per pass at the plunge feed, a Z-only rapid to clearance after each', () => {
    const r = run([{ id: 'h', type: 'through', d: 8, cx: 60, cy: 60, tool: 2 }]);
    expect(r.errors).toEqual([]);
    const ops = holeOps(r);
    expect(ops.map((o) => o.kind)).toEqual(['drill', 'drill']);
    const op = ops[0] as Operation;
    expect(op.passDepths.at(-1)).toBeCloseTo(r.toolpath.targetDepth, 9);
    const passes = op.segments.filter((s) => s.role === 'pass');
    expect(passes).toHaveLength(op.passDepths.length);
    for (const [i, s] of passes.entries()) {
      expect(s.moves).toEqual([
        { kind: 'plunge', x: 160, y: 160, z: op.passDepths[i], feed: op.plungeFeed },
        { kind: 'rapid', x: 160, y: 160, z: r.toolpath.clearanceZ },
      ]);
    }
    expect(centreOf(op)).toEqual({ x: 160, y: 160 });
    expect(toolpathSafetyViolations(r.toolpath)).toEqual([]);
  });
});

describe('T139 through holes (d > tool)', () => {
  it('helical entry, rings out to the wall d/2 − r, last pass at the target depth', () => {
    const r = run([{ id: 'h', type: 'through', d: 35, cx: 200, cy: 150, tool: 2 }]);
    expect(r.errors).toEqual([]);
    const op = holeOps(r)[0] as Operation;
    expect(op.kind).toBe('pocket');
    const c = { x: 300, y: 250 };
    const moves = operationMoves(op);
    const feeds = moves.filter((m) => m.kind !== 'rapid');
    const radii = feeds.map((m) => Math.hypot(m.x - c.x, m.y - c.y));
    expect(Math.max(...radii)).toBeCloseTo(35 / 2 - 4, 9);
    expect(Math.min(...feeds.map((m) => m.z))).toBeCloseTo(r.toolpath.targetDepth, 9);
    // The entry descends on arcs (helix), never straight down in the material.
    const helix = feeds.filter((m) => m.kind === 'arc' && m.z < 0);
    expect(helix.length).toBeGreaterThan(0);
    expect(toolpathSafetyViolations(r.toolpath)).toEqual([]);
  });

  it('the hole uses its own tool with the material set feeds; tool changes follow', () => {
    const r = run([{ id: 'h', type: 'through', d: 20, cx: 340, cy: 240, tool: 1 }]);
    expect(r.errors).toEqual([]);
    const op = holeOps(r)[0] as Operation;
    const outer = r.toolpath.operations.find((o) => o.kind === 'outerContour') as Operation;
    expect(op).toMatchObject({ tool: 1, toolDiameter: 6 });
    expect([op.feed, op.plungeFeed, op.rpm]).toEqual([outer.feed, outer.plungeFeed, outer.rpm]);
  });

  it('holes come before the outer contour of the same copy, and turn with the part', () => {
    const r = run([
      { id: 'a', type: 'through', d: 8, cx: 60, cy: 60, tool: 2 },
      { id: 'b', type: 'through', d: 35, cx: 200, cy: 150, tool: 2 },
    ]);
    expect(r.errors).toEqual([]);
    const ops = r.toolpath.operations;
    for (const copy of [0, 1]) {
      const own = ops.map((o, i) => ({ o, i })).filter(({ o }) => o.copy === copy);
      const outer = own.find(({ o }) => o.kind === 'outerContour');
      for (const { o, i } of own) if (o.holeId) expect(i).toBeLessThan(outer?.i ?? -1);
    }
    // Copy 1 is turned 90° at (700, 100): local (60, 60) → (−60, 60) → (700 + 300 − 60, 160).
    const turned = ops.find((o) => o.copy === 1 && o.holeId === 'a') as Operation;
    expect(centreOf(turned).x).toBeCloseTo(940, 9);
    expect(centreOf(turned).y).toBeCloseTo(160, 9);
  });

  it('pocket rings: first ring ≤ tool radius (centre cut), equal steps ≤ the stepover', () => {
    expect(pocketRings(1, 8)).toEqual([1]);
    const rings = pocketRings(13.5, 8);
    expect(rings[0]).toBeLessThanOrEqual(4);
    expect(rings.at(-1)).toBeCloseTo(13.5, 12);
    for (let i = 1; i < rings.length; i++) {
      expect((rings[i] as number) - (rings[i - 1] as number)).toBeLessThanOrEqual(3.2 + 1e-9);
    }
  });
});

describe('T139 refusals: export-blocking errors', () => {
  it('tool not in the profile, hole smaller than the tool, hole outside the part', () => {
    expect(codes(run([{ id: 'h', type: 'through', d: 10, cx: 60, cy: 60, tool: 7 }]))).toEqual([
      'TOOL_NOT_IN_PROFILE',
    ]);
    expect(codes(run([{ id: 'h', type: 'through', d: 6, cx: 60, cy: 60, tool: 2 }]))).toEqual([
      'HOLE_SMALLER_THAN_TOOL',
    ]);
    const out = run([{ id: 'h', type: 'through', d: 30, cx: 5, cy: 60, tool: 2 }]);
    expect(codes(out)).toEqual(['HOLE_OUTSIDE_PART']);
    expect(out.ok).toBe(false);
  });

  it("through depth beyond the hole tool's flute length", () => {
    const r = run([{ id: 'h', type: 'through', d: 20, cx: 200, cy: 150, tool: 1 }], (p) => {
      const t1 = p.tools.find((t) => t.number === 1);
      if (t1) t1.fluteLength = 12;
    });
    expect(codes(r)).toEqual(['DEPTH_EXCEEDS_FLUTE_LENGTH']);
  });
});

describe('T139 property: any through hole is safe and stays inside its wall', () => {
  it('fast-check', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 80, max: 600 }).map((v) => v / 10),
        fc.constantFrom(1, 2),
        fc.boolean(),
        (d, tool, climb) => {
          const p = profile();
          p.workEnvelope = { x: 3100, y: 2200, z: 150 };
          const project = holeFixtureProject([
            { id: 'h', type: 'through', d, cx: 200, cy: 150, tool },
          ]);
          project.cutting.direction = climb ? 'climb' : 'conventional';
          const r = buildToolpath(project, p);
          expect(r.errors).toEqual([]);
          expect(toolpathSafetyViolations(r.toolpath)).toEqual([]);
          const r0 = (tool === 1 ? 6 : 8) / 2;
          for (const op of holeOps(r)) {
            const first = operationMoves(op)[0];
            const pts = operationMoves(op).filter((m) => m.kind !== 'rapid');
            // Centre = approach XY for a drill; for a pocket the entry ring is centre + (r1, 0).
            const cx = op.copy === 0 ? 300 : 850;
            const cy = op.copy === 0 ? 250 : 300;
            if (op.kind === 'drill') expect(first).toMatchObject({ x: cx, y: cy });
            for (const m of pts) {
              expect(Math.hypot(m.x - cx, m.y - cy)).toBeLessThanOrEqual(d / 2 - r0 + EPS);
              expect(m.z).toBeGreaterThanOrEqual(r.toolpath.targetDepth - EPS);
            }
            const deepest = Math.min(...pts.map((m) => m.z));
            expect(deepest).toBeCloseTo(r.toolpath.targetDepth, 9);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
