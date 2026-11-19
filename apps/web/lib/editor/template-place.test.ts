/** T148: ghost placement snapping (edges, corners, free) and the ghost geometry. */
import type { TemplatePlacement } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import {
  addTemplateParams,
  placementAlong,
  snapPlacement,
  startPlacement,
  templateGhost,
} from './template-place';

const box = { minX: 0, minY: 0, maxX: 400, maxY: 700 };
const free: TemplatePlacement = { x: 0, y: 0, rot: 0, mirror: false, edge: null };
const item = {
  id: 'tpl',
  name: 'Menteşe',
  version: 3,
  geometry: {
    holes: [{ id: 'h1', type: 'pocket' as const, d: 35, cx: 0, cy: 0, depth: 13, tool: 2 }],
    inners: [],
  },
  params: { count: 2, spacing: 500, edgeDistance: 22.5, d: {} },
};

describe('snapPlacement (T148)', () => {
  it('anchors to the nearest edge within the tolerance, with the edge rotation', () => {
    expect(snapPlacement({ x: 5, y: 300 }, box, free, 22.5, 10)).toEqual({
      x: 5,
      y: 300,
      rot: 0,
      mirror: false,
      edge: 'left',
    });
    expect(
      snapPlacement({ x: 396, y: 300 }, box, { ...free, mirror: true }, 22.5, 10),
    ).toMatchObject({
      edge: 'right',
      rot: 180,
      mirror: true,
    });
    expect(snapPlacement({ x: 200, y: 698 }, box, free, 22.5, 10)).toMatchObject({
      edge: 'top',
      rot: 270,
      x: 200,
    });
  });

  it('near a corner the along-edge coordinate snaps to the edge distance from the corner', () => {
    const pl = snapPlacement({ x: 3, y: 6 }, box, free, 22.5, 10);
    expect(pl.edge).toBe('left');
    expect(placementAlong(pl)).toBe(22.5);
  });

  it('elsewhere (or outside the part) the ghost follows the cursor freely', () => {
    expect(snapPlacement({ x: 200, y: 300 }, box, free, 22.5, 10)).toEqual({
      ...free,
      x: 200,
      y: 300,
    });
    expect(snapPlacement({ x: -5, y: 300 }, box, free, 22.5, 10).edge).toBeNull();
  });
});

describe('ghost and start (T148)', () => {
  it('starts on the left edge, centred; the ghost is in board mm', () => {
    const p = startPlacement('door', item, box);
    expect(p.placement).toEqual({ x: 22.5, y: 350, rot: 0, mirror: false, edge: 'left' });
    const g = templateGhost(p, box, { x: 1000, y: 0 });
    expect(g.circles).toEqual([
      { x: 1022.5, y: 100, r: 17.5 },
      { x: 1022.5, y: 600, r: 17.5 },
    ]);
    expect(addTemplateParams(p)).toMatchObject({ id: 'door', template: { version: 3 } });
  });
});
