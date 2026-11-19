/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit raw JSON */
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { golden, postConfig } from '../gcode-check/check.testing';
import type { MachineProfile } from '../machine';
import { parseProject, sheetSizeOf, type Project } from '../schema';
import { exportNc } from './export';

/**
 * T164 tester: a nested layout with mixed sheet sizes, exported through the whole chain under
 * every program-zero corner. Each file's machine X/Y span must fit inside its own sheet (never
 * the biggest one), and the in-chain independent check must pass.
 */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const CORNERS: Array<[string, 'xPositive' | 'x', string, string]> = [
  ['frontLeft', 'xPositive', 'right', 'back'],
  ['frontRight', 'xPositive', 'left', 'back'],
  ['backLeft', 'xPositive', 'right', 'front'],
  ['backRight', 'xPositive', 'left', 'front'],
];

function withCorner(p: MachineProfile, corner: string, xp: string, yp: string): MachineProfile {
  const o = clone(p);
  o.origin = { ...o.origin, corner, xPositive: xp, yPositive: yp } as MachineProfile['origin'];
  return o;
}

function mixed(): Project {
  const j = clone(golden('generic', 'shelf-set').project) as unknown as Record<string, any>;
  const r = parseProject(j);
  if (!r.ok) throw new Error('parse');
  const n = applyCommand(r.project, 'runNesting', { toolDiameter: 8 });
  if (!n.ok) throw new Error('nest');
  // Split the one nested sheet in two and give the halves different sizes (same coordinates).
  const out = clone(n.project);
  const first = out.layout.sheets[0];
  if (!first) throw new Error('no sheet');
  const half = Math.ceil(first.placements.length / 2);
  const second = { ...clone(first), placements: first.placements.slice(half) };
  first.placements = first.placements.slice(0, half);
  first.size = { ...out.stock.sheet };
  second.size = { width: 2600, height: 2000 };
  out.layout.sheets.push(second);
  out.stock.sheets = [
    { width: out.stock.sheet.width, height: out.stock.sheet.height },
    { width: 2600, height: 2000 },
  ];
  return out;
}

describe('mixed sheet sizes never leave their own sheet (T164 tester)', () => {
  const profile = golden('generic', 'shelf-set').context.profile;
  for (const [corner, , xp, yp] of CORNERS) {
    it(`corner ${corner}: per-file span fits own sheet, check passes`, () => {
      const project = mixed();
      const sizes = new Set(project.layout.sheets.map((s) => `${s.size?.width}x${s.size?.height}`));
      expect(sizes.size).toBeGreaterThanOrEqual(2);
      const prof = withCorner(profile, corner, xp, yp);
      const r = exportNc(
        project,
        { profile: prof, version: 1, verification: 'draft' },
        postConfig('generic'),
        { revision: 1 },
      );
      expect({ stage: r.stage, pe: r.postErrors, te: r.toolpathIssues }).toEqual({
        stage: 'done',
        pe: [],
        te: [],
      });
      expect(r.check?.ok).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.files.length).toBeGreaterThan(0);
      for (const f of r.files) {
        const size = sheetSizeOf(project, f.sheet);
        const xs: number[] = [];
        const ys: number[] = [];
        for (const m of f.content.matchAll(/X(-?\d+(?:\.\d+)?)\s*Y(-?\d+(?:\.\d+)?)/g)) {
          xs.push(Number(m[1]));
          ys.push(Number(m[2]));
        }
        expect(xs.length).toBeGreaterThan(0);
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(size.width + 1e-6);
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(size.height + 1e-6);
        // Right/back zero: nothing ever sits on the wrong side of zero by more than the sheet.
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(-size.width - 1e-6);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(-size.height - 1e-6);
      }
    });
  }

  it('a layout sheet whose own size is smaller than its cuts is refused (no files)', () => {
    const project = mixed();
    const last = project.layout.sheets[project.layout.sheets.length - 1];
    if (!last) throw new Error('no sheet');
    last.size = { width: 300, height: 300 };
    const r = exportNc(
      project,
      { profile, version: 1, verification: 'draft' },
      postConfig('generic'),
      { revision: 1 },
    );
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
  });
});
