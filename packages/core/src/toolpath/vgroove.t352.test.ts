import { describe, expect, it } from 'vitest';
import { CommandStack } from '../commands';
import { traitsOf } from '../machine/material-traits';
import { MATERIAL_KIND_IDS } from '../machine/material-kinds';
import { defaultMachineProfile, type MachineProfile } from '../machine';
import {
  DXF_EXPORT_LAYER_MAP,
  dxfImportParts,
  planDxfImport,
  readDxf,
  writeDxfEntities,
} from '../dxf';
import type { Project } from '../schema';
import { allowedOperations } from '../schema/operations';
import { validateProject } from '../validate';
import { partEntities, DXF_EXPORT_LAYERS } from '../dxf/write';
import { projectOf } from './toolpath.testing';
import { operationToolProblem, operationToolsOf } from './op-tool-choice';
import {
  vConeDepth,
  vGrooveDepth,
  vGroovePassDepths,
  vGrooveToolOf,
  vGrooveWidth,
} from './vgroove';

// T352 (§6.3 "V-kanal", analysis §4.5 / §5.3): the V-groove operation in the model and on the board.

const at = { actor: 'user' as const, at: '2026-11-28T00:00:00.000Z' };

/** A 200 × 200 part with one fold line across it (edge to edge) and one inner contour. */
function acm(thickness = 4): CommandStack {
  const s = new CommandStack(projectOf({ parts: [{ id: 'a', w: 200, h: 200, qty: 1 }] }));
  s.execute('setMaterial', { material: 'acm' }, at);
  s.execute('setThickness', { thickness }, at);
  const p = structuredClone(s.project) as Project;
  const part = p.parts[0] as Project['parts'][number];
  part.lines = [
    {
      vertices: [
        { x: 0, y: 25, bulge: 0 },
        { x: 200, y: 25, bulge: 0 },
      ],
      op: { kind: 'none' },
    },
  ];
  return new CommandStack(p);
}

export function vBitProfile(): MachineProfile {
  const p = defaultMachineProfile();
  p.tools = [
    ...p.tools,
    {
      number: 7,
      type: 'vBit',
      diameter: 12,
      fluteLength: 10,
      flutes: 2,
      angleDeg: 90,
      tipDiameter: 0.2,
    },
    { number: 8, type: 'vBit', diameter: 20, fluteLength: 10, flutes: 2, angleDeg: 135 },
  ];
  return p;
}

const line0 = { type: 'line' as const, index: 0 };

describe('traits.vGroove (T352)', () => {
  it('only ACM folds: remaining 0,8 default, 0,7 minimum, V-bit only', () => {
    expect(traitsOf('acm').vGroove).toEqual({
      defaultRemaining: 0.8,
      minRemaining: 0.7,
      maxRemaining: 1.2,
      step: 3,
    });
    expect(traitsOf('acm').toolTypes.vgroove).toEqual(['vBit']);
    for (const k of MATERIAL_KIND_IDS.filter((k) => k !== 'acm')) {
      expect(traitsOf(k).vGroove).toBeNull();
      expect(traitsOf(k).toolTypes.vgroove).toEqual([]);
    }
  });

  it('allowedOperations offers vgroove on lines and inner contours only where the stock folds', () => {
    expect(allowedOperations('line', true)).toContain('vgroove');
    expect(allowedOperations('inner', true)).toContain('vgroove');
    expect(allowedOperations('outline', true)).not.toContain('vgroove');
    expect(allowedOperations('line', false)).not.toContain('vgroove');
    expect(allowedOperations('inner', false)).not.toContain('vgroove');
  });
});

describe('setOperation vgroove (T352)', () => {
  it('sets a groove on an open line; remaining optional; one undo step back', () => {
    const s = acm();
    expect(s.execute('setOperation', { id: 'a', contour: line0, kind: 'vgroove' }, at).ok).toBe(
      true,
    );
    expect(s.project.parts[0]?.lines?.[0]?.op).toEqual({ kind: 'vgroove' });
    expect(
      s.execute('setOperation', { id: 'a', contour: line0, kind: 'vgroove', remaining: 1 }, at).ok,
    ).toBe(true);
    expect(s.project.parts[0]?.lines?.[0]?.op).toEqual({ kind: 'vgroove', remaining: 1 });
    s.undo();
    expect(s.project.parts[0]?.lines?.[0]?.op).toEqual({ kind: 'vgroove' });
    s.undo();
    expect(s.project.parts[0]?.lines?.[0]?.op).toEqual({ kind: 'none' });
  });

  it('refuses a remaining outside 0,7 … 1,2, a depth, and the outline', () => {
    const s = acm();
    for (const remaining of [0.6, 0.69, 1.3]) {
      expect(
        s.execute('setOperation', { id: 'a', contour: line0, kind: 'vgroove', remaining }, at).ok,
      ).toBe(false);
    }
    expect(
      s.execute('setOperation', { id: 'a', contour: line0, kind: 'vgroove', depth: 3 }, at).ok,
    ).toBe(false);
    expect(
      s.execute('setOperation', { id: 'a', contour: { type: 'outline' }, kind: 'vgroove' }, at).ok,
    ).toBe(false);
    expect(
      s.execute(
        'setOperation',
        { id: 'a', contour: line0, kind: 'online', depth: 1, remaining: 1 },
        at,
      ).ok,
    ).toBe(false);
  });

  it('is not offered on MDF or aluminium', () => {
    for (const material of ['mdf', 'aluminium']) {
      const s = acm();
      s.execute('setMaterial', { material }, at);
      const r = s.execute('setOperation', { id: 'a', contour: line0, kind: 'vgroove' }, at);
      expect(r.ok).toBe(false);
    }
  });
});

describe('V-groove geometry (T352)', () => {
  it('width = tip + 2 · depth · tan(angle / 2); depth = t − remaining (analysis example 9,4 mm)', () => {
    expect(vGrooveDepth(4, 0.8)).toBeCloseTo(3.2, 9);
    expect(vGrooveWidth({ angleDeg: 90, tipDiameter: 3 }, 3.2)).toBeCloseTo(9.4, 9);
    expect(vGrooveWidth({ angleDeg: 90 }, 2.2)).toBeCloseTo(4.4, 9);
    expect(vConeDepth({ angleDeg: 90, tipDiameter: 0, diameter: 12 })).toBeCloseTo(6, 9);
  });

  it('one pass up to the traits step, two even passes when deeper', () => {
    expect(vGroovePassDepths(2.2, 3)).toEqual([-2.2]);
    expect(vGroovePassDepths(3, 3)).toEqual([-3]);
    expect(vGroovePassDepths(3.2, 3)).toEqual([-1.6, -3.2]);
    expect(vGroovePassDepths(5.2, 3)).toEqual([-2.6, -5.2]);
  });
});

describe('V-groove tool and validation (T352)', () => {
  it('the default V-bit is the lowest-numbered V-bit with an angle; setOperationTool picks another', () => {
    const s = acm();
    s.execute('setOperation', { id: 'a', contour: line0, kind: 'vgroove' }, at);
    const m = vBitProfile();
    expect(vGrooveToolOf(s.project, m)?.number).toBe(7);
    const row = operationToolsOf(s.project, m).find((r) => r.op === 'vgroove');
    // without a material set the rows are empty; with the default profile's sets we get the row
    if (row) expect(row.defaultTool).toBe(7);
    const sm = new CommandStack(s.project, { machine: m });
    const r8 = sm.execute('setOperationTool', { op: 'vgroove', tool: 8 }, at);
    expect(r8.ok ? '' : JSON.stringify(r8)).toBe('');
    expect(vGrooveToolOf(sm.project, m)?.number).toBe(8);
    const flatNo = m.tools.find((t) => t.type === 'flatEndMill')?.number ?? 1;
    expect(sm.execute('setOperationTool', { op: 'vgroove', tool: flatNo }, at).ok).toBe(false);
    // a flat end mill is refused for the groove
    const flat = m.tools.find((t) => t.type === 'flatEndMill');
    expect(flat && operationToolProblem(s.project, m, 'vgroove', flat.number)).toBe('TYPE');
  });

  it('VGROOVE_TOOL_MISSING without a V-bit; VGROOVE_DEPTH_INVALID; VGROOVE_MATERIAL; outside', () => {
    const s = acm();
    s.execute('setOperation', { id: 'a', contour: line0, kind: 'vgroove' }, at);
    const codes = (p: Project, m?: MachineProfile) =>
      validateProject(p, m ? { machine: m } : {})
        .map((i) => i.code)
        .filter((c) => c.startsWith('VGROOVE'));
    expect(codes(s.project, vBitProfile())).toEqual([]);
    expect(codes(s.project, defaultMachineProfile())).toEqual(['VGROOVE_TOOL_MISSING']);
    // a hand-edited remaining below the minimum
    const deep = structuredClone(s.project) as Project;
    (deep.parts[0]?.lines?.[0] as { op: unknown }).op = { kind: 'vgroove', remaining: 0.5 };
    expect(codes(deep)).toEqual(['VGROOVE_DEPTH_INVALID']);
    // the fold line leaves the part
    const out = structuredClone(s.project) as Project;
    (out.parts[0]?.lines?.[0] as { vertices: unknown }).vertices = [
      { x: -5, y: 25, bulge: 0 },
      { x: 200, y: 25, bulge: 0 },
    ];
    expect(codes(out)).toEqual(['VGROOVE_OUTSIDE_PART']);
    // the material changed to MDF with the groove still there
    s.execute('setMaterial', { material: 'mdf' }, at);
    expect(codes(s.project)).toEqual(['VGROOVE_MATERIAL']);
  });
});

describe('V-groove DXF (T352)', () => {
  it('exports the fold line on layer VKANAL and reads it back as a groove (edge to edge)', () => {
    const s = acm();
    s.execute('setOperation', { id: 'a', contour: line0, kind: 'vgroove' }, at);
    const part = s.project.parts[0] as Project['parts'][number];
    const ents = partEntities(part, { x: 0, y: 0, rot: 0 });
    expect(ents.filter((e) => e.layer === DXF_EXPORT_LAYERS.vgroove)).toHaveLength(1);
    expect(DXF_EXPORT_LAYERS.vgroove).toBe('VKANAL');
    const read = readDxf(writeDxfEntities(ents));
    if (!read.ok) throw new Error('dxf read failed');
    const plan = planDxfImport(read.value, DXF_EXPORT_LAYER_MAP);
    expect(plan.lineOrphans).toHaveLength(0);
    const parts = dxfImportParts(
      plan,
      () => 'p',
      () => 'P',
    );
    expect(parts[0]?.lines).toHaveLength(1);
    expect(parts[0]?.lines[0]?.op).toEqual({ kind: 'vgroove' });
  });
});
