import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { usableOffcuts, type OffcutRow } from '../nesting/offcuts';
import { projectOf } from '../toolpath/toolpath.testing';
import { DEFAULT_LIBRARY, libraryMaterialSchema, stockFromLibrary } from './library';
import { cleanProps, propsFieldsOf, propsHeadSuffix, propsMatch } from './material-props-fields';

// T350: kind-specific library / stock / offcut properties.

describe('material props (T350)', () => {
  it('fields per family: aluminium alloy…, ACM colour code…, wood and plastic none', () => {
    expect(propsFieldsOf('aluminium')).toEqual(['alloy', 'temper', 'finish', 'film']);
    expect(propsFieldsOf('acm')).toEqual(['colorCode', 'metallic', 'skin']);
    for (const k of ['mdf', 'plywood', 'acrylic', 'pvc'] as const)
      expect(propsFieldsOf(k)).toEqual([]);
    expect(propsFieldsOf(null)).toEqual([]);
    expect(cleanProps('acm', { alloy: '5754', colorCode: 'RAL 9006', skin: 0.5 })).toEqual({
      colorCode: 'RAL 9006',
      skin: 0.5,
    });
    expect(cleanProps('mdf', { alloy: '5754' })).toEqual({});
  });

  it('library schema: props default {} and drop fields of another kind; no metal in the seed', () => {
    const base = {
      name: 'X',
      thicknesses: [3],
      tone: 'aluminium',
      grain: null,
      sheetSizes: [{ width: 2000, height: 1000 }],
    };
    const mdf = libraryMaterialSchema.parse({ ...base, kind: 'mdf', tone: 'natural' });
    expect(mdf.props).toEqual({});
    const alu = libraryMaterialSchema.parse({
      ...base,
      kind: 'aluminium',
      props: { alloy: '5754', finish: 'brushed', metallic: true },
    });
    expect(alu.props).toEqual({ alloy: '5754', finish: 'brushed' });
    expect(
      libraryMaterialSchema.safeParse({ ...base, kind: 'acm', props: { skin: 5 } }).success,
    ).toBe(false);
    expect(libraryMaterialSchema.safeParse({ ...base, kind: 'acm', tone: 'silver' }).success).toBe(
      true,
    );
    expect(DEFAULT_LIBRARY.every((m) => m.kind !== 'acm' && m.kind !== 'aluminium')).toBe(true);
    // the stock takes the props of the entry (none for wood)
    const current = { thickness: 3, sheet: { width: 2000, height: 1000 } };
    expect(stockFromLibrary(alu, current).props).toEqual({ alloy: '5754', finish: 'brushed' });
    expect(stockFromLibrary(mdf, current)).not.toHaveProperty('props');
  });

  it('applyLibraryMaterial stores the props; setMaterial drops them', () => {
    const p = projectOf({ parts: [{ id: 'a', w: 300, h: 200 }] });
    const picked = applyCommand(p, 'applyLibraryMaterial', {
      libraryId: 'lib1',
      material: 'aluminium',
      thickness: 3,
      width: 2000,
      height: 1000,
      grain: null,
      props: { alloy: '5754' },
    });
    if (!picked.ok) throw new Error(picked.error.message);
    expect(picked.project.stock.props).toEqual({ alloy: '5754' });
    const hand = applyCommand(picked.project, 'setMaterial', { material: 'mdf' });
    if (!hand.ok) throw new Error(hand.error.message);
    expect(hand.project.stock).not.toHaveProperty('props');
  });

  it('offcut match: alloy / colour code only when both sides have one', () => {
    expect(propsMatch({ alloy: '5754' }, { alloy: ' 5754' })).toBe(true);
    expect(propsMatch({ alloy: '5754' }, { alloy: '6082' })).toBe(false);
    expect(propsMatch({ alloy: '5754' }, {})).toBe(true);
    expect(propsMatch(undefined, { colorCode: 'RAL 9006' })).toBe(true);
    expect(propsMatch({ colorCode: 'ral  9006' }, { colorCode: 'RAL 9006' })).toBe(true);
    expect(propsMatch({ colorCode: 'RAL 9016' }, { colorCode: 'RAL 9006' })).toBe(false);
    const p = projectOf({ parts: [{ id: 'a', w: 300, h: 200 }] });
    const stock = {
      ...p.stock,
      material: 'aluminium',
      thickness: 3,
      props: { alloy: '5754' },
      sheet: { ...p.stock.sheet, grain: null },
    };
    const row = (id: string, props?: OffcutRow['props']): OffcutRow => ({
      id,
      material: 'aluminium',
      thickness: 3,
      width: 600,
      height: 500,
      grain: null,
      status: 'available',
      ...(props ? { props } : {}),
    });
    const ids = usableOffcuts({ stock }, [
      row('same', { alloy: '5754' }),
      row('other', { alloy: '6082' }),
      row('none'),
    ]).map((o) => o.id);
    expect(ids.sort()).toEqual(['none', 'same']);
  });

  it('header suffix: the aluminium alloy only', () => {
    expect(propsHeadSuffix('aluminium', { alloy: '5754' })).toBe('5754');
    expect(propsHeadSuffix('acm', { colorCode: 'RAL 9006' })).toBe('');
    expect(propsHeadSuffix('mdf', undefined)).toBe('');
  });
});
