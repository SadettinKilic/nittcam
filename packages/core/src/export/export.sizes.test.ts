import { describe, expect, it } from 'vitest';
import { checkGcodeFiles } from '../gcode-check';
import { golden, postConfig } from '../gcode-check/check.testing';
import type { MachineProfile } from '../machine';
import { generateGcode, type PostMeta } from '../post';
import type { Project } from '../schema';
import { buildToolpath } from '../toolpath';
import { exportNc } from './export';

/**
 * T164: several stock sheet sizes through the G-code chain. A sheet with its own size gets its own
 * header size and machine frame (a right/back program zero moves with the sheet edge), and the
 * independent check uses that sheet's size for the frame and the sheet limits.
 */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Program zero at the back right, axes into the table: the frame depends on the sheet size. */
function backRight(profile: MachineProfile): MachineProfile {
  const p = clone(profile);
  p.origin = { ...p.origin, corner: 'backRight', xPositive: 'left', yPositive: 'front' };
  return p;
}

/** Largest x / y of every point in the toolpath (sheet frame). */
function extent(value: unknown, acc = { x: 0, y: 0 }): { x: number; y: number } {
  if (Array.isArray(value)) for (const v of value) extent(v, acc);
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.x === 'number' && typeof o.y === 'number') {
      acc.x = Math.max(acc.x, o.x);
      acc.y = Math.max(acc.y, o.y);
    }
    for (const v of Object.values(o)) extent(v, acc);
  }
  return acc;
}

/** The golden "mixed" project on a smaller own sheet that still holds every cut (two sizes listed). */
function sized() {
  const g = golden('generic', 'mixed');
  const profile = backRight(g.context.profile);
  const tp = buildToolpath(g.project, profile);
  if (!tp.ok) throw new Error('toolpath');
  const e = extent(tp.toolpath.operations.map((o) => o.segments));
  const big = g.project.stock.sheet;
  const small = { width: Math.ceil(e.x) + 20, height: Math.ceil(e.y) + 20 };
  expect(small.width).toBeLessThan(big.width);
  const project: Project = clone(g.project);
  project.stock.sheets = [{ width: big.width, height: big.height }, small];
  project.layout.sheets.forEach((s) => (s.size = { ...small }));
  return { g, profile, project, small, big };
}

const pv = (profile: MachineProfile) => ({ profile, version: 1, verification: 'draft' as const });

describe('several sheet sizes in the G-code chain (T164)', () => {
  it('a sheet with its own size: header and frame use it, the checks pass', () => {
    const { profile, project, small, big } = sized();
    const own = exportNc(project, pv(profile), postConfig('generic'), { revision: 1 });
    expect(own.postErrors).toEqual([]);
    expect(own.check?.violations.filter((v) => v.severity === 'error')).toEqual([]);
    expect(own.ok).toBe(true);
    const text = own.files[0]?.content ?? '';
    expect(text).toContain(`plaka ${small.width.toFixed(3)} x ${small.height.toFixed(3)}`);

    // Same cuts on the default size: every machine X moves by the width difference (zero at the
    // right edge), every Y by the height difference.
    const plain = clone(project);
    delete plain.stock.sheets;
    plain.layout.sheets.forEach((s) => delete s.size);
    const def = exportNc(plain, pv(profile), postConfig('generic'), { revision: 1 });
    expect(def.ok).toBe(true);
    const firstXY = (t: string) => {
      const m = /X(-?\d+\.\d+) Y(-?\d+\.\d+)/.exec(t);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    };
    const a = firstXY(text);
    const b = firstXY(def.files[0]?.content ?? '');
    expect(a && b).toBeTruthy();
    expect((b?.x ?? 0) - (a?.x ?? 0)).toBeCloseTo(big.width - small.width, 3);
    expect((b?.y ?? 0) - (a?.y ?? 0)).toBeCloseTo(big.height - small.height, 3);
  });

  it('the check reads each sheet in its own frame and against its own size', () => {
    const { g, profile, project, small, big } = sized();
    const tp = buildToolpath(project, profile);
    if (!tp.ok) throw new Error('toolpath');
    const meta: PostMeta = {
      projectName: 'T164',
      revision: 1,
      stock: {
        material: project.stock.material,
        thickness: project.stock.thickness,
        sheetWidth: big.width,
        sheetHeight: big.height,
        sheets: { 0: { sheetWidth: small.width, sheetHeight: small.height } },
      },
    };
    const post = generateGcode(tp.toolpath, pv(profile), postConfig('generic'), meta);
    expect(post.errors).toEqual([]);
    const context = {
      ...g.context,
      profile,
      layout: null,
      toolpath: tp.toolpath,
      stock: { thickness: project.stock.thickness, sheetWidth: big.width, sheetHeight: big.height },
    };
    const sizes = new Map([[0, { sheetWidth: small.width, sheetHeight: small.height }]]);
    expect(checkGcodeFiles(post.files, { ...context, sheetSizes: sizes }).ok).toBe(true);
    // Read in the default sheet's frame, the program does not match its toolpath.
    expect(checkGcodeFiles(post.files, context).ok).toBe(false);
    // A sheet smaller than the cuts: a move outside that sheet is caught.
    const tiny = new Map([[0, { sheetWidth: small.width - 60, sheetHeight: small.height }]]);
    const r = checkGcodeFiles(post.files, { ...context, sheetSizes: tiny });
    expect(r.violations.map((v) => v.code)).toContain('CUT_OUTSIDE_SHEET');
  });

  it('invalid per-sheet sizes are refused by the post', () => {
    const { profile, project, big } = sized();
    const tp = buildToolpath(project, profile);
    if (!tp.ok) throw new Error('toolpath');
    const post = generateGcode(tp.toolpath, pv(profile), postConfig('generic'), {
      projectName: 'T164',
      revision: 1,
      stock: {
        material: 'x',
        thickness: project.stock.thickness,
        sheetWidth: big.width,
        sheetHeight: big.height,
        sheets: { 0: { sheetWidth: Number.NaN, sheetHeight: 100 } },
      },
    });
    expect(post.errors.map((e) => e.code)).toEqual(['INVALID_META']);
  });

  it('one size: no per-sheet sizes in the meta, files equal the golden file', () => {
    const g = golden('generic', 'mixed');
    const project = clone(g.project);
    project.stock.sheets = [
      { width: project.stock.sheet.width, height: project.stock.sheet.height },
    ];
    const r = exportNc(project, pv(g.context.profile), postConfig('generic'), {
      projectName: 'Karışık (dikdörtgen alt küme)',
      revision: 1,
      fileStem: 'mixed',
    });
    expect(r.ok).toBe(true);
    expect(r.files[0]?.content).toBe(g.text);
  });
});
