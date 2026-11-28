import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildToolpath } from './build';
import { holeHelixFits } from './holes';
import type { Move, Operation, Toolpath } from './types';
import { aluProfile, aluProject } from './alu.testing';
import type { MachineProfile } from '../machine';
import type { Project } from '../schema';

/** Steepest descent (degrees) of the feed moves that go below Z 0, over XY travel. */
function steepest(tp: Toolpath, skip: (op: Operation) => boolean = () => false): number {
  let worst = 0;
  for (const op of tp.operations) {
    if (skip(op)) continue;
    let at: Move | null = null;
    for (const seg of op.segments)
      for (const m of seg.moves) {
        if (at && m.kind !== 'rapid' && m.z < -1e-9) {
          const top = Math.min(at.z, 0);
          const drop = top - m.z;
          if (drop > 1e-6) {
            const total = at.z - m.z;
            const xy =
              m.kind === 'arc'
                ? Math.hypot(m.x - m.cx, m.y - m.cy) * 4 * Math.abs(Math.atan(m.bulge))
                : Math.hypot(m.x - at.x, m.y - at.y);
            worst = Math.max(worst, (Math.atan2(drop, (xy * drop) / total) * 180) / Math.PI);
          }
        }
        at = m;
      }
  }
  return worst;
}

const codes = (r: ReturnType<typeof buildToolpath>) => [
  ...r.errors.map((i) => i.code),
  ...r.warnings.map((i) => i.code),
];

describe('T358: entries from the traits in aluminium', () => {
  it('contours, hole pockets and grooves never descend steeper than 2° (default)', () => {
    const r = buildToolpath(
      aluProject([
        { id: 'h1', type: 'through', d: 30, cx: 200, cy: 150, tool: 1 },
        { id: 'h2', type: 'groove', d: 60, grooveWidth: 8, depth: 2, cx: 300, cy: 150, tool: 1 },
      ]),
      aluProfile(),
    );
    expect(r.errors).toEqual([]);
    expect(r.toolpath).toBeTruthy();
    expect(steepest(r.toolpath as Toolpath)).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('a project angle above the traits maximum is cut at the maximum (5°)', () => {
    const p = aluProject([]);
    const r = buildToolpath(
      { ...p, cutting: { ...p.cutting, entry: { type: 'ramp', angleDeg: 20 } } },
      aluProfile(),
    );
    expect(r.errors).toEqual([]);
    const s = steepest(r.toolpath as Toolpath);
    expect(s).toBeLessThanOrEqual(5 + 1e-6);
    expect(s).toBeGreaterThan(4);
  });

  it("the material set's ramp angle is used when the project sets none", () => {
    const r = buildToolpath(aluProject([]), aluProfile({ rampDeg: 4 }));
    const s = steepest(r.toolpath as Toolpath);
    expect(s).toBeGreaterThan(3.5);
    expect(s).toBeLessThanOrEqual(4 + 1e-6);
  });

  it('a short contour zig-zags over its whole length, never steeper; too short: ENTRY_RAMP_REQUIRED', () => {
    // Ø20 inner opening: perimeter ≈ 44 mm < the 2° leg (≈ 28,6 mm × 2 per 2 mm)
    const circle = (r: number) => [
      { x: 200 - r, y: 150, bulge: 1 },
      { x: 200 + r, y: 150, bulge: 1 },
    ];
    const ok = buildToolpath(aluProject([], { inners: [circle(10)] }), aluProfile());
    expect(codes(ok)).not.toContain('RAMP_STEEPER');
    expect(ok.errors.map((e) => e.code)).not.toContain('ENTRY_RAMP_REQUIRED');
    expect(steepest(ok.toolpath as Toolpath)).toBeLessThanOrEqual(2 + 1e-6);
    // Ø6,4 opening with the Ø6 tool: the tool centre loop is ≈ 1,3 mm long
    const tiny = buildToolpath(aluProject([], { inners: [circle(3.2)] }), aluProfile());
    expect(tiny.errors.map((e) => e.code)).toContain('ENTRY_RAMP_REQUIRED');
    expect(codes(tiny)).not.toContain('RAMP_STEEPER');
  });

  it('a hole the end mill would plunge (d = Ø) is refused: HOLE_SMALLER_THAN_ENTRY', () => {
    const r = buildToolpath(
      aluProject([{ id: 'h1', type: 'through', d: 6, cx: 60, cy: 60, tool: 1 }]),
      aluProfile(),
    );
    const e = r.errors.find((i) => i.code === 'HOLE_SMALLER_THAN_ENTRY');
    expect(e?.hole).toBe(0);
    expect(e?.message).toMatch(/helix/);
  });

  it('a drill pecks at most 1 × Ø with a retract between pecks (rule 12 allows it)', () => {
    const r = buildToolpath(
      aluProject([{ id: 'h1', type: 'through', d: 5, cx: 60, cy: 60, tool: 3 }]),
      aluProfile({ stepDown: 3 }),
    );
    expect(r.errors).toEqual([]);
    const drill = (r.toolpath as Toolpath).operations.find((o) => o.kind === 'drill');
    expect(drill).toBeTruthy();
    let prev = 0;
    for (const z of drill?.passDepths ?? []) {
      expect(prev - z).toBeLessThanOrEqual(5 + 1e-9);
      prev = z;
    }
    const pass = drill?.segments.find((s) => s.role === 'pass');
    expect(pass?.moves.at(-1)?.kind).toBe('rapid');
  });

  it('a contour pocket ramps down from the top on every pass (no plunge to the cleared floor)', () => {
    const square = [
      { x: 150, y: 100, bulge: 0 },
      { x: 250, y: 100, bulge: 0 },
      { x: 250, y: 200, bulge: 0 },
      { x: 150, y: 200, bulge: 0 },
    ];
    const r = buildToolpath(
      aluProject([], {
        inners: [square],
        ops: { inners: [{ kind: 'pocket', depth: 4 }] },
      } as Partial<Project['parts'][number]>),
      aluProfile(),
    );
    expect(r.errors).toEqual([]);
    const tp = r.toolpath as Toolpath;
    expect(tp.operations.some((o) => o.kind === 'pocket')).toBe(true);
    expect(steepest(tp)).toBeLessThanOrEqual(2 + 1e-6);
    expect(codes(r)).not.toContain('POCKET_PLUNGE_ENTRY');
  });

  it('holeHelixFits: false for a plunged hole or a ring below 0,5 mm; else as many turns as needed', () => {
    const h = (d: number) => ({ id: 'h', type: 'through', d, cx: 0, cy: 0 }) as never;
    expect(holeHelixFits(h(6), 6)).toBe(false);
    expect(holeHelixFits(h(6.8), 6)).toBe(false);
    expect(holeHelixFits(h(7), 6)).toBe(true);
    expect(holeHelixFits(h(30), 6)).toBe(true);
  });

  it('property: random aluminium holes either cut no steeper than the limit or are refused', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 6.5, max: 60, noNaN: true }),
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        fc.double({ min: 0.5, max: 5, noNaN: true }),
        (d, step, angle) => {
          const p = aluProject([{ id: 'h1', type: 'through', d, cx: 200, cy: 150, tool: 1 }]);
          const r = buildToolpath(
            { ...p, cutting: { ...p.cutting, entry: { type: 'ramp', angleDeg: angle } } },
            aluProfile({ stepDown: step }),
          );
          if (!r.toolpath) {
            expect(r.errors.map((e) => e.code)).toContain('HOLE_SMALLER_THAN_ENTRY');
            return true;
          }
          return steepest(r.toolpath, (op) => op.kind === 'drill') <= angle + 1e-6;
        },
      ),
      { numRuns: 25 },
    );
  });

  it('wood keeps its entries (straight plunge, 3° hole helix)', () => {
    const r = buildToolpath(
      aluProject([{ id: 'h1', type: 'through', d: 6, cx: 60, cy: 60, tool: 1 }], {}, 'mdf'),
      (() => {
        const p = aluProfile();
        p.materials = [
          ...p.materials,
          { ...(p.materials.at(-1) as MachineProfile['materials'][number]), material: 'mdf' },
        ];
        return p;
      })(),
    );
    expect(r.errors.map((e) => e.code)).not.toContain('HOLE_SMALLER_THAN_ENTRY');
    expect(r.toolpath?.operations.some((o) => o.kind === 'drill')).toBe(true);
  });
});
