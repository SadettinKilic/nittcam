import { DEFAULT_LIBRARY, defaultMachineProfile, findMaterialParams } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { firstUsableLibraryStock, newProject, stockHasGrain } from './draft-project';

const library = DEFAULT_LIBRARY.map((m, i) => ({ ...m, id: `lib-${i}` }));
const machine = { id: 'm1', version: 3, profile: defaultMachineProfile() };

describe('new project stock (T259, D-045)', () => {
  it('starts on the first library entry the machine can cut', () => {
    const first = firstUsableLibraryStock(library, machine.profile);
    expect(first).toBeDefined();
    const p = newProject(machine, library);
    expect(p.stock.libraryId).toBe(first?.entry.id);
    expect(p.stock.material).toBe(first?.entry.kind);
    expect(p.stock.thickness).toBe(first?.thickness);
    expect(p.stock.sheet.grain).toBe(first?.entry.grain);
    expect(p.machine).toEqual({ machineId: 'm1', profileVersion: 3 });
  });

  it('skips entries without a parameter set', () => {
    const profile = { materials: machine.profile.materials.filter((m) => m.material !== 'mdf') };
    const first = firstUsableLibraryStock(library, profile);
    expect(first?.entry.kind).not.toBe('mdf');
    expect(firstUsableLibraryStock(library, { materials: [] })).toBeUndefined();
  });

  it('falls back to the profile set without a library', () => {
    const p = newProject(machine);
    expect(p.stock.libraryId).toBeUndefined();
    expect(p.stock.sheet.grain).toBe(0);
  });
});

const mdfSet = machine.profile.materials[0];
if (!mdfSet) throw new Error('example profile has no set');

describe('new project never defaults to an unverified set (T271)', () => {
  const base = defaultMachineProfile();
  const first = mdfSet;
  const other = { ...first, thickness: 16 };
  const mark = <T extends object>(m: T) => ({ ...m, unverified: true as const });
  it('skips an unverified first set for the first verified one', () => {
    const profile = { ...base, materials: [mark(first), other] };
    const second = other;
    const p = newProject({ id: 'm1', version: 1, profile });
    expect([p.stock.material, p.stock.thickness]).toEqual([second.material, second.thickness]);
  });
  it('with no verified set, keeps the first (unconfirmed) one, which blocks G-code', () => {
    const profile = { ...base, materials: [mark(first), mark(other)] };
    const p = newProject({ id: 'm1', version: 1, profile });
    expect([p.stock.material, p.stock.thickness]).toEqual([first.material, first.thickness]);
    expect(findMaterialParams(profile, p.stock)?.unverified).toBe(true);
    // the library default never picks an unconfirmed set either
    expect(firstUsableLibraryStock(library, profile)).toBeUndefined();
  });
});

describe('default entry tie-break (D-046)', () => {
  const sorted = [...library].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const exampleish = {
    materials: (['mdf', 'melamine', 'plywood'] as const).map((material) => ({
      ...mdfSet,
      material,
    })),
  };

  it('prefers MDF over alphabetical order', () => {
    expect(sorted[0]?.kind).toBe('acrylic');
    expect(firstUsableLibraryStock(sorted, exampleish)?.entry.kind).toBe('mdf');
  });

  it('then Melamin, then Kontrplak, then the first cuttable entry', () => {
    const noMdf = { materials: exampleish.materials.filter((m) => m.material !== 'mdf') };
    expect(firstUsableLibraryStock(sorted, noMdf)?.entry.kind).toBe('melamine');
    const plyOnly = { materials: exampleish.materials.filter((m) => m.material === 'plywood') };
    expect(firstUsableLibraryStock(sorted, plyOnly)?.entry.kind).toBe('plywood');
    const acrylic = {
      materials: [{ ...mdfSet, material: 'acrylic' as const, thickness: 5 }],
    };
    expect(firstUsableLibraryStock(sorted, acrylic)?.entry.kind).toBe('acrylic');
  });
});

describe('stockHasGrain (T260)', () => {
  it('is true only for wood with a sheet grain', () => {
    const p = newProject(machine);
    expect(stockHasGrain(p.stock)).toBe(true);
    expect(stockHasGrain({ ...p.stock, sheet: { ...p.stock.sheet, grain: null } })).toBe(false);
    expect(stockHasGrain({ ...p.stock, material: 'acrylic' })).toBe(false);
  });
});

describe('newProject with company defaults (T182)', () => {
  it('starts with the company gap, margin, tabs, lead-in, direction and edge-band mode', () => {
    const p = newProject(undefined, [], {
      gap: 3,
      margin: 12,
      tabMode: 'off',
      leadIn: 'line',
      direction: 'conventional',
      dimensionMode: 'finished',
    });
    expect(p.nesting).toMatchObject({ gap: 3, margin: 12 });
    expect(p.cutting.tabs.auto).toBe(false);
    expect(p.cutting.skin?.thickness).toBeGreaterThan(0);
    expect(p.cutting).toMatchObject({ leadIn: 'line', direction: 'conventional' });
    expect(p.settings.dimensionMode).toBe('finished');
  });

  it('without defaults it is the built-in start', () => {
    const p = newProject();
    expect(p.nesting).toMatchObject({ gap: 8, margin: 10 });
    expect(p.cutting).toEqual({ tabs: { auto: true }, leadIn: 'arc', direction: 'climb' });
  });
});
