import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Point } from '../geometry';
import { buildToolpath } from './build';
import { clone, machineOf, projectOf, sampleMove } from './toolpath.testing';
import type { Project } from '../schema';

// T331 (D-123, field rehearsal B2): below the material top the whole cutter (centre ± radius)
// stays on the sheet, for every tool diameter, lead type, entry and corner of the sheet. A lead
// that does not fit is shortened or removed with its warning.

const EPS = 1e-6;
const W = 1200;
const H = 800;

function offSheet(project: Project, diameter: number): string[] {
  const tp = buildToolpath(project, machineOf({ toolDiameter: diameter }));
  expect(tp.errors).toEqual([]);
  const r = diameter / 2;
  const off: string[] = [];
  for (const op of tp.toolpath?.operations ?? []) {
    let from: (Point & { z: number }) | null = null;
    for (const seg of op.segments) {
      for (const m of seg.moves) {
        if (from && m.kind !== 'rapid' && Math.min(from.z, m.z) < 0) {
          for (const p of sampleMove(from, m)) {
            if (p.x - r < -EPS || p.y - r < -EPS || p.x + r > W + EPS || p.y + r > H + EPS)
              off.push(`${seg.role} ${p.x.toFixed(3)} / ${p.y.toFixed(3)}`);
          }
        }
        from = { x: m.x, y: m.y, z: m.z };
      }
    }
  }
  return off;
}

describe('the cutter never leaves the sheet (T331)', () => {
  it('property: parts in the four corners at margin = Ø, any lead and entry', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(3, 4, 6, 8, 10, 12),
        fc.constantFrom('arc' as const, 'line' as const),
        fc.constantFrom('climb' as const, 'conventional' as const),
        fc.boolean(),
        fc.integer({ min: 0, max: 4 }),
        (d, leadIn, direction, ramp, extra) => {
          const margin = d + extra;
          const w = 200;
          const h = 150;
          const json = clone(
            projectOf({
              parts: [{ id: 'p', w, h, qty: 4 }],
              sheet: { width: W, height: H },
              margin,
              gap: 0.1,
              leadIn,
              direction,
              placements: [
                [
                  { partId: 'p', index: 0, x: margin, y: margin, rot: 0 },
                  { partId: 'p', index: 1, x: W - margin - w, y: margin, rot: 0 },
                  { partId: 'p', index: 2, x: margin, y: H - margin - h, rot: 0 },
                  { partId: 'p', index: 3, x: W - margin - w, y: H - margin - h, rot: 0 },
                ],
              ],
            }),
          ) as Project;
          if (ramp) (json.cutting as Record<string, unknown>).entry = { type: 'ramp', angleDeg: 3 };
          expect(offSheet(json, d).slice(0, 3)).toEqual([]);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('a lead that does not fit at the edge is shortened or removed with its warning', () => {
    const project = projectOf({
      parts: [{ id: 'p', w: 300, h: 200 }],
      sheet: { width: W, height: H },
      margin: 8,
      gap: 0.1,
      placements: [[{ partId: 'p', index: 0, x: 8, y: 8, rot: 0 }]],
    });
    const tp = buildToolpath(project, machineOf({ toolDiameter: 8 }));
    expect(offSheet(project, 8)).toEqual([]);
    // The start edge may face the waste; when it faces the edge the lead gives way with a warning.
    const leadIn = tp.toolpath?.operations[0]?.segments.find((s) => s.role === 'leadIn');
    const warned = tp.warnings.some(
      (w) => w.code === 'LEAD_SHORTENED' || w.code === 'LEAD_REMOVED',
    );
    expect(leadIn !== undefined || warned).toBe(true);
  });
});
