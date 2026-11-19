import { boardParts, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { innerHost, shapeVertices } from './inner-host';

const part = (id: string, w: number, h: number, x: number, y: number) => ({
  id,
  name: id,
  qty: 1,
  grain: { mode: 'free' as const, angle: 0 },
  kind: 'rect' as const,
  params: { w, h, r: 0 },
  inners: [],
  holes: [],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  templates: [],
  draw: { x, y },
});

const parts = boardParts({
  parts: [part('a', 400, 300, 0, 0), part('b', 200, 200, 1000, 0)],
} as unknown as Project);

describe('innerHost (T134)', () => {
  it('a rectangle drawn inside part a belongs to a; one across the edge or outside to none', () => {
    const inside = shapeVertices({
      at: { x: 50, y: 50 },
      shape: { kind: 'rect', params: { w: 100, h: 80, r: 0 } },
    });
    expect(innerHost(parts, inside)).toBe('a');
    const across = shapeVertices({
      at: { x: 350, y: 50 },
      shape: { kind: 'rect', params: { w: 100, h: 80, r: 0 } },
    });
    expect(innerHost(parts, across)).toBeNull();
    const away = shapeVertices({
      at: { x: 600, y: 50 },
      shape: { kind: 'rect', params: { w: 100, h: 80, r: 0 } },
    });
    expect(innerHost(parts, away)).toBeNull();
  });

  it('an outline shape (circle) inside part b, in board mm', () => {
    const circle = shapeVertices({
      at: { x: 1050, y: 50 },
      shape: {
        kind: 'outline',
        vertices: [
          { x: 0, y: 50, bulge: 1 },
          { x: 100, y: 50, bulge: 1 },
        ],
      },
    });
    expect(circle[0]).toEqual({ x: 1050, y: 100, bulge: 1 });
    expect(innerHost(parts, circle)).toBe('b');
  });
});
