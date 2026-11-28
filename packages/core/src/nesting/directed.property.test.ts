import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allowedRotations, normalizeRotation } from '../geometry/grain';
import type { Project } from '../schema';
import { projectOf } from '../toolpath/toolpath.testing';
import { validateProject } from '../validate';
import { grainSheetOf } from './grain-sheet';
import { nestProject } from './nest';

// T347 (§3.6 "Yön", §9.2): on a directed material (ACM film arrow) a fixed part is placed only at
// g = sheet − part (g + 180 when `grain.flip`); axial materials keep g and g + 180.

function project(
  material: string,
  parts: { w: number; h: number; qty: number; angle: number; flip?: boolean }[],
  sheetGrain: number,
): Project {
  const p = projectOf({
    parts: parts.map((x, i) => ({ id: `p${i}`, w: x.w, h: x.h, qty: x.qty })),
    sheet: { width: 2800, height: 2070 },
    gap: 8,
    margin: 10,
  });
  return {
    ...p,
    stock: { ...p.stock, material, sheet: { ...p.stock.sheet, grain: sheetGrain } },
    parts: p.parts.map((part, i) => {
      const x = parts[i];
      if (!x) return part;
      return {
        ...part,
        grain: { mode: 'fixed' as const, angle: x.angle, ...(x.flip ? { flip: true } : {}) },
      };
    }),
  };
}

const fixed = (angle: number, flip?: boolean) => ({
  grain: { mode: 'fixed' as const, angle, ...(flip ? { flip } : {}) },
});

describe('directed grain rule (T347)', () => {
  it('allowedRotations: axial g and g + 180; directed g only, flipped g + 180', () => {
    expect(allowedRotations(fixed(30), { grain: 90 })).toEqual([60, 240]);
    expect(allowedRotations(fixed(30), { grain: 90, directed: true })).toEqual([60]);
    expect(allowedRotations(fixed(30, true), { grain: 90, directed: true })).toEqual([240]);
    // flip means nothing on an axial sheet; free parts and grainless sheets unchanged
    expect(allowedRotations(fixed(30, true), { grain: 90 })).toEqual([60, 240]);
    expect(
      allowedRotations({ grain: { mode: 'free', angle: 0 } }, { grain: 0, directed: true }),
    ).toEqual([0, 90, 180, 270]);
    expect(allowedRotations(fixed(30), { grain: null, directed: true })).toEqual([0, 90, 180, 270]);
  });

  it('grainSheetOf: only ACM is directed', () => {
    const p = project('acm', [{ w: 100, h: 50, qty: 1, angle: 0 }], 0);
    expect(grainSheetOf(p)).toEqual({ grain: 0, directed: true });
    for (const m of ['mdf', 'aluminium', 'acrylic', 'unknown'])
      expect(grainSheetOf({ stock: { ...p.stock, material: m } })).toEqual({ grain: 0 });
  });

  it('property: on a directed sheet no fixed part is ever placed 180° off', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            w: fc.integer({ min: 80, max: 900 }),
            h: fc.integer({ min: 80, max: 700 }),
            qty: fc.integer({ min: 1, max: 4 }),
            angle: fc.constantFrom(0, 90),
            flip: fc.boolean(),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.constantFrom(0, 90),
        (parts, sheetGrain) => {
          const p = project('acm', parts, sheetGrain);
          const out: Project = { ...p, layout: nestProject(p, { toolDiameter: 6 }).layout };
          for (const sheet of out.layout.sheets)
            for (const pl of sheet.placements) {
              const part = out.parts.find((x) => x.id === pl.partId);
              if (!part) continue;
              const g = sheetGrain - part.grain.angle + (part.grain.flip ? 180 : 0);
              expect(normalizeRotation(pl.rot)).toBe(normalizeRotation(g));
            }
          const codes = validateProject(out).map((i) => i.code);
          expect(codes).not.toContain('PLACEMENT_GRAIN');
        },
      ),
      { numRuns: 25 },
    );
  });

  it('PLACEMENT_GRAIN judges a directed placement turned 180°; MDF accepts it', () => {
    for (const material of ['acm', 'mdf']) {
      const p = project(material, [{ w: 300, h: 200, qty: 1, angle: 0 }], 0);
      const turned: Project = structuredClone({
        ...p,
        layout: nestProject(p, { toolDiameter: 6 }).layout,
      });
      const pl = turned.layout.sheets[0]?.placements[0];
      if (!pl) throw new Error('not placed');
      pl.rot = normalizeRotation(pl.rot + 180);
      const codes = validateProject(turned).map((i) => i.code);
      if (material === 'acm') expect(codes).toContain('PLACEMENT_GRAIN');
      else expect(codes).not.toContain('PLACEMENT_GRAIN');
    }
  });
});
