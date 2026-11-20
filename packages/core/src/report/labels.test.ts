import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LABEL_PAGE,
  LABEL_PRESET_IDS,
  LABEL_PRESETS,
  labelCells,
  labelGridSchema,
  partLabels,
} from './labels';
import { nestedShelfSet } from './report.testing';

describe('label presets (T174)', () => {
  it.each(LABEL_PRESET_IDS)('%s is a valid grid that fits on A4', (id) => {
    expect(labelGridSchema.safeParse(LABEL_PRESETS[id]).success).toBe(true);
  });

  it('3 × 8 has 24 cells of 70 × 37 mm, 2 × 7 has 14', () => {
    expect(labelCells(LABEL_PRESETS['a4-3x8'])).toHaveLength(24);
    expect(labelCells(LABEL_PRESETS['a4-2x7'])).toHaveLength(14);
    expect(labelCells(LABEL_PRESETS['a4-3x8'])[4]).toEqual({
      x: 70,
      y: 37.5,
      width: 70,
      height: 37,
    });
  });

  it('the print offset moves every cell', () => {
    const base = labelCells(LABEL_PRESETS['a4-2x7']);
    const moved = labelCells(LABEL_PRESETS['a4-2x7'], { x: 1.5, y: -2 });
    moved.forEach((c, i) => {
      expect(c.x - (base[i]?.x ?? 0)).toBeCloseTo(1.5);
      expect(c.y - (base[i]?.y ?? 0)).toBeCloseTo(-2);
    });
  });

  it('refuses a custom grid that does not fit on A4', () => {
    const wide = { ...LABEL_PRESETS['a4-3x8'], cols: 4 };
    expect(labelGridSchema.safeParse(wide).success).toBe(false);
    const tall = { ...LABEL_PRESETS['a4-3x8'], rows: 9 };
    expect(labelGridSchema.safeParse(tall).success).toBe(false);
  });

  it('every accepted custom grid stays on the page', () => {
    fc.assert(
      fc.property(
        fc.record({
          cols: fc.integer({ min: 1, max: 10 }),
          rows: fc.integer({ min: 1, max: 30 }),
          width: fc.double({ min: 15, max: 210, noNaN: true }),
          height: fc.double({ min: 10, max: 297, noNaN: true }),
          left: fc.double({ min: 0, max: 100, noNaN: true }),
          top: fc.double({ min: 0, max: 100, noNaN: true }),
          gapX: fc.double({ min: 0, max: 50, noNaN: true }),
          gapY: fc.double({ min: 0, max: 50, noNaN: true }),
        }),
        (g) => {
          if (!labelGridSchema.safeParse(g).success) return;
          for (const c of labelCells(g)) {
            expect(c.x + c.width).toBeLessThanOrEqual(LABEL_PAGE.width + 0.011);
            expect(c.y + c.height).toBeLessThanOrEqual(LABEL_PAGE.height + 0.011);
          }
        },
      ),
    );
  });
});

describe('partLabels (T174)', () => {
  const project = nestedShelfSet();
  const labels = partLabels(project);

  it('makes one label per piece', () => {
    expect(labels).toHaveLength(project.parts.reduce((s, p) => s + p.qty, 0));
    expect(new Set(labels.map((l) => l.number)).size).toBe(labels.length);
  });

  it('orders by sheet, then part number; carries the sheet number', () => {
    const keys = labels.map((l) => l.sheet ?? 99);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
    for (const l of labels) {
      const [row, copy] = l.number.split('.').map(Number);
      const part = project.parts[(row ?? 0) - 1];
      const s = project.layout.sheets.findIndex((sh) =>
        sh.placements.some((p) => p.partId === part?.id && p.index === (copy ?? 0) - 1),
      );
      expect(l.sheet).toBe(s + 1);
    }
  });

  it('puts unplaced copies last with no sheet', () => {
    const none = partLabels({ ...project, layout: { sheets: [] } });
    expect(none).toHaveLength(labels.length);
    expect(none.every((l) => l.sheet === null)).toBe(true);
    expect(none.map((l) => l.number).slice(0, 3)).toEqual(['1.1', '1.2', '2.1']);
  });

  it('carries the banded edges and grain', () => {
    const side = labels.find((l) => l.partId === 'side');
    expect(side?.bandedEdges).toEqual(['top', 'right']);
    expect(side?.grain).not.toBeNull();
    expect(labels.find((l) => l.partId === 'top')?.grain).toBeNull();
  });
});
