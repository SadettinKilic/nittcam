import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkPlacement, type Part, type Project } from '@nittcam/core';
import { nextRotation, snapToNeighbours } from './layout-edit';

// T170: R turns a part only through its allowed angles (a fixed-grain part never leaves its
// grain); a dragged part snaps next to its neighbours at exactly the drop check's spacing.

function rect(id: string, w: number, h: number, grain: Part['grain']): Part {
  return {
    id,
    kind: 'rect',
    name: id,
    qty: 1,
    grain,
    params: { w, h, r: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as Part;
}

function project(parts: Part[], grain: number | null, rotation?: string): Project {
  return {
    parts,
    stock: { sheet: { width: 2800, height: 2070, grain } },
    nesting: { margin: 10, gap: 0.5, ...(rotation ? { rotation } : {}) },
    layout: {
      sheets: [
        {
          placements: parts.map((p, i) => ({
            partId: p.id,
            index: 0,
            x: 10 + i * 900,
            y: 10,
            rot: 0,
            locked: false,
          })),
        },
      ],
    },
  } as unknown as Project;
}

describe('nextRotation (T170)', () => {
  it('cycles a free part through the quarter turns', () => {
    const p = project([rect('F', 300, 200, { mode: 'free', angle: 0 })], 0);
    const seen = [0];
    let rot: number | null = 0;
    for (let i = 0; i < 4; i++) {
      rot = nextRotation(p, 'F', rot ?? -1);
      seen.push(rot ?? -1);
    }
    expect(seen).toEqual([0, 90, 180, 270, 0]);
  });

  it('a fixed-grain part only flips 180°, never off-grain', () => {
    const p = project([rect('G', 300, 200, { mode: 'fixed', angle: 0 })], 0);
    expect(nextRotation(p, 'G', 0)).toBe(180);
    expect(nextRotation(p, 'G', 180)).toBe(0);
  });

  it('"none" rotation policy keeps a free part at 0/180; unknown part = null', () => {
    const p = project([rect('F', 300, 200, { mode: 'free', angle: 0 })], null, 'none');
    expect(nextRotation(p, 'F', 0)).toBe(180);
    expect(nextRotation(p, 'nope', 0)).toBeNull();
  });

  it('property: every angle reached is allowed by lockPlacement (on grain)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 179 }), fc.integer({ min: 0, max: 179 }), (g, s) => {
        const p = project([rect('G', 300, 200, { mode: 'fixed', angle: g })], s);
        let rot = (s - g + 360) % 360;
        for (let i = 0; i < 3; i++) {
          rot = nextRotation(p, 'G', rot) ?? -1;
          const along = (((g + rot - s) % 180) + 180) % 180;
          expect(Math.min(along, 180 - along)).toBeLessThan(0.01);
        }
      }),
    );
  });
});

describe('snapToNeighbours (T170)', () => {
  const opts = { spacing: 8.5, tolerance: 6 };
  const other = { x: 100, y: 100, w: 400, h: 300 };

  it('snaps right of a neighbour at exactly the spacing; the other axis stays', () => {
    expect(snapToNeighbours({ w: 200, h: 200 }, 512, 103, [other], opts)).toEqual({
      x: 508.5,
      y: 103,
    });
  });

  it('snaps above a neighbour; the margin lines do not pull', () => {
    expect(snapToNeighbours({ w: 200, h: 200 }, 13, 405, [other], opts)).toEqual({
      x: 13,
      y: 408.5,
    });
  });

  it('keeps the position when nothing is within the tolerance', () => {
    expect(snapToNeighbours({ w: 200, h: 200 }, 1200, 900, [other], opts)).toEqual({
      x: 1200,
      y: 900,
    });
  });

  it('a gap-snapped drop passes the spacing check', () => {
    const parts = [
      rect('A', 400, 300, { mode: 'free', angle: 0 }),
      rect('B', 200, 200, { mode: 'free', angle: 0 }),
    ];
    // thin skin: the stored gap 0.5 counts (D-129 lifts it with tabs)
    const p0 = project(parts, null);
    const p = { ...p0, cutting: { ...p0.cutting, skin: { thickness: 0.5 } } };
    const a = { x: 10, y: 10 }; // first placement of project()
    const snapped = snapToNeighbours(
      { w: 200, h: 200 },
      a.x + 400 + 6,
      a.y + 2,
      [{ x: a.x, y: a.y, w: 400, h: 300 }],
      { spacing: 8 + 0.5, tolerance: 6 },
    );
    expect(snapped.x).toBe(a.x + 408.5);
    const c = checkPlacement(
      p,
      0,
      { partId: 'B', index: 0, ...snapped, rot: 0, locked: true },
      { toolDiameter: 8, trueShape: false },
    );
    expect(c.conflicts).toEqual([]);
    expect(c.inMargin || c.outsideSheet).toBe(false);
  });
});
