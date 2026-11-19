import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { parseProject, projectSchema } from '../schema';
import {
  DEFAULT_LIBRARY,
  exampleMachineProfile,
  libraryMaterialSchema,
  libraryParamLinks,
  materialKindOf,
  stockFromLibrary,
} from './index';
import fixture from '../schema/__fixtures__/shelf-set.json';

const base = {
  kind: 'mdf',
  name: 'MDF',
  thicknesses: [18],
  tone: 'natural',
  grain: null,
  sheetSizes: [{ width: 2800, height: 2070 }],
} as const;

describe('libraryMaterialSchema (T121)', () => {
  it('accepts the default library', () => {
    for (const m of DEFAULT_LIBRARY) expect(libraryMaterialSchema.parse(m)).toEqual(m);
  });

  it('seeds MDF 18, Kontrplak 18, Melamin 18 and Akrilik 5 with 2800×2070 and 2440×1220', () => {
    expect(DEFAULT_LIBRARY.map((m) => [m.name, m.thicknesses])).toEqual([
      ['MDF', [18]],
      ['Kontrplak', [18]],
      ['Melamin', [18]],
      ['Akrilik', [5]],
    ]);
    for (const m of DEFAULT_LIBRARY) {
      expect(m.sheetSizes).toEqual([
        { width: 2800, height: 2070 },
        { width: 2440, height: 1220 },
      ]);
      expect(materialKindOf(m.name)).toBe(m.kind);
    }
  });

  it('sorts thicknesses and drops duplicates (also duplicate sheet sizes)', () => {
    const m = libraryMaterialSchema.parse({
      ...base,
      thicknesses: [18, 8, 18, 12],
      sheetSizes: [
        { width: 2440, height: 1220 },
        { width: 2440, height: 1220 },
      ],
    });
    expect(m.thicknesses).toEqual([8, 12, 18]);
    expect(m.sheetSizes).toHaveLength(1);
  });

  it.each([
    ['empty name', { name: '  ' }],
    ['no thickness', { thicknesses: [] }],
    ['negative thickness', { thicknesses: [-1] }],
    ['no sheet size', { sheetSizes: [] }],
    ['zero sheet width', { sheetSizes: [{ width: 0, height: 100 }] }],
    ['grain 180', { grain: 180 }],
    ['unknown kind', { kind: 'marble' }],
    ['unknown tone', { tone: 'pink' }],
    ['extra key', { feed: 6000 }],
  ])('rejects %s', (_label, patch) => {
    expect(libraryMaterialSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});

describe('libraryParamLinks', () => {
  it('links each thickness to the profile set of the same kind, or none', () => {
    const profile = exampleMachineProfile();
    const links = libraryParamLinks({ kind: 'mdf', thicknesses: [18, 99] }, profile);
    expect(links[0]?.params?.material).toBe('mdf');
    expect(links[0]?.params?.thickness).toBe(18);
    expect(links[1]).toEqual({ thickness: 99, params: undefined });
  });
});

describe('stockFromLibrary + applyLibraryMaterial', () => {
  const lib = libraryMaterialSchema.parse({
    ...base,
    kind: 'plywood',
    thicknesses: [12, 18],
    grain: 90,
    sheetSizes: [
      { width: 2440, height: 1220 },
      { width: 2800, height: 2070 },
    ],
  });

  it('keeps the current thickness / sheet when the entry has them', () => {
    expect(stockFromLibrary(lib, { thickness: 18, sheet: { width: 2800, height: 2070 } })).toEqual({
      material: 'plywood',
      thickness: 18,
      width: 2800,
      height: 2070,
      grain: 90,
    });
  });

  it('falls back to the first thickness and size', () => {
    expect(stockFromLibrary(lib, { thickness: 5, sheet: { width: 1, height: 1 } })).toEqual({
      material: 'plywood',
      thickness: 12,
      width: 2440,
      height: 1220,
      grain: 90,
    });
  });

  it('sets the whole stock in one command and setMaterial forgets the entry', () => {
    const parsed = parseProject(fixture);
    if (!parsed.ok) throw new Error('fixture');
    const project = parsed.project;
    const pick = stockFromLibrary(lib, project.stock);
    const r = applyCommand(project, 'applyLibraryMaterial', { libraryId: 'lib-1', ...pick });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.project.stock).toMatchObject({
      libraryId: 'lib-1',
      material: 'plywood',
      thickness: pick.thickness,
      sheet: { width: pick.width, height: pick.height, grain: 90 },
    });
    expect(projectSchema.parse(r.project)).toEqual(r.project);
    const r2 = applyCommand(r.project, 'setMaterial', { material: 'mdf' });
    if (!r2.ok) throw new Error(r2.error.message);
    expect(r2.project.stock.libraryId).toBeUndefined();
  });
});
