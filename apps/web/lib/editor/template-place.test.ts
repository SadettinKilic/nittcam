/** T148: ghost placement snapping (edges, corners, free) and the ghost geometry. */
import type { TemplatePlacement } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import {
  addTemplateParams,
  placementAlong,
  snapPlacement,
  startPlacement,
  templateGhost,
  withHoleTools,
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

  it('starts a ready handle on the edge opposite the hinges (T286)', () => {
    const handle = {
      ...item,
      id: 'ready-handle-128',
      params: { ...item.params, edgeDistance: 30 },
    };
    const hinge = (edge: 'left' | 'right') => ({
      templateId: 'ready-hinge-35-2',
      placement: { edge },
    });
    expect(startPlacement('door', handle, box, [hinge('left')]).placement).toEqual({
      x: 370,
      y: 350,
      rot: 180,
      mirror: false,
      edge: 'right',
    });
    expect(startPlacement('door', handle, box, [hinge('right')]).placement.edge).toBe('left');
    expect(startPlacement('door', handle, box).placement.edge).toBe('left');
  });
});

describe('template hole tools (T320)', () => {
  const tools = [
    { number: 1, type: 'flatEndMill', diameter: 6 },
    { number: 3, type: 'drill', diameter: 5 },
    { number: 4, type: 'drill', diameter: 35 },
  ];
  it('a Ø35 cup takes the Ø35 drill; without one a mill that suits', () => {
    const p = startPlacement('a', item, box, [], tools);
    expect(p.geometry.holes[0]?.tool).toBe(4);
    // The template's T2 is not on this machine: the widest mill that suits (T1).
    expect(startPlacement('a', item, box, [], tools.slice(0, 2)).geometry.holes[0]?.tool).toBe(1);
  });
  it('a Ø5 handle hole (params override) takes the Ø5 drill, not T1', () => {
    const handle = {
      ...item,
      geometry: {
        holes: [{ id: 's', type: 'through' as const, d: 6, cx: 0, cy: 0, tool: 1 }],
        inners: [],
      },
      params: { ...item.params, d: { s: 5 } },
    };
    expect(withHoleTools(handle.geometry, handle.params, tools).holes[0]?.tool).toBe(3);
  });
  it('without tools the geometry is unchanged', () => {
    expect(startPlacement('a', item, box).geometry).toBe(item.geometry);
  });
});
