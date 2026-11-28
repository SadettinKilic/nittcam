import { describe, expect, it } from 'vitest';
import type { MachineProfile } from '../machine';
import { exportNc } from '../export/export';
import { golden, postConfig } from '../gcode-check/check.testing';
import { expectedLayout } from '../gcode-check/layout';
import { bbox, contour } from '../geometry/polyline';
import { buildToolpath, placedOutline } from '../toolpath';
import { passLoop, projectOf } from '../toolpath/toolpath.testing';
import { toCutSizes } from './cut-size';
import { faceUpOf, machinedProject, mirrorPartForBack, turnLayoutOver } from './machined-face';
import { deriveOutline } from './outline';
import type { Part, Project } from './project';

// T348 (§3.6 "İşlenen yüz"): parts are mirrored once, in the layout stage.

const L_OUTLINE = [
  { x: 0, y: 0, bulge: 0 },
  { x: 100, y: 0, bulge: 0 },
  { x: 100, y: 30, bulge: 0 },
  { x: 30, y: 30, bulge: 0 },
  { x: 30, y: 80, bulge: 0 },
  { x: 0, y: 80, bulge: 0 },
];

/** An "L" part (foot to the right) placed once at (x, y, rot) on one sheet. */
function lProject(material: string, face: 'front' | 'back', rot = 0, grain = 0): Project {
  const p = projectOf({
    parts: [{ id: 'L', w: 100, h: 80 }],
    thickness: 4,
    placements: [[{ partId: 'L', index: 0, x: 50, y: 40, rot }]],
  });
  const part = p.parts[0] as Part;
  const l: Part = {
    ...(part as Part & { params?: unknown }),
    kind: 'freeform',
    outline: L_OUTLINE,
    grain: { mode: grain === 0 ? 'free' : 'fixed', angle: grain },
  } as Part;
  delete (l as { params?: unknown }).params;
  return {
    ...p,
    stock: { ...p.stock, material, ...(face === 'back' ? { machinedFace: 'back' as const } : {}) },
    parts: [l],
  };
}

/** The golden generic profile with ACM 4 mm sets (copies of its MDF sets). */
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

const key = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;

/** True when (x, y) is a vertex of the loop or on one of its straight segments. */
function onLoop(pl: { vertices: { x: number; y: number; bulge: number }[] }, x: number, y: number) {
  const vs = pl.vertices;
  return vs.some((a, i) => {
    const b = vs[(i + 1) % vs.length] as (typeof vs)[number];
    if (Math.hypot(a.x - x, a.y - y) < 1e-6) return true;
    if (a.bulge !== 0) return false;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const cross = Math.abs((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / len;
    const t = ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (len * len);
    return cross < 1e-6 && t >= -1e-9 && t <= 1 + 1e-9;
  });
}

describe('machinedProject (T348)', () => {
  it('front face: the same object (MDF and every existing project unchanged)', () => {
    const p = lProject('mdf', 'front');
    expect(machinedProject(p)).toBe(p);
    expect(toCutSizes(p)).toBe(p);
  });

  it('back face: idempotent and memoised', () => {
    const p = lProject('acm', 'back');
    const m = machinedProject(p);
    expect(m).not.toBe(p);
    expect(machinedProject(p)).toBe(m);
    expect(machinedProject(m)).toBe(m);
    expect(toCutSizes(p)).toBe(m);
  });

  it('mirrors the part in its own box: outline, holes, lines, bands, grain', () => {
    const base = lProject('mdf', 'back').parts[0] as Part;
    const part: Part = {
      ...base,
      holes: [{ id: 'h', type: 'through', d: 8, cx: 80, cy: 15, tool: 1 }],
      lines: [
        {
          vertices: [
            { x: 5, y: 5, bulge: 0.5 },
            { x: 20, y: 5, bulge: 0 },
          ],
          op: { kind: 'online', depth: 1 },
        },
      ],
      edgeBand: { top: 1, right: 2, bottom: 0, left: 0.5 },
      grain: { mode: 'fixed', angle: 30 },
    };
    const m = mirrorPartForBack(part);
    const box = bbox(contour(deriveOutline(m)));
    expect([box.minX, box.maxX, box.minY, box.maxY]).toEqual([0, 100, 0, 80]);
    const pts = new Set(deriveOutline(m).map((v) => key(v.x, v.y)));
    for (const v of L_OUTLINE) expect(pts.has(key(100 - v.x, v.y))).toBe(true);
    expect(m.holes[0]).toMatchObject({ cx: 20, cy: 15 });
    expect(m.lines?.[0]?.vertices.map((v) => [v.x, v.y, v.bulge])).toEqual([
      [95, 5, -0.5],
      [80, 5, -0],
    ]);
    expect(m.edgeBand).toEqual({ top: 1, right: 0.5, bottom: 0, left: 2 });
    expect(m.grain.angle).toBe(150);
    // A rectangle is its own mirror: params kept.
    const rect = projectOf({ parts: [{ id: 'r', w: 100, h: 50 }] }).parts[0] as Part;
    expect(mirrorPartForBack(rect)).toMatchObject({ kind: 'rect', params: { w: 100, h: 50 } });
  });

  it('directed arrows reflect as directions: 0° flips, 30° → 150° unflipped', () => {
    const part = lProject('acm', 'back').parts[0] as Part;
    const at0 = mirrorPartForBack({ ...part, grain: { mode: 'fixed', angle: 0 } }, true);
    expect(at0.grain).toEqual({ mode: 'fixed', angle: 0, flip: true });
    const at30 = mirrorPartForBack({ ...part, grain: { mode: 'fixed', angle: 30 } }, true);
    expect(at30.grain).toEqual({ mode: 'fixed', angle: 150 });
    // Sheet arrow 0° is stored as 0 with every part arrow turned by 180 too.
    const off = mirrorPartForBack({ ...part, grain: { mode: 'fixed', angle: 0 } }, true, 180);
    expect(off.grain).toEqual({ mode: 'fixed', angle: 0 });
  });

  it('toolpath of an L part on ACM (back) is the mirror image of the front cut', () => {
    const profile = acmProfile();
    const front = buildToolpath(lProject('acm', 'front'), profile);
    const back = buildToolpath(lProject('acm', 'back'), profile);
    if (!front.ok || !back.ok) throw new Error('toolpath');
    const loop = (ops: typeof front.toolpath.operations) =>
      passLoop(ops[ops.length - 1] as (typeof ops)[number], 0);
    const f = loop(front.toolpath.operations);
    const b = loop(back.toolpath.operations);
    const fb = bbox(f);
    const axis = fb.minX + fb.maxX;
    // Every front vertex, mirrored, lies on the back loop (split points may differ).
    for (const v of f.vertices) expect(onLoop(b, axis - v.x, v.y)).toBe(true);
    for (const v of b.vertices) expect(onLoop(f, axis - v.x, v.y)).toBe(true);
    // The front L has its upright on the left: the back one has it on the right, so the foot's
    // top-left corner (0, 30) exists only on the back.
    expect(
      placedOutline(machinedProject(lProject('acm', 'back')).parts[0] as Part, {
        x: 50,
        y: 40,
        rot: 0,
      }).vertices.some((v) => v.x === 50 && v.y === 40 + 30),
    ).toBe(true);
  });

  it('turnLayoutOver mirrors placements about the sheet centre; twice is the identity', () => {
    const p = lProject('acm', 'front', 90);
    const turned = turnLayoutOver(p.layout, p.parts, () => 2440);
    // L turned 90° is 80 wide: x = 2440 − 50 − 80.
    expect(turned.sheets[0]?.placements[0]).toMatchObject({ x: 2310, y: 40, rot: 270 });
    expect(turnLayoutOver(turned, p.parts, () => 2440)).toEqual(p.layout);
  });

  it('checker: mirrored + rotated grain part passes; front layout on the mirrored program fails', () => {
    const pv = { profile: acmProfile(), version: 1, verification: 'draft' as const };
    const p = lProject('acm', 'back', 90, 30);
    const res = exportNc(p, pv, postConfig('generic'), { revision: 1 });
    expect(res.toolpathIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(res.check?.ok).toBe(true);
    // The independent expectation is mirrored (foot to the left after the mirror).
    const back = expectedLayout(p, 0)[0];
    const front = expectedLayout({ ...p, stock: { ...p.stock, machinedFace: undefined } }, 0)[0];
    expect(back?.outline).not.toEqual(front?.outline);
  });
});

describe('faceUpOf (T348)', () => {
  it('back on a back-face stock, front on ACM set to front, null on wood', () => {
    expect(faceUpOf(lProject('acm', 'back'))).toBe('back');
    expect(faceUpOf(lProject('acm', 'front'))).toBe('front');
    expect(faceUpOf(lProject('mdf', 'front'))).toBeNull();
  });
});
