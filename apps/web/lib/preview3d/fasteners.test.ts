/** T390: fastener markers through aligned holes (kind, diameter, standard length, stacks). */
import { applyCommand, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { newProject } from '../draft-project';
import { getMessages } from '../messages';
import { benchItems, FLAT } from './assembly-model';
import { fastenerRows, fastenersOf, standardLength } from './fasteners';

const roles = getMessages().cutList.cabinet.roles;
const at = '2026-11-28T10:00:00Z';

function run(p: Project, name: string, params: unknown): Project {
  const r = applyCommand(p, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

/**
 * A 300 × 200 panel lying flat (centre x 150, z 0) and a 60 × 40 bracket on top of it, the
 * bracket's centre hole over the panel hole at local (50, 50) → world x 50, z 50.
 */
function stack(opts: {
  panelHole?: 'through' | 'pocket';
  bracket?: 'aluminium' | null;
  panel?: 'acm' | null;
  dx?: number;
}): Project {
  let p = newProject();
  p = run(p, 'addPart', { id: 'panel', name: 'Panel', params: { w: 300, h: 200, r: 0 }, qty: 1 });
  p = run(p, 'addPart', { id: 'br', name: 'Braket', params: { w: 60, h: 40, r: 0 }, qty: 1 });
  const hole = opts.panelHole ?? 'through';
  p = run(p, 'addHole', {
    id: 'panel',
    hole:
      hole === 'through'
        ? { id: 'h1', type: 'through', tool: 1, d: 5, cx: 50, cy: 50 }
        : { id: 'h1', type: 'pocket', tool: 1, d: 5, cx: 50, cy: 50, depth: 12 },
  });
  p = run(p, 'addHole', {
    id: 'br',
    hole: { id: 'h2', type: 'through', tool: 1, d: 4, cx: 30, cy: 20 },
  });
  if (opts.bracket)
    p = run(p, 'setAssemblyPartLook', {
      partId: 'br',
      material: opts.bracket,
      thickness: 3,
      updatedAt: at,
    });
  if (opts.panel)
    p = run(p, 'setAssemblyPartLook', {
      partId: 'panel',
      material: opts.panel,
      thickness: 4,
      updatedAt: at,
    });
  const t = opts.panel ? 4 : p.stock.thickness;
  const tb = opts.bracket ? 3 : p.stock.thickness;
  return run(p, 'setAssemblyInstances', {
    instances: [
      {
        id: 'panel#0',
        partId: 'panel',
        copy: 0,
        position: [150, t / 2, 0],
        rotation: FLAT,
        hidden: false,
      },
      {
        id: 'br#0',
        partId: 'br',
        copy: 0,
        position: [50 + (opts.dx ?? 0), t + tb / 2, 50],
        rotation: FLAT,
        hidden: false,
      },
    ],
    updatedAt: at,
  });
}

describe('fastenersOf (T390)', () => {
  it('aluminium bracket on a wood panel: one screw Ø4 through both, spanning the stack', () => {
    const p = stack({ bracket: 'aluminium' });
    const items = benchItems(p, roles);
    expect(items.find((i) => i.id === 'br#0')?.look).toBe('aluminium');
    expect(items.find((i) => i.id === 'br#0')?.thickness).toBe(3);
    const [f, ...rest] = fastenersOf(items);
    expect(rest).toHaveLength(0);
    expect(f?.kind).toBe('screw');
    expect(f?.d).toBe(4);
    expect(f?.length).toBe(standardLength('screw', p.stock.thickness + 3, 4, true));
    expect(f?.parts.sort()).toEqual(['br#0', 'panel#0']);
    // The marker runs along the hole axis (world y here) at the hole centre.
    expect(f?.head[0]).toBeCloseTo(50, 6);
    expect(f?.head[2]).toBeCloseTo(50, 6);
    expect(Math.abs((f?.tip[1] ?? 0) - (f?.head[1] ?? 0))).toBeCloseTo(f?.length ?? 0, 6);
  });

  it('all metal and through: a rivet (grip + 1.5 d)', () => {
    const [f] = fastenersOf(benchItems(stack({ bracket: 'aluminium', panel: 'acm' }), roles));
    expect(f?.kind).toBe('rivet');
    expect(f?.length).toBe(14); // 4 + 3 + 6 = 13 → 14
  });

  it('a blind hole in the panel: a screw from the bracket side that stays inside', () => {
    const p = stack({ bracket: 'aluminium', panelHole: 'pocket' });
    const [f] = fastenersOf(benchItems(p, roles));
    expect(f?.kind).toBe('screw');
    expect(f?.length).toBeLessThanOrEqual(p.stock.thickness + 3 - 1);
    // Head on the bracket (top), tip going down into the panel.
    expect(f?.head[1] ?? 0).toBeGreaterThan(f?.tip[1] ?? 0);
  });

  it('misaligned holes (0.5 mm) or a hidden part: no fastener', () => {
    expect(fastenersOf(benchItems(stack({ dx: 0.5 }), roles))).toHaveLength(0);
    const items = benchItems(stack({}), roles).map((i) =>
      i.id === 'br#0' ? { ...i, hidden: true } : i,
    );
    expect(fastenersOf(items)).toHaveLength(0);
  });

  it('rows group by kind, diameter and length', () => {
    const f = fastenersOf(benchItems(stack({ bracket: 'aluminium' }), roles));
    const rows = fastenerRows([...f, ...f]);
    expect(rows).toEqual([{ kind: 'screw', d: 4, length: f[0]?.length, qty: 2 }]);
  });

  it('standard lengths', () => {
    expect(standardLength('screw', 21, 4, true)).toBe(25);
    expect(standardLength('screw', 21, 4, false)).toBe(20);
    expect(standardLength('rivet', 4, 4, true)).toBe(10);
    expect(standardLength('screw', 2, 3, false)).toBe(6);
  });
});
