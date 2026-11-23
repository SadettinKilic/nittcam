import { describe, expect, it } from 'vitest';
import { nestProject } from '../nesting';
import type { Part, Project } from '../schema';
import { buildToolpath } from '../toolpath';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import { applyCommand } from './index';

/**
 * T317 (usta 1, D-106): "Aynala" gives a real left / right door pair. A door 400 × 700, qty 2,
 * a handle hole near the right edge and a hinge cup near the left edge, grain along the height,
 * band on the right edge only (asymmetric on purpose).
 */
function door(qty = 2): Project {
  const base = projectOf({ parts: [{ id: 'door', w: 400, h: 700, qty }] });
  const [p] = base.parts;
  if (!p) throw new Error('part');
  const d: Part = {
    ...p,
    name: 'Kapak',
    edgeBand: { top: 0, right: 1, bottom: 0, left: 0 },
    grain: { mode: 'fixed', angle: 60 },
    holes: [
      { id: 'k1', type: 'through', tool: 1, d: 10, cx: 360, cy: 580 },
      { id: 'm1', type: 'pocket', tool: 1, d: 35, cx: 22.5, cy: 100, depth: 12 },
    ],
  } as Part;
  return { ...base, parts: [d] };
}

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

describe('splitMirrorPair (T317, D-106)', () => {
  it('qty 2 → a left row and a mirrored right row of 1 each', () => {
    const p = run(door(), 'splitMirrorPair', { id: 'door', newId: 'door-r', note: 'Ayna' });
    expect(p.parts.map((x) => [x.id, x.qty, x.name])).toEqual([
      ['door', 1, 'Kapak'],
      ['door-r', 1, 'Kapak'],
    ]);
    const [left, right] = p.parts;
    if (!left || !right) throw new Error('parts');
    expect(left.holes).toEqual(door().parts[0]?.holes);
    // Mirrored left ↔ right about the part's middle: x → 400 − x, y kept.
    expect(right.holes.map((h) => [h.id, h.cx, h.cy])).toEqual([
      ['k1', 40, 580],
      ['m1', 377.5, 100],
    ]);
    expect(right.edgeBand).toEqual({ top: 0, right: 0, bottom: 0, left: 1 });
    expect(right.grain.angle).toBe(120);
    expect(right.note).toBe('Ayna');
    expect(right.draw).toBeUndefined();
  });

  it('odd quantities: the original keeps the larger half', () => {
    const p = run(door(5), 'splitMirrorPair', { id: 'door', newId: 'r' });
    expect(p.parts.map((x) => x.qty)).toEqual([3, 2]);
  });

  it('refuses qty 1, an unknown part and a taken id', () => {
    expect(applyCommand(door(1), 'splitMirrorPair', { id: 'door', newId: 'r' }).ok).toBe(false);
    expect(applyCommand(door(), 'splitMirrorPair', { id: 'x', newId: 'r' }).ok).toBe(false);
    expect(applyCommand(door(), 'splitMirrorPair', { id: 'door', newId: 'door' }).ok).toBe(false);
  });

  it('drops the placement of the copy that moved to the new row', () => {
    const placed: Project = {
      ...door(),
      layout: {
        sheets: [
          {
            placements: [
              { partId: 'door', index: 0, x: 10, y: 10, rot: 0, locked: false },
              { partId: 'door', index: 1, x: 500, y: 10, rot: 0, locked: false },
            ],
          },
        ],
      },
    } as Project;
    const p = run(placed, 'splitMirrorPair', { id: 'door', newId: 'r' });
    expect(p.layout.sheets[0]?.placements.map((x) => [x.partId, x.index])).toEqual([['door', 0]]);
  });

  it('the toolpath drills the handle mirrored on the second door (nesting → toolpath)', () => {
    // Grain along the height (90° mirrors to itself), so both doors nest the same way up.
    const d0 = door();
    const g = {
      ...d0,
      parts: d0.parts.map((x) => ({ ...x, grain: { mode: 'fixed' as const, angle: 90 } })),
    };
    const p0 = run(g, 'splitMirrorPair', { id: 'door', newId: 'r' });
    const nested = nestProject(p0, { toolDiameter: 8 });
    expect(nested.unplaced).toHaveLength(0);
    const p = { ...p0, layout: nested.layout };
    const tp = buildToolpath(p, machineOf({ toolDiameter: 8 }));
    if (!tp.ok) throw new Error('toolpath');
    // Handle hole k1 in each door, in the part frame: plunge point minus the placement origin.
    const local = (partId: string) => {
      const op = tp.toolpath.operations.find((o) => o.partId === partId && o.holeId === 'k1');
      const pl = p.layout.sheets.flatMap((s) => s.placements).find((x) => x.partId === partId);
      if (!op || !pl) throw new Error(`no k1 on ${partId}`);
      const plunges = op.segments.flatMap((g) => g.moves).filter((m) => m.kind === 'plunge');
      const xs = plunges.map((m) => m.x);
      const ys = plunges.map((m) => m.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return { pl, cx, cy };
    };
    const a = local('door');
    const b = local('r');
    // Same placement rotation; the handle sits 360 − 40 = 320 mm apart across the door width
    // (along X unrotated, along Y when the grain turns the doors).
    expect(a.pl.rot).toBe(b.pl.rot);
    const d = [a.cx - a.pl.x - (b.cx - b.pl.x), a.cy - a.pl.y - (b.cy - b.pl.y)].map(Math.abs);
    expect(Math.max(...d)).toBeCloseTo(320, 0);
    expect(Math.min(...d)).toBeCloseTo(0, 0);
  });
});
