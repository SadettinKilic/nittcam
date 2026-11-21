import {
  cabinetParts,
  cabinetPartsForStock,
  DEFAULT_CABINET,
  parseCommandLog,
  projectSchema,
} from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { cabinetRows } from './cabinet-rows';
import tr from '../messages/tr.json';
import { newProject } from './draft-project';
import { splitOffProject } from './split-project';

const AT = '2026-11-20T10:00:00.000Z';
const roles = tr.cutList.cabinet.roles;

function sourceWithCabinet() {
  const source = newProject();
  source.machine = { machineId: '7b0c3c5e-1111-4000-8000-000000000001', profileVersion: 3 };
  const res = cabinetParts(DEFAULT_CABINET);
  if (!res.ok) throw new Error('cabinet');
  const split = cabinetPartsForStock(res.parts, { thickness: 18, hasGrain: true });
  let n = 0;
  const rows = cabinetRows(split.other, roles, 'Dolap 1', () => `p${++n}`, {
    mode: 'cut',
    stockThickness: 8,
  });
  return { source, other: split.other, rows };
}

describe('splitOffProject (T292)', () => {
  it('same machine and version, chosen thickness, the excluded parts with their sizes', () => {
    const { source, other, rows } = sourceWithCabinet();
    expect(other.map((p) => [p.role, p.thickness])).toEqual([['back', 8]]);
    const out = splitOffProject(source, rows, { material: 'mdf', thickness: 8 }, AT);
    if (!out) throw new Error('rejected');
    const { project, commands } = out;
    expect(projectSchema.safeParse(project).success).toBe(true);
    expect(project.machine).toEqual(source.machine);
    expect(project.stock).toMatchObject({ material: 'mdf', thickness: 8 });
    expect(project.stock.sheet).toEqual(source.stock.sheet);
    expect(project.layout.sheets).toEqual([]);
    expect(project.parts).toHaveLength(other.length);
    project.parts.forEach((part, i) => {
      const p = other[i];
      if (!p) throw new Error('row');
      expect(part.qty).toBe(p.qty);
      expect(part.group).toBe('Dolap 1');
      expect(part.note).toBeUndefined();
      expect(part.name).toBe(roles.back);
    });
    expect(commands.map((c) => c.command)).toEqual(['setThickness', 'importCutList']);
    expect(commands.every((c) => c.actor === 'user' && c.at === AT)).toBe(true);
    expect(parseCommandLog(commands).ok).toBe(true);
  });

  it('a changed material is a command too and drops the library link', () => {
    const { source, rows } = sourceWithCabinet();
    const out = splitOffProject(source, rows, { material: 'plywood', thickness: 8 }, AT);
    if (!out) throw new Error('rejected');
    expect(out.commands.map((c) => c.command)).toEqual([
      'setMaterial',
      'setThickness',
      'importCutList',
    ]);
    expect(out.project.stock.material).toBe('plywood');
    expect(out.project.stock.libraryId).toBeUndefined();
  });

  it('no rows or a bad thickness → null', () => {
    const { source, rows } = sourceWithCabinet();
    expect(splitOffProject(source, [], { material: 'mdf', thickness: 8 }, AT)).toBeNull();
    expect(splitOffProject(source, rows, { material: 'mdf', thickness: -1 }, AT)).toBeNull();
  });
});
