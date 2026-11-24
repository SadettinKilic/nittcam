import type { Part } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { partMachining } from './part-machining';

const rect: Part = {
  id: 'p1',
  name: 'Yan',
  kind: 'rect',
  params: { w: 400, h: 300, r: 0 },
  qty: 1,
  grain: 'none',
  inners: [],
  holes: [],
  edgeBand: { top: 0, bottom: 0, left: 0, right: 0 },
  templates: [],
} as unknown as Part;

describe('partMachining (B53)', () => {
  it('a plain rectangle has none', () => {
    expect(partMachining(rect)).toEqual([]);
  });

  it('lists inner cuts, holes, templates and lines in order, skipping zeros', () => {
    const part = {
      ...rect,
      inners: [{}, {}],
      holes: [{}],
      templates: [],
      lines: [{}, {}, {}],
    } as unknown as Part;
    expect(partMachining(part)).toEqual([
      { kind: 'inners', count: 2 },
      { kind: 'holes', count: 1 },
      { kind: 'lines', count: 3 },
    ]);
  });

  it('a freeform outline comes first', () => {
    const part = { ...rect, kind: 'freeform', outline: [], templates: [{}] } as unknown as Part;
    expect(partMachining(part)).toEqual([
      { kind: 'shape', count: 1 },
      { kind: 'templates', count: 1 },
    ]);
  });
});
