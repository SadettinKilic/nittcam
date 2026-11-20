import { describe, expect, it } from 'vitest';
import { fitSheet, flattenRing, layoutDrawing } from './drawing';
import { nestedShelfSet } from './report.testing';

describe('layoutDrawing (T172)', () => {
  const project = nestedShelfSet();
  const drawing = layoutDrawing(project);

  it('has one drawing per layout sheet with its size and grain', () => {
    expect(drawing).toHaveLength(project.layout.sheets.length);
    expect(drawing[0]).toMatchObject({
      sheet: 0,
      width: 2800,
      height: 2070,
      grain: 90,
      offcut: false,
    });
  });

  it('draws every placed copy once, numbered row.copy and sorted', () => {
    const numbers = drawing.flatMap((s) => s.parts.map((p) => p.number));
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.filter((n) => n.startsWith('2.'))).toEqual(['2.1', '2.2', '2.3', '2.4', '2.5']);
    for (const s of drawing) {
      const keys = s.parts.map((p) => p.number.split('.').map(Number));
      const sorted = [...keys].sort(
        (a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0),
      );
      expect(keys).toEqual(sorted);
    }
  });

  it('keeps every outline inside its footprint and on the sheet', () => {
    for (const s of drawing) {
      for (const p of s.parts) {
        for (let i = 0; i < p.outline.length; i += 2) {
          const x = p.outline[i] ?? NaN;
          const y = p.outline[i + 1] ?? NaN;
          expect(x).toBeGreaterThanOrEqual(p.box.x - 1e-6);
          expect(x).toBeLessThanOrEqual(p.box.x + p.box.w + 1e-6);
          expect(y).toBeGreaterThanOrEqual(p.box.y - 1e-6);
          expect(y).toBeLessThanOrEqual(p.box.y + p.box.h + 1e-6);
          expect(x).toBeLessThanOrEqual(s.width);
          expect(y).toBeLessThanOrEqual(s.height);
        }
      }
    }
  });

  it('turns the grain with the placement and leaves free grain null', () => {
    const modes = new Set<string>();
    for (const s of drawing) {
      for (const p of s.parts) {
        const part = project.parts.find((x) => x.id === p.partId);
        if (!part) throw new Error(p.partId);
        modes.add(part.grain.mode);
        if (part.grain.mode === 'free') expect(p.grainAngle).toBeNull();
        else expect(p.grainAngle).not.toBeNull();
      }
    }
    expect(modes).toEqual(new Set(['free', 'fixed']));
  });

  it('reads cut sizes in finished mode (edge band deducted)', () => {
    const finished = nestedShelfSet((p) => {
      p['settings'] = { dimensionMode: 'finished' };
    });
    const side = layoutDrawing(finished)
      .flatMap((s) => s.parts)
      .find((p) => p.partId === 'side');
    expect(side?.width).toBe(298);
    expect(side?.height).toBeCloseTo(1799.2);
  });

  it('is deterministic', () => {
    expect(layoutDrawing(nestedShelfSet())).toEqual(drawing);
  });
});

describe('flattenRing', () => {
  it('samples arcs and keeps straight vertices', () => {
    const ring = flattenRing(
      {
        closed: true,
        vertices: [
          { x: 0, y: 0, bulge: 1 },
          { x: 10, y: 0, bulge: 1 },
        ],
      },
      4,
    );
    expect(ring).toHaveLength(16);
  });
});

describe('fitSheet', () => {
  it('fits and centres with one uniform scale', () => {
    const f = fitSheet({ width: 2000, height: 1000 }, { x: 10, y: 20, width: 400, height: 400 });
    expect(f.scale).toBe(0.2);
    expect(f).toMatchObject({ x: 10, y: 120 });
  });
});
