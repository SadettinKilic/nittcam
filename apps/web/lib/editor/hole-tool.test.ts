import { describe, expect, it } from 'vitest';
import type { Hole, Project } from '@nittcam/core';
import { addHoleParams, holeDefaults, liveDiameter, nextHoleId } from './hole-tool';

function project(): Project {
  return {
    schemaVersion: 2,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2070, grain: null },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'a',
        name: 'A',
        qty: 1,
        grain: { mode: 'free', angle: 0 },
        kind: 'rect',
        params: { w: 400, h: 300, r: 0 },
        inners: [],
        holes: [{ id: 'h1', type: 'through', d: 8, cx: 50, cy: 50, tool: 2 }],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
        draw: { x: 1000, y: 500 },
      },
    ],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as Project;
}

describe('hole tool (T138)', () => {
  it('live diameter grows with the cursor, to 0.1 mm, never below the tool', () => {
    expect(liveDiameter({ x: 0, y: 0 }, { x: 3, y: 4 }, 8)).toBe(10);
    expect(liveDiameter({ x: 0, y: 0 }, { x: 1, y: 0 }, 8)).toBe(8);
    expect(liveDiameter({ x: 0, y: 0 }, { x: 17.526, y: 0 }, 8)).toBe(35.1);
  });

  it('next id skips taken ids', () => {
    expect(nextHoleId({ holes: [] })).toBe('h1');
    expect(nextHoleId(project().parts[0] as never)).toBe('h2');
  });

  it('addHole params are in the part frame (board position subtracted)', () => {
    expect(addHoleParams(project(), { partId: 'a', c: { x: 1100.25, y: 600 } }, 35, 1)).toEqual({
      id: 'a',
      hole: { id: 'h2', type: 'through', d: 35, cx: 100.25, cy: 100, tool: 1 },
    });
    expect(addHoleParams(project(), { partId: 'x', c: { x: 0, y: 0 } }, 35, 1)).toBeNull();
  });

  it('type switch defaults stay below the thickness and the diameter', () => {
    const through: Hole = { id: 'h', type: 'through', d: 10, cx: 0, cy: 0, tool: 1 };
    expect(holeDefaults(through, 18, 8)).toEqual({ depth: 9, grooveWidth: 5 });
    expect(holeDefaults(through, 1.2, 8).depth).toBeLessThan(1.2);
    const groove: Hole = { ...through, type: 'groove', depth: 4, grooveWidth: 6, d: 40 };
    expect(holeDefaults(groove, 18, 8)).toEqual({ depth: 4, grooveWidth: 6 });
  });
});
