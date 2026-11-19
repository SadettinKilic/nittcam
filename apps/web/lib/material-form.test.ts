import { DEFAULT_LIBRARY } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { draftFrom, emptyDraft, toMaterial } from './material-form';

describe('material form model (T121)', () => {
  it('round-trips every seeded entry', () => {
    for (const m of DEFAULT_LIBRARY)
      expect(toMaterial(draftFrom(m))).toEqual({ ok: true, material: m });
  });

  it('ignores empty rows and sorts thicknesses', () => {
    const d = {
      ...emptyDraft(),
      name: 'MDF',
      thicknesses: [18, null, 8],
      sheets: [
        { width: 2440, height: 1220, qty: null },
        { width: null, height: 5, qty: null },
      ],
    };
    const r = toMaterial(d);
    expect(r).toMatchObject({
      ok: true,
      material: { thicknesses: [8, 18], sheetSizes: [{ width: 2440, height: 1220 }] },
    });
  });

  it('reports the fields to fix', () => {
    const r = toMaterial({
      ...emptyDraft(),
      name: ' ',
      thicknesses: [null],
      sheets: [],
      grainOn: true,
      grain: null,
    });
    expect(r).toEqual({
      ok: false,
      errors: { name: true, thicknesses: true, sheets: true, grain: true },
    });
  });

  it('drops the grain for plastics', () => {
    const r = toMaterial({
      ...emptyDraft(),
      name: 'Akrilik',
      kind: 'acrylic',
      grainOn: true,
      grain: 45,
    });
    expect(r).toMatchObject({ ok: true, material: { grain: null } });
  });
});

describe('material form sheet quantity (T164)', () => {
  it('keeps a stock quantity per size; empty = no limit', () => {
    const r = toMaterial({
      ...emptyDraft(),
      name: 'MDF',
      sheets: [
        { width: 2800, height: 2070, qty: 3 },
        { width: 2440, height: 1220, qty: null },
      ],
    });
    expect(r).toMatchObject({
      ok: true,
      material: {
        sheetSizes: [
          { width: 2800, height: 2070, qty: 3 },
          { width: 2440, height: 1220 },
        ],
      },
    });
    if (r.ok) {
      expect(r.material.sheetSizes[1]).not.toHaveProperty('qty');
      expect(toMaterial(draftFrom(r.material))).toEqual(r);
    }
  });

  it('rejects a zero or fractional quantity', () => {
    for (const qty of [0, 1.5]) {
      const r = toMaterial({
        ...emptyDraft(),
        name: 'MDF',
        sheets: [{ width: 2800, height: 2070, qty }],
      });
      expect(r).toEqual({ ok: false, errors: { sheets: true } });
    }
  });
});
