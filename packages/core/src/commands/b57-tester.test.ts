import { describe, expect, it } from 'vitest';
import { cutListToParts, parseCutList } from '../cutlist/parse';
import { nestProject } from '../nesting';
import type { Part, Project } from '../schema';
import { toCutSizes } from '../schema/cut-size';
import { buildToolpath } from '../toolpath';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import { applyCommand } from './index';

// B57 tester edge cases: T317 mirrored pair with an asymmetric band in finished mode (cut frame),
// T318 pasted "Var" grain lets Baza 2400 × 100 fit along the sheet grain.

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

function door(mode: 'cut' | 'finished'): Project {
  const base = projectOf({ parts: [{ id: 'door', w: 400, h: 700, qty: 2 }] });
  const [p] = base.parts;
  if (!p) throw new Error('part');
  const d = {
    ...p,
    edgeBand: { top: 0, right: 0, bottom: 0, left: 2 },
    holes: [
      { id: 'k1', type: 'through', tool: 1, d: 10, cx: 360, cy: 580 },
      { id: 'm1', type: 'pocket', tool: 1, d: 35, cx: 22.5, cy: 100, depth: 12 },
    ],
  } as Part;
  return { ...base, parts: [d], settings: { ...base.settings, dimensionMode: mode } };
}

describe('T317 tester: the pair is a mirror in the cut frame too', () => {
  for (const mode of ['cut', 'finished'] as const) {
    it(`${mode} mode, band on one edge only: cut holes mirror about the cut width`, () => {
      const cut = toCutSizes(run(door(mode), 'splitMirrorPair', { id: 'door', newId: 'door-r' }));
      const [a, b] = cut.parts;
      if (!a || !b || a.kind !== 'rect' || b.kind !== 'rect') throw new Error('parts');
      expect(b.params.w).toBeCloseTo(a.params.w, 6);
      expect(b.params.h).toBeCloseTo(a.params.h, 6);
      a.holes.forEach((h, i) => {
        const m = b.holes[i];
        expect(m?.cx).toBeCloseTo(a.params.w - h.cx, 6);
        expect(m?.cy).toBeCloseTo(h.cy, 6);
        expect(m?.type).toBe(h.type);
        expect(m?.d).toBe(h.d);
      });
    });
  }
  it('both doors nest and build a toolpath without errors', () => {
    const p = structuredClone(
      run(door('finished'), 'splitMirrorPair', { id: 'door', newId: 'door-r' }),
    );
    p.layout = nestProject(p, { toolDiameter: 6 }).layout as Project['layout'];
    const placed = p.layout.sheets.flatMap((s) => s.placements.map((pl) => pl.partId)).sort();
    expect(placed).toEqual(['door', 'door-r']);
    const tp = buildToolpath(p, machineOf());
    expect(tp.errors).toEqual([]);
  });
});

describe('T318 tester: pasted "Var" fits Baza along the sheet grain', () => {
  it('Baza 2400 × 100 with Var is placed (rotated along the 2440 sheet grain)', () => {
    const r = parseCutList('Parça Adı;Boy;En;Adet;Damar\nBaza;2400;100;2;Var');
    const [row] = cutListToParts(r.rows, ['baza'], 'mm');
    if (!row) throw new Error('row');
    const p = projectOf({ parts: [{ id: 'baza', w: row.params.w, h: row.params.h, qty: 2 }] });
    const part = p.parts[0];
    if (!part || !row.grain) throw new Error('grain');
    part.grain = row.grain;
    const res = nestProject(p, { toolDiameter: 6 });
    expect(res.unplaced ?? []).toEqual([]);
    const pls = res.layout.sheets.flatMap((s) => s.placements);
    expect(pls).toHaveLength(2);
    for (const pl of pls) expect([90, 270]).toContain(pl.rot);
  });
  it('"Yok" leaves the grain free; lower-case "var" means the same as "Var"', () => {
    const r = parseCutList('Ad;Boy;En;Adet;Damar\nA;700;300;1;Yok\nB;700;300;1;var');
    const parts = cutListToParts(r.rows, ['a', 'b'], 'mm');
    expect(parts[0]?.grain).toBeUndefined();
    expect(parts[1]?.grain).toEqual({ mode: 'fixed', angle: 90 });
  });
});
