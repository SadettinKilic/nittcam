import { describe, expect, it } from 'vitest';
import { OPERATION_TOOL_KINDS, OPERATION_TOOL_TYPES } from '../toolpath/op-tools';
import { SKIN_BOUNDS, TAB_BOUNDS, TAB_DEFAULTS } from '../toolpath/tabs';
import { MATERIAL_KINDS, materialHasGrain } from './material';
import { MATERIAL_FAMILIES, MATERIAL_TRAITS, kindsOfFamily, traitsOf } from './material-traits';

const WOOD = ['mdf', 'plywood', 'melamine', 'solidWood'] as const;
const PLASTIC = ['acrylic', 'pvc'] as const;
const KINDS_AND_UNKNOWN = [...MATERIAL_KINDS, null] as const;

describe('material traits (T341)', () => {
  it('has one row per material kind', () => {
    expect(Object.keys(MATERIAL_TRAITS).sort()).toEqual([...MATERIAL_KINDS].sort());
  });

  // Compares against the live module constants: changing any of them fails here.
  it.each(KINDS_AND_UNKNOWN)('%s carries the live tab, skin and small-part constants', (kind) => {
    const t = traitsOf(kind);
    expect(t.tabs.defaults).toEqual({
      count: TAB_DEFAULTS.count,
      width: TAB_DEFAULTS.width,
      materialLeft: TAB_DEFAULTS.materialLeft,
      smallPartMinCount: TAB_DEFAULTS.smallPartMinCount,
    });
    expect(t.tabs.bounds).toEqual({ ...TAB_BOUNDS });
    expect(t.skin).toEqual({ ...SKIN_BOUNDS });
    expect(t.smallPart).toEqual({
      area: TAB_DEFAULTS.smallPartArea,
      minSide: TAB_DEFAULTS.smallPartMinSide,
    });
  });

  it.each(KINDS_AND_UNKNOWN)('%s carries the live operation tool types', (kind) => {
    const t = traitsOf(kind);
    expect(Object.keys(t.toolTypes).sort()).toEqual([...OPERATION_TOOL_KINDS].sort());
    for (const op of OPERATION_TOOL_KINDS)
      expect(t.toolTypes[op]).toEqual(OPERATION_TOOL_TYPES[op]);
  });

  it('gives wood an axial grain and plastics and unknown kinds no direction', () => {
    for (const k of WOOD)
      expect(traitsOf(k).direction).toMatchObject({ kind: 'axial', defaultOn: true });
    for (const k of PLASTIC) expect(traitsOf(k).direction.kind).toBe('none');
    expect(traitsOf(null).direction.kind).toBe('none');
  });

  it('materialHasGrain keeps its old answer for every kind', () => {
    const old = (k: (typeof KINDS_AND_UNKNOWN)[number]) =>
      k === 'mdf' || k === 'plywood' || k === 'melamine' || k === 'solidWood';
    for (const k of KINDS_AND_UNKNOWN) expect(materialHasGrain(k)).toBe(old(k));
  });

  it('unknown kinds look like MDF, as the 3D preview always did', () => {
    expect(traitsOf(null).look).toEqual(MATERIAL_TRAITS.mdf.look);
    expect(traitsOf(null).family).toBe('woodBoard');
  });

  it('groups the kinds by family in menu order, today wood and plastic', () => {
    expect(MATERIAL_FAMILIES).toEqual(['woodBoard', 'plastic']);
    expect(kindsOfFamily('woodBoard')).toEqual([...WOOD]);
    expect(kindsOfFamily('plastic')).toEqual([...PLASTIC]);
    for (const k of MATERIAL_KINDS) expect(MATERIAL_TRAITS[k].release).toBe('released');
  });

  it('locks the six rows', () => {
    expect(MATERIAL_TRAITS).toMatchSnapshot();
  });
});
