import { applyCommand, cabinetParts, DEFAULT_CABINET, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { cabinetRows } from '../cabinet-rows';
import { newProject } from '../draft-project';
import { getMessages } from '../messages';
import { applyMatrix, assemblyFaceMatrix, cabinetGroups, hasFaceOnlyWork } from './assembly';

/**
 * T317 (usta 1, D-106): a door row of 2 with a handle near the right edge (580 mm up) and hinge
 * cups near the left edge, turned into a left / right pair with "Sol / sağ kapak yap"
 * (`splitMirrorPair`). The assembly view shows one left and one right door, both with the
 * handle at the drawn height, handles toward the middle, hinges at the outer edges.
 */
const roles = getMessages().cutList.cabinet.roles;

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

function pairProject(cups: boolean): Project {
  const r = cabinetParts({ ...DEFAULT_CABINET, width: 800, doors: 2 });
  if (!r.ok) throw new Error(r.error);
  let n = 0;
  const rows = cabinetRows(r.parts, roles, 'Dolap', () => `p${++n}`, { mode: 'finished' });
  const base = newProject();
  let p = run(
    { ...base, settings: { ...base.settings, dimensionMode: 'finished' } },
    'importCutList',
    { parts: rows },
  );
  const door = p.parts.find((x) => x.name === roles.door);
  if (!door || door.kind !== 'rect') throw new Error('door');
  const { w } = door.params;
  p = run(p, 'addHole', {
    id: door.id,
    hole: { id: 'k1', type: 'through', tool: 1, d: 5, cx: w - 35, cy: 580 },
  });
  if (cups) {
    p = run(p, 'addHole', {
      id: door.id,
      hole: { id: 'm1', type: 'pocket', tool: 1, d: 35, cx: 22.5, cy: 100, depth: 12 },
    });
  }
  return run(p, 'splitMirrorPair', { id: door.id, newId: 'door-r' });
}

function doors(project: Project) {
  const [g] = cabinetGroups(project, roles);
  if (!g) throw new Error('no group');
  return g.assembly.boxes
    .filter((b) => b.role === 'door')
    .map((b) => {
      const part = g.parts.get(b.id);
      if (!part) throw new Error('no part');
      const m = assemblyFaceMatrix(b, g.assembly.width, hasFaceOnlyWork(part, b.sz));
      const at = (id: string) => {
        const h = part.holes.find((x) => x.id === id);
        return h ? applyMatrix(m, h.cx, h.cy, b.sz) : null;
      };
      return { box: b, handle: at('k1'), cup: at('m1'), mid: g.assembly.width / 2 };
    });
}

describe('left / right door pair in the assembly view (T317)', () => {
  for (const cups of [false, true]) {
    it(`two boards, handles at the drawn height toward the middle (${cups ? 'with' : 'no'} hinge cups)`, () => {
      const p = pairProject(cups);
      const ds = doors(p);
      expect(ds).toHaveLength(2);
      expect(new Set(ds.map((d) => d.box.id)).size).toBe(2);
      for (const d of ds) {
        expect(d.box.pair).toBe(true);
        if (!d.handle) throw new Error('handle');
        // 580 mm above the door bottom on both doors (the usta saw them at different heights).
        expect((d.handle[1] ?? 0) - d.box.y).toBeCloseTo(580, 6);
        // Handle on the middle side of its door.
        const centre = d.box.x + d.box.sx / 2;
        expect(Math.abs((d.handle[0] ?? 0) - d.mid)).toBeLessThan(Math.abs(centre - d.mid));
        if (d.cup) {
          // Hinge cups at the outer edge, on the inside face.
          expect(Math.abs((d.cup[0] ?? 0) - d.mid)).toBeGreaterThan(Math.abs(centre - d.mid));
          expect(d.cup[2] ?? 0).toBeLessThan(d.box.z + d.box.sz / 2);
        }
      }
    });
  }

  it('a plain row of 2 identical doors is not a pair (T310 behaviour kept)', () => {
    const r = cabinetParts({ ...DEFAULT_CABINET, width: 800, doors: 2 });
    if (!r.ok) throw new Error(r.error);
    let n = 0;
    const rows = cabinetRows(r.parts, roles, 'Dolap', () => `p${++n}`, { mode: 'cut' });
    const p = run(newProject(), 'importCutList', { parts: rows });
    expect(doors(p).map((d) => d.box.pair)).toEqual([undefined, undefined]);
  });
});
