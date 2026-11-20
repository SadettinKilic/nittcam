import { projectReport, type Part } from '@nittcam/core';
import type { ProjectRow } from '@nittcam/db';
import { describe, expect, it } from 'vitest';
import { newProject } from '../draft-project';
import { summaryOf } from '../report-summary';
import { layoutSummary } from './report';

function rect(id: string, w: number, h: number, qty = 1): Part {
  return {
    id,
    name: id,
    qty,
    grain: { mode: 'free', angle: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
    kind: 'rect',
    params: { w, h, r: 0 },
  };
}

describe('layoutSummary (T180, D-070)', () => {
  it('equals the PDF report numbers without a cut time', () => {
    const data = newProject();
    data.parts = [rect('a', 600, 400, 2)];
    data.layout = {
      sheets: [
        {
          placements: [
            { partId: 'a', index: 0, x: 10, y: 10, rot: 0, locked: false },
            { partId: 'a', index: 1, x: 700, y: 10, rot: 0, locked: false },
          ],
        },
      ],
    };
    const s = layoutSummary({ data, revision: 4 } as Pick<ProjectRow, 'data' | 'revision'>);
    expect(s).toEqual(summaryOf(projectReport(data), 4));
    expect(s.cutSeconds).toBeNull();
    expect(s.sheetCount).toBe(1);
    expect(s.wastePercent).toBeGreaterThan(0);
  });
});
