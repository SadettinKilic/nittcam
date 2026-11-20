/**
 * T155: copy slots of the 3D scene (picking, lift and highlight attributes), the view-only sheet
 * offset clamp, the explode range and the wizard leave transition.
 */
import { describe, expect, it } from 'vitest';
import type { Part, Project } from '@nittcam/core';
import { drawnParts } from '../../components/layout-view/model';
import { clampOffset, explodeMax } from './interaction';
import { registerLeaveTransition, runLeaveTransition } from './leave';
import { buildSheetScene, pickSlot } from './sheet-scene';

const T = 18;

function rect(w: number, h: number, id: string): Part {
  return {
    id,
    kind: 'rect',
    name: `n-${id}`,
    qty: 2,
    grain: { mode: 'free', angle: 0 },
    params: { w, h, r: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
  } as unknown as Part;
}

function project(): Project {
  const a = rect(100, 50, 'a');
  const b = rect(300, 200, 'b');
  return {
    stock: { thickness: T, sheet: { width: 2800, height: 2070, grain: 0 } },
    parts: [a, b],
    layout: {
      sheets: [
        {
          placements: [
            { partId: 'b', index: 0, x: 500, y: 500, rot: 0, locked: false },
            { partId: 'a', index: 0, x: 0, y: 0, rot: 0, locked: false },
            { partId: 'ghost', index: 0, x: 900, y: 900, rot: 0, locked: false },
            { partId: 'a', index: 1, x: 200, y: 0, rot: 90, locked: false },
          ],
        },
      ],
    },
  } as unknown as Project;
}

describe('3D copy slots (T155)', () => {
  const p = project();
  const scene = buildSheetScene(p, 0);
  const drawn = drawnParts(p, 0);

  it('slot i is drawnParts[i]: same order, unknown parts skipped in both', () => {
    expect(scene.outlines).toHaveLength(drawn.length);
    const refs = [...scene.instanced.flatMap((g) => g.instances), ...scene.mergedRefs];
    for (const r of refs) expect(drawn[r.slot]?.key).toBe(r.key);
    expect(new Set(refs.map((r) => r.slot)).size).toBe(3);
  });

  it('every merged vertex and every edge vertex carries its slot', () => {
    expect(scene.mergedSlots).not.toBeNull();
    expect(scene.mergedSlots?.length).toBe((scene.merged?.positions.length ?? 0) / 3);
    expect(scene.edgeSlots.length).toBe(scene.edges.length / 3);
    // the merged single copy is "b", slot 0
    expect([...new Set(scene.mergedSlots)]).toEqual([0]);
    expect([...new Set(scene.edgeSlots)].sort()).toEqual([0, 1, 2]);
  });

  it('picks the copy under a sheet-frame point, -1 on waste', () => {
    for (const [i, d] of drawn.entries()) {
      const o = scene.outlines[i];
      expect(o).toBeDefined();
      if (!o) continue;
      const cx = (o.minX + o.maxX) / 2;
      const cy = (o.minY + o.maxY) / 2;
      expect(drawn[pickSlot(scene.outlines, cx, cy)]?.key).toBe(d.key);
    }
    expect(pickSlot(scene.outlines, 2000, 1800)).toBe(-1);
    expect(pickSlot([], 0, 0)).toBe(-1);
  });
});

describe('3D view-only state (T155)', () => {
  it('the sheet offset stays within one sheet size of the table centre', () => {
    const s = { width: 2800, height: 2070 };
    expect(clampOffset([100, -50], s)).toEqual([100, -50]);
    expect(clampOffset([9000, -9000], s)).toEqual([2800, -2070]);
  });

  it('explode lifts at least 40 mm, else 3 × thickness', () => {
    expect(explodeMax(8)).toBe(40);
    expect(explodeMax(18)).toBe(54);
  });

  it('leave transition: no handler → 0; registered → its wait; unregistered → 0', () => {
    expect(runLeaveTransition()).toBe(0);
    let calls = 0;
    const off = registerLeaveTransition(() => {
      calls++;
      return 380;
    });
    expect(runLeaveTransition()).toBe(380);
    expect(calls).toBe(1);
    off();
    expect(runLeaveTransition()).toBe(0);
  });
});
