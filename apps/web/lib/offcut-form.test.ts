import { describe, expect, it } from 'vitest';
import { emptyOffcutForm, offcutBody, offcutChanges, offcutFormOf } from './offcut-form';
import type { OffcutItem } from './offcuts-api';

const item: OffcutItem = {
  id: 'x',
  material: 'mdf',
  thickness: 18,
  width: 900,
  height: 600,
  grain: 0,
  sourceProjectId: null,
  status: 'available',
  createdAt: '2026-11-20T10:00:00.000Z',
};

describe('offcut form (T291)', () => {
  it('new form: MDF 18 with grain 0, no sizes yet → no body', () => {
    const v = emptyOffcutForm();
    expect(v).toMatchObject({ material: 'mdf', thickness: 18, grain: 0 });
    expect(offcutBody(v)).toBeNull();
    expect(emptyOffcutForm('acrylic').grain).toBeNull();
  });

  it('body: sizes in range; plastics never carry grain', () => {
    expect(offcutBody({ ...emptyOffcutForm(), width: 700, height: 400 })).toEqual({
      material: 'mdf',
      thickness: 18,
      width: 700,
      height: 400,
      grain: 0,
    });
    expect(
      offcutBody({ material: 'acrylic', thickness: 5, width: 300, height: 200, grain: 90 })?.grain,
    ).toBeNull();
    for (const bad of [0, -5, 10_001, Number.NaN, null]) {
      expect(offcutBody({ ...emptyOffcutForm(), width: bad, height: 400 })).toBeNull();
    }
    expect(offcutBody({ ...emptyOffcutForm(), material: ' ', width: 1, height: 1 })).toBeNull();
  });

  it('edit: round trip has no changes; only changed fields are sent', () => {
    const body = offcutBody(offcutFormOf(item));
    if (!body) throw new Error('no body');
    expect(offcutChanges(item, body)).toEqual({});
    expect(offcutChanges(item, { ...body, width: 850, grain: 90 })).toEqual({
      width: 850,
      grain: 90,
    });
  });
});
