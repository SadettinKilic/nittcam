/** T391: the bench "Katla" state applied to the items (view state; poses untouched). */
import { traitsOf, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import tr from '../../messages/tr.json';
import { benchItems } from './assembly-model';
import { applyFold, foldKey, foldToolOf, NO_FOLD } from './bench-fold';
import { fitRequest } from './fit-check-input';

const roles = tr.cutList.cabinet.roles;
const traits = traitsOf('acm').vGroove;
const v = (x: number, y: number) => ({ x, y, bulge: 0 });

function project(): Project {
  return {
    stock: { material: 'acm', thickness: 4, machinedFace: 'back' },
    settings: { dimensionMode: 'finished' },
    parts: [
      {
        id: 'tray',
        name: 'Tava',
        qty: 2,
        kind: 'rect',
        params: { w: 200, h: 100, r: 0 },
        holes: [{ type: 'through', cx: 100, cy: 60, d: 6 }],
        inners: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        lines: [{ vertices: [v(0, 30), v(200, 30)], op: { kind: 'vgroove' } }],
      },
      {
        id: 'plain',
        name: 'Düz',
        qty: 1,
        kind: 'rect',
        params: { w: 100, h: 100, r: 0 },
        holes: [],
        inners: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    ],
  } as unknown as Project;
}

const tool = foldToolOf(project(), {
  traits,
  tool: {
    number: 3,
    type: 'vBit',
    diameter: 12,
    fluteLength: 10,
    flutes: 2,
    angleDeg: 90,
    tipDiameter: 0.2,
  },
});

describe('bench fold (T391)', () => {
  it('flat: the items come back as they are, the foldable part is listed', () => {
    const items = benchItems(project(), roles);
    const r = applyFold(items, tool, NO_FOLD);
    expect(r.items.every((it, i) => it === items[i])).toBe(true);
    expect(r.parts.map((p) => p.partId)).toEqual(['tray']);
    expect(r.parts[0]?.angles).toEqual([0]);
  });

  it('not ACM (no traits): nothing folds', () => {
    const items = benchItems(project(), roles);
    expect(applyFold(items, { ...tool, traits: null }, { ...NO_FOLD, pct: 100 }).parts).toEqual([]);
  });

  it('folded: both copies get the folded mesh and box, poses stay, fit check gets the fold key', () => {
    const items = benchItems(project(), roles);
    const r = applyFold(items, tool, { ...NO_FOLD, pct: 50 });
    expect(r.parts[0]?.angles).toEqual([45]);
    const copies = r.items.filter((it) => it.partId === 'tray');
    expect(copies).toHaveLength(2);
    for (const c of copies) {
      expect(c.fold?.key).toMatch(/^fold:tray:/);
      expect(c.mesh).toBe(copies[0]?.mesh);
      expect(c.pose).toEqual(items.find((i) => i.id === c.id)?.pose);
      expect(c.box.min[2]).toBeLessThan(0);
      // The base hole stays in the hole check.
      expect(c.fold?.holes).toHaveLength(1);
    }
    expect(r.items.find((i) => i.partId === 'plain')?.fold).toBeUndefined();
    const req = fitRequest(1, r.items);
    expect(req.meshKeys[0]).toBe(copies[0]?.fold?.key);
    expect(req.parts[0]?.boxy).toBe(false);
  });

  it('a per-groove angle wins over the slider; the target scales the slider', () => {
    const items = benchItems(project(), roles);
    const key = foldKey('tray', 'line-0');
    expect(
      applyFold(items, tool, { pct: 100, deg: { [key]: 30 }, target: {} }).parts[0]?.angles,
    ).toEqual([30]);
    const t = applyFold(items, tool, { pct: 50, deg: {}, target: { [key]: 120 } }).parts[0];
    expect(t?.angles).toEqual([60]);
    expect(t?.bends[0]?.overFold).toBe(true);
  });

  it('a part whose only groove is curved is still listed (no hinges, skipped note)', () => {
    const p = project();
    const tray = p.parts[0] as unknown as { lines: unknown[] };
    tray.lines = [{ vertices: [{ x: 0, y: 30, bulge: 0.4 }, v(200, 30)], op: { kind: 'vgroove' } }];
    const r = applyFold(benchItems(p, roles), tool, { ...NO_FOLD, pct: 100 });
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]?.plan.hinges).toEqual([]);
    expect(r.parts[0]?.plan.skipped).toBe(1);
    expect(r.items.every((it) => it.fold === undefined)).toBe(true);
  });
});

describe('T427: the fold verdict is at the designed angles', () => {
  // 250 × 250 blank, 25 mm flanges, square reliefs only up to the groove crossing (the CTO #15 S5
  // tray): its 4 mm flanges collide once folded.
  const clashing = (): Project =>
    ({
      stock: { material: 'acm', thickness: 4, machinedFace: 'back' },
      settings: { dimensionMode: 'finished' },
      parts: [
        {
          id: 'tray',
          name: 'Tepsi',
          qty: 1,
          kind: 'freeform',
          grain: { mode: 'free', angle: 0 },
          outline: [
            v(25, 0),
            v(225, 0),
            v(225, 25),
            v(250, 25),
            v(250, 225),
            v(225, 225),
            v(225, 250),
            v(25, 250),
            v(25, 225),
            v(0, 225),
            v(0, 25),
            v(25, 25),
          ],
          holes: [],
          inners: [],
          lines: [
            [
              [25, 25],
              [225, 25],
            ],
            [
              [225, 25],
              [225, 225],
            ],
            [
              [225, 225],
              [25, 225],
            ],
            [
              [25, 225],
              [25, 25],
            ],
          ].map(([a, b]) => ({
            vertices: [v(...(a as [number, number])), v(...(b as [number, number]))],
            op: { kind: 'vgroove' },
          })),
        },
      ],
    }) as unknown as Project;

  it('flat (0 %): the verdict already says clash, but nothing is tinted red yet', () => {
    const r = applyFold(benchItems(clashing(), roles), tool, NO_FOLD);
    const part = r.parts[0];
    expect(part?.angles).toEqual([0, 0, 0, 0]);
    expect(part?.check.state).toBe('clash');
    expect(part?.check.issues.some((i) => i.kind === 'overlap')).toBe(true);
    expect(part?.clashNow).toBe(false);
  });

  it('folded (100 %): the same verdict, and the part is red now', () => {
    const r = applyFold(benchItems(clashing(), roles), tool, { ...NO_FOLD, pct: 100 });
    expect(r.parts[0]?.check.state).toBe('clash');
    expect(r.parts[0]?.clashNow).toBe(true);
  });

  it('the overlap text names the fix', () => {
    expect(tr.bench.fold.issues.overlap).toContain('kısaltın');
    expect(tr.bench.fold.states.closed).not.toBe('Kapanıyor');
  });
});
