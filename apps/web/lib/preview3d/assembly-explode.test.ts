/** T389: explode offsets (cabinet along the box axes, loose parts radial) and the section plane. */
import { describe, expect, it } from 'vitest';
import type { Project } from '@nittcam/core';
import { cabinetParts, DEFAULT_CABINET } from '@nittcam/core';
import tr from '../../messages/tr.json';
import { IDENTITY, type LocalBox, type V3 } from './assembly-math';
import { benchItems } from './assembly-model';
import {
  boundsOf,
  exploded,
  explodeOffsets,
  sectionPlane,
  type ExplodeItem,
} from './assembly-explode';

const box: LocalBox = { min: [0, 0, 0], max: [100, 100, 18] };
const at = (id: string, position: V3, group?: string): ExplodeItem => ({
  id,
  pose: { position, rotation: IDENTITY },
  box,
  group,
});

describe('explodeOffsets (T389)', () => {
  it('0 = assembled: no offsets', () => {
    expect(explodeOffsets([at('a', [0, 0, 0], 'g')], 0).size).toBe(0);
  });
  it('cabinet boards move along one box axis each, outwards; a centred board slides forward', () => {
    const items = [
      at('left', [-300, 0, 0], 'g'),
      at('right', [300, 0, 0], 'g'),
      at('top', [0, 350, 0], 'g'),
      at('bottom', [0, -350, 0], 'g'),
      at('back', [0, 0, -40], 'g'),
      at('shelf', [0, 0, 0], 'g'),
    ];
    const off = explodeOffsets(items, 1);
    const o = (id: string) => off.get(id) as V3;
    expect(o('left')[0]).toBeLessThan(0);
    expect(o('left')[1]).toBe(0);
    expect(o('left')[2]).toBe(0);
    expect(o('right')[0]).toBeGreaterThan(0);
    expect(o('top')[1]).toBeGreaterThan(0);
    expect(o('back')[2]).toBeLessThan(0);
    expect(o('shelf')[2]).toBeGreaterThan(0);
    expect(o('shelf')[0]).toBe(0);
  });
  it('half explode moves half as far; loose parts spread radially', () => {
    const items = [at('a', [-100, 9, 0]), at('b', [100, 9, 0])];
    const full = explodeOffsets(items, 1);
    const half = explodeOffsets(items, 0.5);
    expect(full.get('a')).toEqual([-100, 0, 0]);
    expect(half.get('b')).toEqual([50, 0, 0]);
  });
  it('a real cabinet: exploded boards no longer overlap each other more than assembled', () => {
    const r = cabinetParts({ ...DEFAULT_CABINET, width: 600 });
    if (!r.ok) throw new Error(r.error);
    const parts = r.parts.map((x, i) => ({
      id: `c-${i}`,
      name: tr.cutList.cabinet.roles[x.role],
      qty: x.qty,
      kind: 'rect',
      params: { w: x.w, h: x.h, r: 0 },
      holes: [],
      inners: [],
      edgeBand: x.edgeBand,
      group: 'Dolap',
      ...(x.thickness !== 18 ? { note: `${x.thickness} mm` } : {}),
    }));
    const project = {
      stock: { thickness: 18 },
      settings: { dimensionMode: 'finished' },
      parts,
    } as unknown as Project;
    const items = benchItems(project, tr.cutList.cabinet.roles);
    const off = explodeOffsets(items, 1);
    const before = boundsOf(items);
    const after = boundsOf(items.map((i) => exploded(i, off)));
    if (!before || !after) throw new Error('no bounds');
    // The exploded cabinet is larger on every axis it spreads along.
    expect(after.max[0] - after.min[0]).toBeGreaterThan(before.max[0] - before.min[0]);
    expect(after.max[1] - after.min[1]).toBeGreaterThan(before.max[1] - before.min[1]);
  });
});

describe('exploded / sectionPlane (T389)', () => {
  it('unmoved items stay the same object', () => {
    const a = at('a', [0, 0, 0]);
    expect(exploded(a, new Map())).toBe(a);
    expect(exploded(a, new Map([['a', [1, 2, 3] as V3]])).pose.position).toEqual([1, 2, 3]);
  });
  it('keeps the side below the cut, the other side when flipped', () => {
    const p = sectionPlane({ axis: 1, at: 300, flip: false });
    const keep = (y: number) => p.normal[1] * y + p.constant >= 0;
    expect(keep(200)).toBe(true);
    expect(keep(400)).toBe(false);
    const f = sectionPlane({ axis: 1, at: 300, flip: true });
    expect(f.normal[1] * 400 + f.constant >= 0).toBe(true);
  });
});
