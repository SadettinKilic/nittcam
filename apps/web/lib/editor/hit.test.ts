import { boardParts, parseProject } from '@nittcam/core';
import { newProject } from '../draft-project';
import { describe, expect, it } from 'vitest';
import { boxFrom, hitPart, partsInBox } from './hit';

const noBand = { top: 0, right: 0, bottom: 0, left: 0 };
const square = [
  { x: 50, y: 50, bulge: 0 },
  { x: 50, y: 150, bulge: 0 },
  { x: 150, y: 150, bulge: 0 },
  { x: 150, y: 50, bulge: 0 },
];

function board() {
  const base = {
    qty: 1,
    grainLock: false,
    kind: 'rect',
    holes: [],
    edgeBand: noBand,
    templates: [],
  };
  const r = parseProject({
    ...newProject(),
    parts: [
      {
        ...base,
        id: 'a',
        name: 'A',
        params: { w: 400, h: 300, r: 0 },
        inners: [],
        draw: { x: 0, y: 0 },
      },
      {
        ...base,
        id: 'b',
        name: 'B',
        params: { w: 200, h: 200, r: 0 },
        inners: [square],
        draw: { x: 1000, y: 0 },
      },
    ],
  });
  if (!r.ok) throw new Error('invalid test project');
  return boardParts(r.project);
}

describe('board hit testing (T124/T125)', () => {
  it('picks the part under the point, nothing on the empty board', () => {
    const parts = board();
    expect(hitPart(parts, { x: 200, y: 150 }, 1)).toBe('a');
    expect(hitPart(parts, { x: 1010, y: 10 }, 1)).toBe('b');
    expect(hitPart(parts, { x: 700, y: 150 }, 1)).toBeNull();
  });

  it('an edge click within tolerance counts; a cut-out does not', () => {
    const parts = board();
    expect(hitPart(parts, { x: 403, y: 150 }, 5)).toBe('a');
    expect(hitPart(parts, { x: 1100, y: 100 }, 1)).toBeNull();
  });

  it('box selection finds touching parts', () => {
    const parts = board();
    expect(partsInBox(parts, boxFrom({ x: 300, y: 100 }, { x: 1100, y: 50 }))).toEqual(['a', 'b']);
    expect(partsInBox(parts, boxFrom({ x: 500, y: 100 }, { x: 900, y: 50 }))).toEqual([]);
  });
});
