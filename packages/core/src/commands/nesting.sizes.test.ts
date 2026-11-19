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
