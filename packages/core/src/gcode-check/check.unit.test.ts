/**
 * Unit cases of the checks (T019): the independent inverse frame against hand-computed points,
 * multi-tool and multi-file programs, tool-change order, context errors, the layout check.
 */
import { describe, expect, it } from 'vitest';
import { defaultMachineProfile } from '../machine';
import { generateGcode } from '../post';
import { canDownload, checkGcode, checkGcodeFiles } from './check';
import { golden, postConfig } from './check.testing';
import { checkFrame, sheetDirection, sheetPoint } from './frame';
import { expectedLayouts } from './layout';
import type { GcodeCheckContext } from './types';

describe('inverse frame (machine → sheet), hand-computed (D-025 worked examples)', () => {
  const stock = { thickness: 18, sheetWidth: 1000, sheetHeight: 500 };
  const profile = (
    corner: 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight',
    x: 'right' | 'left',
    y: 'back' | 'front',
    ref: 'table' | 'materialTop' = 'materialTop',
  ) => {
    const p = defaultMachineProfile();
    p.origin = { corner, xPositive: x, yPositive: y, sheetOffset: { x: 10, y: 20 } };
    p.zZero = { reference: ref, spoilboardAllowance: 0.5 };
    return p;
  };
  it('front-left, X+ right, Y+ back, material top: (10, 20, 0) → (0, 0, 0)', () => {
    const f = checkFrame(profile('frontLeft', 'right', 'back'), stock);
    expect(sheetPoint(f, { x: 10, y: 20, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(f.mirrored).toBe(false);
  });
  it('Z zero = table: Z −0.5 → −18.5, Z 38 → 20', () => {
    const f = checkFrame(profile('frontLeft', 'right', 'back', 'table'), stock);
    expect(sheetPoint(f, { x: 10, y: 20, z: -0.5 }).z).toBeCloseTo(-18.5, 9);
    expect(sheetPoint(f, { x: 10, y: 20, z: 38 }).z).toBeCloseTo(20, 9);
  });
  it('back-right, X+ left, Y+ front: (1010, 520) → (0, 0), (10, 20) → (1000, 500)', () => {
    const f = checkFrame(profile('backRight', 'left', 'front'), stock);
    expect(sheetPoint(f, { x: 1010, y: 520, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(sheetPoint(f, { x: 10, y: 20, z: 0 })).toEqual({ x: 1000, y: 500, z: 0 });
    expect(f.mirrored).toBe(false);
  });
  it('front-right, X+ left, Y+ back: (1010, 20) → (0, 0), mirrored: G3 is CW on the sheet', () => {
    const f = checkFrame(profile('frontRight', 'left', 'back'), stock);
    expect(sheetPoint(f, { x: 1010, y: 20, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(f.mirrored).toBe(true);
    expect(sheetDirection(f, 'ccw')).toBe('cw');
  });
  it('back-left, X+ right, Y+ front: (10, 520) → (0, 0)', () => {
    const f = checkFrame(profile('backLeft', 'right', 'front'), stock);
    expect(sheetPoint(f, { x: 10, y: 520, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(f.mirrored).toBe(true);
  });
  it('axis pointing away from the table (front-left, X+ left): (−10, 20) → (0, 0)', () => {
    const f = checkFrame(profile('frontLeft', 'left', 'back'), stock);
    expect(sheetPoint(f, { x: -10, y: 20, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('several tools, several files', () => {
  /** The golden mixed project with the operations alternating between T2 and T1 (same Ø). */
  function twoTools(post: 'generic' | 'mach3', mode?: 'none', maxSize?: number) {
    const g = golden(post, 'mixed');
    const profile = structuredClone(g.context.profile);
    profile.tools = [
      { number: 1, type: 'flatEndMill', diameter: 8, fluteLength: 25, flutes: 2 },
      { number: 2, type: 'flatEndMill', diameter: 8, fluteLength: 25, flutes: 2 },
    ];
    const toolpath = structuredClone(g.toolpath);
    toolpath.operations.forEach((op, i) => (op.tool = i === 1 ? 1 : 2));
    const cfg = postConfig(post);
    if (mode === 'none') cfg.toolChange = { ...cfg.toolChange, mode: 'none' };
    if (maxSize) cfg.file.maxSizeBytes = maxSize;
    const res = generateGcode(toolpath, { profile, version: 1, verification: 'draft' }, cfg, {
      projectName: 'iki takim',
      revision: 1,
      stock: {
        material: 'mdf',
        thickness: 18,
        sheetWidth: g.project.stock.sheet.width,
        sheetHeight: g.project.stock.sheet.height,
      },
    });
    expect(res.errors).toEqual([]);
    const ctx = { ...g.context, profile, toolpath, post: cfg, layout: expectedLayouts(g.project) };
    return {
      res,
      ctx,
      files: res.files.map((f) => ({ name: f.name, content: f.content, sheet: f.sheet })),
    };
  }

  it.each(['generic', 'mach3'] as const)('%s: T2, T1, T2 in one program passes', (post) => {
    const { files, ctx } = twoTools(post);
    expect(files).toHaveLength(1);
    const r = checkGcodeFiles(files, ctx);
    expect(r.violations).toEqual([]);
  });

  it('generic: swapped tool numbers in the M6 lines are caught (TOOL_ORDER)', () => {
    const { files, ctx } = twoTools('generic');
    const f = must(files[0]);
    const bad = f.content.replace('T1 M6', 'T9 M6').replace(/T2 M6/, 'T1 M6');
    const r = checkGcodeFiles([{ ...f, content: bad }], ctx);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain('TOOL_ORDER');
  });

  it('mach3: the prompt of the second change names the wrong tool', () => {
    const { files, ctx } = twoTools('mach3');
    const f = must(files[0]);
    const bad = f.content.replace(/\(TAKIM DEGISTIR: T1 /, '(TAKIM DEGISTIR: T2 ');
    expect(bad).not.toBe(f.content);
    const r = checkGcodeFiles([{ ...f, content: bad }], ctx);
    expect(r.violations.map((v) => v.code)).toContain('TOOL_PROMPT_MISMATCH');
  });

  it('"none" mode: one file per tool run, checked in sequence', () => {
    const { files, ctx } = twoTools('generic', 'none');
    expect(files.length).toBe(3);
    const r = checkGcodeFiles(files, ctx);
    expect(r.violations).toEqual([]);
    // a missing middle file breaks the sequence and the layout
    const r2 = checkGcodeFiles([must(files[0]), must(files[2])], ctx);
    expect(r2.ok).toBe(false);
  });

  it('split program: the parts consume the operations in order; the layout spans all parts', () => {
    const { files, ctx, res } = twoTools('mach3', undefined, 4_000);
    expect(res.files.some((f) => f.parts > 1)).toBe(true);
    const r = checkGcodeFiles(files, ctx);
    expect(r.violations).toEqual([]);
    const last = must(r.files[r.files.length - 1]).result.summary;
    expect(last.partsCut).toBe(3);
    expect(last.partsExpected).toBe(3);
    // the files in the wrong order are caught
    expect(checkGcodeFiles([...files].reverse(), ctx).ok).toBe(false);
  });

  it('a missing sheet is caught', () => {
    const { files, ctx } = twoTools('generic');
    const r = checkGcodeFiles(files, {
      ...ctx,
      toolpath: {
        ...ctx.toolpath,
        operations: [...ctx.toolpath.operations, { ...must(ctx.toolpath.operations[0]), sheet: 1 }],
      },
    });
    expect(r.violations.map((v) => v.code)).toContain('SHEET_MISSING');
  });
});

describe('context and layout', () => {
  const g = golden('generic', 'mixed');
  it('a context without operations for the sheet is an INPUT error, never a pass', () => {
    const r = checkGcode(g.text, { ...g.context, sheet: 3 });
    expect(r.ok).toBe(false);
    expect(r.violations[0]?.rule).toBe('INPUT');
    expect(canDownload(r)).toBe(false);
  });
  it('a toolpath for another thickness is an INPUT error', () => {
    const ctx: GcodeCheckContext = { ...g.context, stock: { ...g.context.stock, thickness: 19 } };
    expect(checkGcode(g.text, ctx).violations.map((v) => v.code)).toContain('STOCK_MISMATCH');
  });
  it('empty text fails', () => {
    expect(checkGcode('', g.context).ok).toBe(false);
  });
  it('a layout with one part moved 1 mm is caught; 0.01 mm is within tolerance', () => {
    const layout = must(g.context.layout).map((p, i) => (i === 0 ? { ...p, cx: p.cx + 1 } : p));
    expect(checkGcode(g.text, { ...g.context, layout }).violations.map((v) => v.code)).toEqual(
      expect.arrayContaining(['PART_POSITION', 'PART_MISSING']),
    );
    const near = must(g.context.layout).map((p, i) => (i === 0 ? { ...p, cx: p.cx + 0.01 } : p));
    expect(checkGcode(g.text, { ...g.context, layout: near }).ok).toBe(true);
  });
  it('the sheet must fit the table', () => {
    const profile = { ...g.context.profile, table: { width: 2000, depth: 2150 } };
    expect(checkGcode(g.text, { ...g.context, profile }).violations.map((v) => v.code)).toContain(
      'SHEET_OUTSIDE_TABLE',
    );
  });
  it('a verified profile with an unverified post still needs the header (rule 10)', () => {
    const noHeader = g.text.split('\r\n').slice(1).join('\r\n');
    const r = checkGcode(noHeader, {
      ...g.context,
      verification: 'verified',
      profile: { ...g.context.profile, example: false },
    });
    expect(r.violations.map((v) => v.code)).toEqual(['UNVERIFIED_HEADER_MISSING']);
  });
});

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('test fixture value missing');
  return v;
}
