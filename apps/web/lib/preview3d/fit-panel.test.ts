/** T388: bench items → fit request (box or mesh test) and issues → panel rows. */
import { describe, expect, it } from 'vitest';
import type { Project } from '@nittcam/core';
import tr from '../../messages/tr.json';
import { benchItems } from './assembly-model';
import { fitRequest } from './fit-check-input';
import type { FitIssue } from './fit-check';
import { fitRows } from '../../components/assembly/fit-panel';

const rect = (id: string, w: number, h: number, qty = 1, holes: unknown[] = []) => ({
  id,
  name: id,
  qty,
  kind: 'rect',
  params: { w, h, r: 0 },
  holes,
  inners: [],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
});
const L = {
  ...rect('L', 0, 0),
  kind: 'freeform',
  params: undefined,
  outline: [
    { x: 0, y: 0, bulge: 0 },
    { x: 200, y: 0, bulge: 0 },
    { x: 200, y: 80, bulge: 0 },
    { x: 80, y: 80, bulge: 0 },
    { x: 80, y: 160, bulge: 0 },
    { x: 0, y: 160, bulge: 0 },
  ],
};
const project = {
  stock: { thickness: 18 },
  settings: { dimensionMode: 'finished' },
  parts: [
    rect('A', 500, 400, 2, [
      { id: 'h1', type: 'pocket', d: 8, cx: 50, cy: 50, depth: 12, tool: 1 },
      { id: 'h2', type: 'through', d: 5, cx: 100, cy: 50, tool: 1 },
    ]),
    L,
  ],
} as unknown as Project;
const items = benchItems(project, tr.cutList.cabinet.roles);
const byId = new Map(items.map((i) => [i.id, i]));

describe('fitRequest (T388)', () => {
  it('rectangles use the box test, an L sends its mesh once; holes keep type', () => {
    const r = fitRequest(7, items);
    expect(r.id).toBe(7);
    expect(r.parts.map((p) => p.boxy)).toEqual([true, true, false]);
    expect(r.meshKeys[0]).toBeNull();
    expect(typeof r.meshKeys[2]).toBe('string');
    expect(Object.keys(r.meshes)).toHaveLength(1);
    expect(r.parts[0]?.holes).toEqual([
      { cx: 50, cy: 50, d: 8, through: false },
      { cx: 100, cy: 50, d: 5, through: true },
    ]);
  });
});

describe('fitRows (T388)', () => {
  const [a0, a1, l] = items.map((i) => i.id) as [string, string, string];
  it('labels copies, groups aligned holes per pair, Turkish decimals', () => {
    const issues: FitIssue[] = [
      { kind: 'overlap', a: a0, b: l, depth: 2 },
      { kind: 'hole', a: a0, b: a1, offset: 1.5, ok: false, at: [0, 0, 0] },
      { kind: 'gap', a: a1, b: l, gap: 0.6 },
      { kind: 'hole', a: a0, b: a1, offset: 0, ok: true, at: [0, 0, 0] },
      { kind: 'hole', a: a0, b: a1, offset: 0.1, ok: true, at: [0, 0, 0] },
    ];
    const rows = fitRows(issues, byId, tr.bench);
    expect(rows.map((r) => [r.kind, r.tone, r.text])).toEqual([
      ['overlap', 'danger', 'A (1. adet) ↔ L: 2 mm çakışıyor'],
      ['hole', 'warning', 'A (1. adet) ↔ A (2. adet): delik 1,5 mm kayık'],
      ['gap', 'muted', 'A (2. adet) ↔ L: boşluk 0,6 mm'],
      ['holeOk', 'success', 'A (1. adet) ↔ A (2. adet): 2 delik hizalı'],
    ]);
  });
});
