/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester (B23, T165-T167): engine selection and a 30° grain job end to end. Cabinet doors on a sheet
 * with grain 30° go true-shape; the G-code passes every automatic check (spec §7.2), cuts stay inside
 * the sheet, no two placed outlines are closer than the tool Ø + gap minus the Euclidean slack
 * (sampled-distance oracle), and the same job twice gives byte-identical G-code. Axis-aligned
 * rectangle jobs stay on MaxRects.
 */
import { describe, expect, it } from 'vitest';
import { exportNc } from '../export/export';
import { postConfig } from '../gcode-check/check.testing';
import { allowedRotations } from '../geometry/grain';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { placedOutline } from '../toolpath/build';
import { nestProject, nestingEngineOf } from './index';

const D = 8;
const profile = goldenProfile('generic');
const pv = { profile, version: 1, verification: 'draft' as const };

function doors(grain: number, extra: Record<string, unknown> = {}): Project {
  const src = structuredClone(cabinetDoors) as unknown as {
    stock: { material: string; thickness: number; sheet: { grain: number } };
    parts: Record<string, unknown>[];
    layout: unknown;
    nesting: Record<string, unknown>;
  };
  src.stock.material = 'mdf';
  src.stock.thickness = 18;
  src.stock.sheet.grain = grain;
  src.parts = src.parts
    .filter((p) => p.kind === 'rect')
    .map((p) => ({ ...p, holes: [], inners: [], templates: [] }));
  src.layout = { sheets: [] };
  src.nesting = { ...src.nesting, ...extra };
  const r = parseProject(src);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return { ...r.project, layout: nestProject(r.project, { toolDiameter: D }).layout };
}

describe('engine selection (T167)', () => {
  it('axis-aligned rectangle jobs stay on MaxRects; 30° grain goes true-shape', () => {
    expect(nestingEngineOf(goldenProject(shelfSet, D))).toBe('maxrects');
    expect(nestingEngineOf(doors(0))).toBe('maxrects');
    expect(nestingEngineOf(doors(30))).toBe('trueShape');
  });
});

describe('30° grain job on the true-shape engine (T165/T166)', () => {
  const project = doors(30);

  it('fixed-grain parts sit at grain-aligned angles', () => {
    for (const sh of project.layout.sheets)
      for (const pl of sh.placements) {
        const part = project.parts.find((p) => p.id === pl.partId)!;
        const allowed = allowedRotations(part, { grain: 30 }, {});
        expect(
          allowed.some(
            (a) =>
              Math.abs((((a - pl.rot) % 360) + 360) % 360) < 1e-6 ||
              Math.abs(((((a - pl.rot) % 360) + 360) % 360) - 360) < 1e-6,
          ),
        ).toBe(true);
      }
  });

  it('no two outlines closer than D + gap (Euclidean), inside the sheet', () => {
    const gap = project.nesting.gap;
    const W = project.stock.sheet.width;
    const H = project.stock.sheet.height;
    for (const sh of project.layout.sheets) {
      const rings = sh.placements.map(
        (pl) =>
          placedOutline(
            project.parts.find((p) => p.id === pl.partId)!,
            pl,
          ).vertices,
      );
      for (const r of rings)
        for (const v of r) {
          expect(v.x).toBeGreaterThanOrEqual(-1e-6);
          expect(v.y).toBeGreaterThanOrEqual(-1e-6);
          expect(v.x).toBeLessThanOrEqual(W + 1e-6);
          expect(v.y).toBeLessThanOrEqual(H + 1e-6);
        }
      const dense = rings.map((vs) => {
        const pts: { x: number; y: number }[] = [];
        vs.forEach((a, i) => {
          const b = vs[(i + 1) % vs.length]!;
          const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
          for (let k = 0; k < n; k++)
            pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
        });
        return pts;
      });
      for (let i = 0; i < dense.length; i++)
        for (let j = i + 1; j < dense.length; j++) {
          let m = Infinity;
          for (const p of dense[i]!)
            for (const q of dense[j]!) m = Math.min(m, Math.hypot(p.x - q.x, p.y - q.y));
          // 2 mm sampling slack
          expect(m).toBeGreaterThanOrEqual(D + gap - 2.1);
        }
    }
  });

  it('G-code passes every §7.2 check and is byte-identical on a re-run', () => {
    const a = exportNc(project, pv, postConfig('generic'));
    expect(a.ok, JSON.stringify(a.check?.violations?.slice(0, 3))).toBe(true);
    expect(a.check?.violations ?? []).toEqual([]);
    const b = exportNc(doors(30), pv, postConfig('generic'));
    expect(b.files.map((f) => f.content)).toEqual(a.files.map((f) => f.content));
  });
});
