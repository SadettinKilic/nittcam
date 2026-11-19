/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit raw JSON */
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { summarizeLayout } from '../nesting';
import { parseProject, sheetSizeOf, type Project } from '../schema';
import { validateProject } from '../validate';
import { applyCommand } from './index';

/** T164: a project with several stock sizes through `runNesting`. */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function load(mutate: (j: Record<string, any>) => void = () => {}): Project {
  const copy = clone(shelfSet) as Record<string, any>;
  mutate(copy);
  const r = parseProject(copy);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

describe('runNesting with stock.sheets (T164)', () => {
  it('without stock.sheets the layout has no sizes (unchanged projects)', () => {
    const r = applyCommand(load(), 'runNesting', { toolDiameter: 8 });
    if (!r.ok) throw new Error('not nested');
    expect(r.project.layout.sheets.every((s) => s.size === undefined)).toBe(true);
  });

  it('writes a size per sheet, keeps qty limits, and the layout validates', () => {
    const p = load((j) => {
      j.stock.sheets = [
        { width: j.stock.sheet.width, height: j.stock.sheet.height, qty: 1 },
        { width: 1220, height: 1220 },
      ];
    });
    const r = applyCommand(p, 'runNesting', { toolDiameter: 8 });
    if (!r.ok) throw new Error('not nested');
    const sheets = r.project.layout.sheets;
    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets.every((s) => s.size !== undefined)).toBe(true);
    const big = sheets.filter((s) => s.size?.width === p.stock.sheet.width).length;
    expect(big).toBeLessThanOrEqual(1);
    const summary = summarizeLayout(r.project);
    summary.sheets.forEach((st, i) => {
      const d = sheetSizeOf(r.project, i);
      expect(st.sheetArea).toBe(d.width * d.height);
    });
    const errors = validateProject(r.project).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    // Same input, same layout.
    const again = applyCommand(p, 'runNesting', { toolDiameter: 8 });
    expect(again.ok && again.project.layout).toEqual(r.project.layout);
  });
});

describe('setStockSheets and the per-size report (T164)', () => {
  const W = 2800;
  const H = 2070;

  it('stores several sizes, the first becomes the default sheet, grain kept', () => {
    const p = load();
    const grain = p.stock.sheet.grain;
    const r = applyCommand(p, 'setStockSheets', {
      sheets: [
        { width: 1830, height: 3660, qty: 3 },
        { width: W, height: H },
      ],
    });
    if (!r.ok) throw new Error('refused');
    expect(r.project.stock.sheet).toEqual({ width: 1830, height: 3660, grain });
    expect(r.project.stock.sheets).toEqual([
      { width: 1830, height: 3660, qty: 3 },
      { width: W, height: H },
    ]);
  });

  it('one size without qty is the plain single size; duplicates and empty lists are refused', () => {
    const many = applyCommand(load(), 'setStockSheets', {
      sheets: [
        { width: W, height: H },
        { width: 1220, height: 1220 },
      ],
    });
    if (!many.ok) throw new Error('refused');
    const one = applyCommand(many.project, 'setStockSheets', {
      sheets: [{ width: 1220, height: 1220 }],
    });
    if (!one.ok) throw new Error('refused');
    expect(one.project.stock.sheets).toBeUndefined();
    expect(one.project.stock.sheet.width).toBe(1220);
    expect(applyCommand(load(), 'setStockSheets', { sheets: [] }).ok).toBe(false);
    expect(
      applyCommand(load(), 'setStockSheets', {
        sheets: [
          { width: W, height: H },
          { width: W, height: H, qty: 2 },
        ],
      }).ok,
    ).toBe(false);
  });

  it('setSheetSize moves the first listed size; a library material drops the list', () => {
    const many = applyCommand(load(), 'setStockSheets', {
      sheets: [
        { width: W, height: H, qty: 2 },
        { width: 1220, height: 1220 },
      ],
    });
    if (!many.ok) throw new Error('refused');
    const moved = applyCommand(many.project, 'setSheetSize', { width: 1220, height: 1220 });
    if (!moved.ok) throw new Error('refused');
    expect(moved.project.stock.sheets).toEqual([{ width: 1220, height: 1220, qty: 2 }]);
    const lib = applyCommand(many.project, 'applyLibraryMaterial', {
      libraryId: 'x',
      material: 'mdf',
      thickness: 18,
      width: W,
      height: H,
      grain: null,
    });
    if (!lib.ok) throw new Error('refused');
    expect(lib.project.stock.sheets).toBeUndefined();
  });

  it('summarizeLayout reports per size', () => {
    const p = load((j) => {
      j.stock.sheets = [
        { width: j.stock.sheet.width, height: j.stock.sheet.height, qty: 1 },
        { width: 1220, height: 1220 },
      ];
    });
    const r = applyCommand(p, 'runNesting', { toolDiameter: 8 });
    if (!r.ok) throw new Error('not nested');
    const s = summarizeLayout(r.project);
    expect(s.bySize.reduce((n, b) => n + b.sheets, 0)).toBe(s.sheetCount);
    expect(s.bySize.reduce((n, b) => n + b.sheetArea, 0)).toBe(s.sheetArea);
    for (const b of s.bySize) {
      const n = r.project.layout.sheets.filter(
        (sh) => sh.size?.width === b.width && sh.size?.height === b.height,
      ).length;
      expect(b.sheets).toBe(n);
    }
    expect(summarizeLayout(load()).bySize).toHaveLength(load().layout.sheets.length > 0 ? 1 : 0);
  });
});
