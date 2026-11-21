import {
  applyCommand,
  cabinetParts,
  DEFAULT_CABINET,
  toCutSizes,
  type DimensionMode,
} from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { cabinetRows } from './cabinet-rows';
import { newProject } from './draft-project';
import { getMessages } from './messages';
import { cabinetGroups } from './preview3d/assembly';

const roles = getMessages().cutList.cabinet.roles;
// The owner's test cabinet (usta 1): 800 × 720 × 560, two doors, gap 3, band 0,8.
const params = { ...DEFAULT_CABINET, width: 800, doors: 2 as const, band: 0.8 };

function added(mode: DimensionMode) {
  const r = cabinetParts(params);
  if (!r.ok) throw new Error(r.error);
  let n = 0;
  const rows = cabinetRows(r.parts, roles, 'Dolap 1', () => `p${++n}`, { mode });
  const base = newProject();
  const project = { ...base, settings: { ...base.settings, dimensionMode: mode } };
  const res = applyCommand(project, 'importCutList', { parts: rows });
  if (!res.ok) throw new Error(res.error.message);
  return { generated: r.parts, rows, project: res.project };
}

describe('Dolap ekle and the edge band (T316, D-105)', () => {
  it('cut mode: the door is entered without the band (393,9 × 712,4), finished stays 395,5 × 714', () => {
    const { rows, generated } = added('cut');
    const door = generated.find((p) => p.role === 'door');
    const row = rows.find((r) => r.name === roles.door);
    expect(door).toMatchObject({ w: 395.5, h: 714 });
    expect(row?.params).toEqual({ w: 393.9, h: 712.4, r: 0 });
  });

  it('cuts the same parts in both modes', () => {
    const cut = toCutSizes(added('cut').project).parts.map((p) => p.kind === 'rect' && p.params);
    const fin = toCutSizes(added('finished').project).parts.map(
      (p) => p.kind === 'rect' && p.params,
    );
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const round = (l: typeof cut) => l.map((p) => (p ? [r3(p.w), r3(p.h)] : null));
    expect(round(cut)).toEqual(round(fin));
    expect(cut).toHaveLength(6);
  });

  it('the door gap stays 3 mm: the assembly reads finished sizes in both modes', () => {
    for (const mode of ['cut', 'finished'] as const) {
      const g = cabinetGroups(added(mode).project, roles);
      const [group] = g;
      expect(g).toHaveLength(1);
      if (!group) throw new Error('no group');
      const doors = group.assembly.boxes.filter((b) => b.role === 'door');
      expect(doors.map((d) => d.sx)).toEqual([395.5, 395.5]);
      expect(group.assembly.width).toBe(800);
    }
  });
});
