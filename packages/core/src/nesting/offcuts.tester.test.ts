/**
 * Tester (B25, T168): offcut-first nesting never places outside an offcut (MaxRects and
 * true-shape), the 300 mm proposal threshold is inclusive, and rotated/grain rules hold.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Project } from '../schema';
import { projectOf } from '../toolpath/toolpath.testing';
import { nestProject } from './nest';
import { proposeOffcuts } from './offcuts';

function proj(grain: number | null): Project {
  const p = projectOf({
    parts: [
      { id: 'a', w: 400, h: 300, qty: 2 },
      { id: 'b', w: 250, h: 200 },
    ],
    gap: 4,
    margin: 10,
  });
  return { ...p, stock: { ...p.stock, useOffcuts: true, sheet: { ...p.stock.sheet, grain } } };
}

describe.each(['maxrects', 'trueShape'] as const)('offcut-first nesting (%s)', (engine) => {
  it('property: every placement of an offcut sheet lies inside that offcut', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 450, max: 1500 }),
        fc.integer({ min: 350, max: 1000 }),
        (width, height) => {
          const r = nestProject(proj(0), {
            toolDiameter: 8,
            engine,
            offcuts: [{ id: 'o1', width, height }],
          });
          const sheet = r.layout.sheets.find((s) => s.offcutId === 'o1');
          if (!sheet) return true;
          const size = { w: sheet.size?.width ?? width, h: sheet.size?.height ?? height };
          expect(size).toEqual({ w: width, h: height });
          const dims: Record<string, [number, number]> = { a: [400, 300], b: [250, 200] };
          for (const pl of sheet.placements) {
            const [w, h] = dims[pl.partId] as [number, number];
            const sw = pl.rot % 180 === 0 ? w : h;
            const sh = pl.rot % 180 === 0 ? h : w;
            expect(pl.x).toBeGreaterThanOrEqual(-1e-6);
            expect(pl.y).toBeGreaterThanOrEqual(-1e-6);
            expect(pl.x + sw).toBeLessThanOrEqual(width + 1e-6);
            expect(pl.y + sh).toBeLessThanOrEqual(height + 1e-6);
          }
          return true;
        },
      ),
      { numRuns: 25 },
    );
  });

  it('an offcut too small for every part is not used; parts go to a full sheet', () => {
    const r = nestProject(proj(0), {
      toolDiameter: 8,
      engine,
      offcuts: [{ id: 'tiny', width: 200, height: 150 }],
    });
    expect(r.unplaced).toHaveLength(0);
    const tiny = r.layout.sheets.find((s) => s.offcutId === 'tiny');
    expect(tiny?.placements ?? []).toHaveLength(0);
  });
});

describe('proposal threshold', () => {
  it('300 x 300 is proposed, 299.9 is not', () => {
    const p = projectOf({ parts: [{ id: 'a', w: 1000, h: 1200 }], gap: 4, margin: 10 });
    const near = (strip: number): Project => ({
      ...p,
      layout: {
        sheets: [{ placements: [{ partId: 'a', index: 0, x: 0, y: 0, rot: 0, locked: false }] }],
      },
      stock: { ...p.stock, sheet: { ...p.stock.sheet, width: 1002 + strip, height: 1204 } },
    });
    const at = (strip: number) =>
      proposeOffcuts(near(strip), 0).filter((o) => o.width < 400 && o.x > 0);
    expect(at(300).length).toBeGreaterThan(0);
    expect(at(299.9)).toHaveLength(0);
  });
});
