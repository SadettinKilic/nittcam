import { describe, expect, it } from 'vitest';
import { golden } from '../gcode-check/check.testing';
import type { MachineProfile } from '../machine';
import { bbox, signedArea } from '../geometry/polyline';
import { buildToolpath } from '../toolpath';
import { passLoop, projectOf } from '../toolpath/toolpath.testing';
import type { Part, Project } from './project';

// T348 tester: an asymmetric L part with a through hole and a pocket, cut from the back, keeps
// the machining direction (climb/conventional) and mirrors every operation about the part axis.

const L = [
  { x: 0, y: 0, bulge: 0 },
  { x: 100, y: 0, bulge: 0 },
  { x: 100, y: 30, bulge: 0 },
  { x: 30, y: 30, bulge: 0 },
  { x: 30, y: 80, bulge: 0 },
  { x: 0, y: 80, bulge: 0 },
];

function proj(face: 'front' | 'back'): Project {
  const p = projectOf({
    parts: [{ id: 'L', w: 100, h: 80 }],
    thickness: 4,
    placements: [[{ partId: 'L', index: 0, x: 50, y: 40, rot: 0 }]],
  });
  const base = p.parts[0] as Part & { params?: unknown };
  const part = {
    ...base,
    kind: 'freeform',
    outline: L,
    holes: [
      { id: 'h1', type: 'through', d: 8, cx: 80, cy: 15, tool: 1 },
      { id: 'h2', type: 'pocket', d: 12, depth: 2, cx: 15, cy: 60, tool: 1 },
    ],
  } as unknown as Part;
  delete (part as { params?: unknown }).params;
  return {
    ...p,
    stock: {
      ...p.stock,
      material: 'acm',
      ...(face === 'back' ? { machinedFace: 'back' as const } : {}),
    },
    parts: [part],
  };
}

function acmProfile(): MachineProfile {
  const p = JSON.parse(
    JSON.stringify(golden('generic', 'mixed').context.profile),
  ) as MachineProfile;
  const mdf = p.materials.filter((m) => m.material === 'mdf');
  const t = mdf[0]?.thickness;
  p.materials.push(
    ...mdf
      .filter((m) => m.thickness === t)
      .map((m) => ({ ...m, material: 'acm' as const, thickness: 4 })),
  );
  return p;
}

describe('T348 back-face safety (tester)', () => {
  it('every operation is mirrored about the part axis and keeps its winding (climb/conventional)', () => {
    const profile = acmProfile();
    const f = buildToolpath(proj('front'), profile);
    const b = buildToolpath(proj('back'), profile);
    if (!f.ok || !b.ok) throw new Error('toolpath');
    const fo = f.toolpath.operations;
    const bo = b.toolpath.operations;
    expect(bo.map((o) => o.kind).sort()).toEqual(fo.map((o) => o.kind).sort());
    expect(fo.map((o) => o.kind)).toEqual(expect.arrayContaining(['outerContour', 'pocket']));
    const outer = bbox(
      passLoop(
        fo.find((o) => o.kind === 'outerContour')!,
        0,
      ),
    );
    const axis = outer.minX + outer.maxX;
    let checked = 0;
    for (const o of fo) {
      if (!o.segments.some((s) => s.role === 'pass' && s.pass === 0)) continue;
      const fl = passLoop(o, 0);
      const fb = bbox(fl);
      const cx = (fb.minX + fb.maxX) / 2;
      const cy = (fb.minY + fb.maxY) / 2;
      const match = bo.find((q) => {
        if (q.kind !== o.kind || !q.segments.some((s) => s.role === 'pass' && s.pass === 0))
          return false;
        const bb = bbox(passLoop(q, 0));
        return (
          Math.abs((bb.minX + bb.maxX) / 2 - (axis - cx)) < 1e-3 &&
          Math.abs((bb.minY + bb.maxY) / 2 - cy) < 1e-3
        );
      });
      expect(match, `${o.kind} ${o.holeId ?? ''} has a mirrored twin`).toBeDefined();
      const bl = passLoop(match!, 0);
      // Same winding sign: the mirror must not silently turn climb into conventional.
      expect(Math.sign(signedArea(bl)), `${o.kind} winding`).toBe(Math.sign(signedArea(fl)));
      expect(o.feed).toBe(match!.feed);
      expect(o.rpm).toBe(match!.rpm);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});
