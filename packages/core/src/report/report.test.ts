import { describe, expect, it } from 'vitest';
import { summarizeLayout } from '../nesting';
import { projectReport } from './report';
import { nestedShelfSet } from './report.testing';

describe('projectReport (T173)', () => {
  const project = nestedShelfSet();
  const report = projectReport(project, 754);

  it('lists every cut-list row with qty, placed copies and banded edges', () => {
    expect(report.parts.map((p) => [p.row, p.partId, p.qty, p.placed])).toEqual([
      [1, 'side', 2, 2],
      [2, 'shelf', 5, 5],
      [3, 'top', 1, 1],
    ]);
    expect(report.parts[0]?.bandedEdges).toEqual(['top', 'right']);
    expect(report.parts[2]?.bandedEdges).toEqual(['right', 'bottom', 'left']);
    expect(report.totalPieces).toBe(8);
    expect(report.unplaced).toBe(0);
  });

  it('marks all four edges when all are banded', () => {
    const all = nestedShelfSet((p) => {
      const parts = p['parts'] as { edgeBand: unknown }[];
      if (parts[0]) parts[0].edgeBand = { top: 1, right: 1, bottom: 1, left: 1 };
    });
    expect(projectReport(all).parts[0]?.bandedEdges).toEqual(['top', 'right', 'bottom', 'left']);
  });

  it('cut mode: cut = entered, finished = cut + bands', () => {
    const side = report.parts[0];
    expect(side?.cut).toEqual({ w: 300, h: 1800 });
    expect(side?.finished).toEqual({ w: 302, h: 1800.8 });
  });

  it('finished mode: finished = entered, cut = entered − bands', () => {
    const fin = projectReport(
      nestedShelfSet((p) => {
        p['settings'] = { dimensionMode: 'finished' };
      }),
    );
    expect(fin.parts[0]?.finished).toEqual({ w: 300, h: 1800 });
    expect(fin.parts[0]?.cut).toEqual({ w: 298, h: 1799.2 });
  });

  it('waste numbers equal the layout summary', () => {
    const s = summarizeLayout(project);
    expect(report.sheetCount).toBe(s.sheetCount);
    expect(report.wastePercent).toBe(s.wastePercent);
    expect(report.sheetAreaM2).toBeCloseTo(s.sheetArea / 1e6, 9);
    expect(report.wasteAreaM2).toBeCloseTo((s.sheetArea - s.partArea) / 1e6, 9);
    expect(report.partAreaM2 + report.wasteAreaM2).toBeCloseTo(report.sheetAreaM2, 9);
    expect(report.bySize).toHaveLength(1);
  });

  it('keeps the given cut time (null = not available)', () => {
    expect(report.cutSeconds).toBe(754);
    expect(projectReport(project).cutSeconds).toBeNull();
  });

  it('counts unplaced copies', () => {
    const none = { ...project, layout: { sheets: [] } };
    const r = projectReport(none);
    expect(r.unplaced).toBe(8);
    expect(r.sheetCount).toBe(0);
    expect(r.parts.every((p) => p.placed === 0)).toBe(true);
  });
});
