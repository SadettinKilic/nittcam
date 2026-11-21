import { describe, expect, it } from 'vitest';
import type { Hole, Project } from '@nittcam/core';
import { boardParts } from '@nittcam/core';
import {
  addHoleParams,
  holeCentre,
  holeCentreSnap,
  holeDefaults,
  holeOnCentre,
  holeRefusal,
  lastHoleNow,
  liveDiameter,
  nextHoleId,
  typedDiameter,
} from './hole-tool';

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

describe('T276: the hole lands where it is clicked', () => {
  // Part A sits at board (1000, 500), 400 × 300; hole h1 at board (1050, 550).
  const parts = () => boardParts(project());

  it('a snap onto the edge does not move a centre clicked inside (hinge cup 22,5 mm in)', () => {
    const at = holeCentre(parts(), { x: 1022.5, y: 600.2 }, { x: 1000, y: 600 }, 4);
    expect(at).toEqual({ partId: 'a', c: { x: 1023, y: 600 } });
  });

  it('a snapped point inside the clicked part with room is kept', () => {
    const at = holeCentre(parts(), { x: 1097, y: 603 }, { x: 1100, y: 600 }, 4);
    expect(at).toEqual({ partId: 'a', c: { x: 1100, y: 600 } });
  });

  it('a click outside every part is no centre', () => {
    expect(holeCentre(parts(), { x: 900, y: 600 }, { x: 900, y: 600 }, 4)).toBeNull();
  });

  it('the same centre twice is found; a typed diameter parses Turkish decimals', () => {
    const [a] = parts();
    expect(holeOnCentre(a, { x: 1050.2, y: 550 })).toBe(0);
    expect(holeOnCentre(a, { x: 1060, y: 550 })).toBeNull();
    expect(typedDiameter('35')).toBe(35);
    expect(typedDiameter('12,5')).toBe(12.5);
    expect(typedDiameter('')).toBeNull();
    expect(typedDiameter('0')).toBeNull();
  });

  it('a refusal names the edge or the cut-out', () => {
    const p = project();
    const edge = addHoleParams(p, { partId: 'a', c: { x: 1010, y: 600 } }, 35, 2);
    expect(edge && holeRefusal(p, edge)).toBe('outside');
    const fine = addHoleParams(p, { partId: 'a', c: { x: 1200, y: 650 } }, 35, 2);
    expect(fine && holeRefusal(p, fine)).toBeNull();
  });
});

describe('holeCentreSnap (B52, D-096)', () => {
  it('snaps onto centres only at a usable zoom', () => {
    expect(holeCentreSnap(0.4)).toBe(false); // whole sheet in view: 10 px = 25 mm
    expect(holeCentreSnap(1.99)).toBe(false);
    expect(holeCentreSnap(2)).toBe(true); // 10 px = 5 mm
    expect(holeCentreSnap(8)).toBe(true);
  });
});

describe('aynı değerlerle devam (B52, D-096)', () => {
  const pocket: Hole = { id: 'h1', type: 'pocket', d: 35, cx: 22.5, cy: 100, depth: 13, tool: 3 };
  it('a new hole copies the last hole type, depth and tool; a misfit copy falls back', () => {
    const r = addHoleParams(project(), { partId: 'a', c: { x: 1100, y: 600 } }, 35, 1, pocket);
    expect(r?.hole).toMatchObject({ type: 'pocket', depth: 13, tool: 3, d: 35 });
    expect(r?.hole.id).not.toBe('h1');
    const groove: Hole = { ...pocket, type: 'groove', grooveWidth: 6 };
    // a 4 mm hole cannot hold a 6 mm groove: plain through hole with the board tool
    const small = addHoleParams(project(), { partId: 'a', c: { x: 1100, y: 600 } }, 4, 1, groove);
    expect(small?.hole).toMatchObject({ type: 'through', d: 4, tool: 1 });
  });
  it('reads the last hole as it is now, else the remembered copy', () => {
    const p = project();
    expect(lastHoleNow(p, null)).toBeUndefined();
    expect(lastHoleNow(p, { partId: 'gone', hole: pocket })).toBe(pocket);
    const part = p.parts.find((x) => x.id === 'a');
    if (part) part.holes = [{ ...pocket, depth: 10 }];
    expect(lastHoleNow(p, { partId: 'a', hole: pocket })).toMatchObject({ depth: 10 });
  });
});
