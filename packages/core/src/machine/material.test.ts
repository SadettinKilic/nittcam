import { describe, expect, it } from 'vitest';
import { buildToolpath } from '../toolpath';
import { nestingToolDiameter } from '../nesting/tool';
import { validateProject } from '../validate';
import type { Project } from '../schema';
import {
  exampleMachineProfile,
  findMaterialParams,
  machineProfileSchema,
  materialHasGrain,
  materialKindOf,
  MATERIAL_KINDS,
  normalizeMaterialId,
  profileThicknesses,
} from './index';

describe('materialKindOf (D-029)', () => {
  it('maps every kind to itself', () => {
    for (const kind of MATERIAL_KINDS) expect(materialKindOf(kind)).toBe(kind);
  });

  it.each([
    ['MDF', 'mdf'],
    ['mdf ', 'mdf'],
    ['Kontrplak', 'plywood'],
    ['melamine-chipboard', 'melamine'],
    ['Melamin kaplı sunta', 'melamine'],
    ['SUNTA', 'melamine'],
    ['Masif ahşap', 'solidWood'],
    ['solid_wood', 'solidWood'],
    ['Akrilik', 'acrylic'],
    ['Pleksi', 'acrylic'],
    ['PVC', 'pvc'],
    ['Foreks', 'pvc'],
  ] as const)('%s → %s', (id, kind) => {
    expect(materialKindOf(id)).toBe(kind);
  });

  it('returns null for unknown materials', () => {
    expect(materialKindOf('mermer')).toBeNull();
    expect(materialKindOf('')).toBeNull();
    expect(materialKindOf('draft')).toBeNull();
  });

  it('folds Turkish letters and drops separators', () => {
    expect(normalizeMaterialId('Çam AĞAÇ-ışık İş')).toBe('camagacisikis');
  });

  it('grain only for wood and laminated boards', () => {
    expect(MATERIAL_KINDS.filter(materialHasGrain)).toEqual([
      'mdf',
      'plywood',
      'melamine',
      'solidWood',
      // T346: ACM film arrow (directed) and aluminium rolling direction (axial, default off).
      'acm',
      'aluminium',
    ]);
    expect(materialHasGrain(null)).toBe(false);
  });

  it('T346: ACM and aluminium aliases', () => {
    for (const a of ['ACM', 'kompozit', 'Alüminyum kompozit', 'Dibond', 'alucobond'])
      expect(materialKindOf(a)).toBe('acm');
    for (const a of ['alüminyum', 'Aluminyum', 'alu', 'aluminium'])
      expect(materialKindOf(a)).toBe('aluminium');
  });
});

describe('findMaterialParams', () => {
  const profile = exampleMachineProfile();

  it('resolves the example MDF 18 set for every spelling', () => {
    for (const material of ['mdf', 'MDF', 'Mdf']) {
      expect(findMaterialParams(profile, { material, thickness: 18 })?.tool).toBe(2);
    }
    expect(findMaterialParams(profile, { material: 'mdf', thickness: 18.0004 })).toBeDefined();
  });

  it('is undefined for another thickness, another kind or an unknown id', () => {
    expect(findMaterialParams(profile, { material: 'mdf', thickness: 16 })).toBeUndefined();
    expect(findMaterialParams(profile, { material: 'pvc', thickness: 18 })).toBeUndefined();
    expect(findMaterialParams(profile, { material: 'mermer', thickness: 18 })).toBeUndefined();
  });

  it('lists the thicknesses per kind', () => {
    expect(profileThicknesses(profile, 'mdf')).toEqual([18]);
    expect(profileThicknesses(profile, 'pvc')).toEqual([]);
  });

  it('nesting picks the suggested tool through the mapping', () => {
    expect(nestingToolDiameter(profile, { material: 'MDF', thickness: 18 })).toBe(8);
  });
});

function project(material: string, thickness = 18): Project {
  return {
    schemaVersion: 2,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material,
      thickness,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'a',
        name: 'A',
        qty: 1,
        grain: { mode: 'free', angle: 0 },
        kind: 'rect',
        params: { w: 400, h: 300, r: 0 },
        inners: [],
        holes: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: {
      sheets: [{ placements: [{ partId: 'a', index: 0, x: 10, y: 10, rot: 0, locked: false }] }],
    },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as Project;
}

describe('NO_CUTTING_PARAMS and SHEET_LARGER_THAN_TABLE rules', () => {
  const machine = exampleMachineProfile();

  it('no issue for a mapped material with a parameter set', () => {
    const codes = validateProject(project('MDF'), { machine }).map((i) => i.code);
    expect(codes).not.toContain('NO_CUTTING_PARAMS');
    expect(codes).not.toContain('SHEET_LARGER_THAN_TABLE');
  });

  it('error when the machine has no set for the stock', () => {
    const issues = validateProject(project('pvc'), { machine });
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'NO_CUTTING_PARAMS',
        severity: 'error',
        path: 'stock.material',
      }),
    );
    expect(validateProject(project('mdf', 12), { machine }).map((i) => i.code)).toContain(
      'NO_CUTTING_PARAMS',
    );
  });

  it('skipped without a machine', () => {
    expect(validateProject(project('pvc')).map((i) => i.code)).not.toContain('NO_CUTTING_PARAMS');
  });

  it('warns when the sheet does not fit the table', () => {
    const small = { ...machine, table: { width: 2000, depth: 1000 } };
    expect(validateProject(project('mdf'), { machine: small })).toContainEqual(
      expect.objectContaining({ code: 'SHEET_LARGER_THAN_TABLE', severity: 'warning' }),
    );
  });

  it('the toolpath resolves cutting params through the mapping', () => {
    const ok = buildToolpath(project('MDF'), machine);
    expect(ok.errors.map((e) => e.code)).not.toContain('NO_CUTTING_PARAMS');
    const missing = buildToolpath(project('pvc'), machine);
    expect(missing.errors.map((e) => e.code)).toContain('NO_CUTTING_PARAMS');
  });
});

describe('CUTTING_PARAMS_UNVERIFIED (T265)', () => {
  const base = exampleMachineProfile();
  const mdf = base.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
  const marked = {
    ...base,
    materials: base.materials.map((m) => (m === mdf ? { ...m, unverified: true as const } : m)),
  };

  it('the schema keeps the mark and older profiles stay valid', () => {
    expect(machineProfileSchema.parse(marked).materials.some((m) => m.unverified)).toBe(true);
    expect(machineProfileSchema.parse(base).materials.every((m) => !m.unverified)).toBe(true);
  });

  it('validation reports an error for an unconfirmed set, none for a confirmed one', () => {
    expect(validateProject(project('MDF'), { machine: marked })).toContainEqual(
      expect.objectContaining({ code: 'CUTTING_PARAMS_UNVERIFIED', severity: 'error' }),
    );
    const codes = validateProject(project('MDF'), { machine: base }).map((i) => i.code);
    expect(codes).not.toContain('CUTTING_PARAMS_UNVERIFIED');
    // a missing set stays NO_CUTTING_PARAMS only
    const pvc = validateProject(project('pvc'), { machine: marked }).map((i) => i.code);
    expect(pvc).toContain('NO_CUTTING_PARAMS');
    expect(pvc).not.toContain('CUTTING_PARAMS_UNVERIFIED');
  });

  it('the toolpath refuses unconfirmed starting values', () => {
    const r = buildToolpath(project('MDF'), marked);
    expect(r.errors.map((e) => e.code)).toEqual(['CUTTING_PARAMS_UNVERIFIED']);
    expect(buildToolpath(project('MDF'), base).errors.map((e) => e.code)).not.toContain(
      'CUTTING_PARAMS_UNVERIFIED',
    );
  });
});
