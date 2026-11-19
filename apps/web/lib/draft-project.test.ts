import { DEFAULT_LIBRARY, defaultMachineProfile } from '@nittcam/core';
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

describe('stockHasGrain (T260)', () => {
  it('is true only for wood with a sheet grain', () => {
    const p = newProject(machine);
    expect(stockHasGrain(p.stock)).toBe(true);
    expect(stockHasGrain({ ...p.stock, sheet: { ...p.stock.sheet, grain: null } })).toBe(false);
    expect(stockHasGrain({ ...p.stock, material: 'acrylic' })).toBe(false);
  });
});
