import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forCompany, type CompanyScope, type DbHandle } from '../index';
import { newCompany, openTestDb } from './helpers';

// T350: materials.props and offcuts.props (jsonb, default {}), per company.

const alu = {
  kind: 'aluminium',
  name: 'Alüminyum 5754',
  thicknesses: [3],
  tone: 'aluminium',
  grain: null,
  sheetSizes: [{ width: 2000, height: 1000 }],
  props: { alloy: '5754', temper: 'H22', colorCode: 'RAL 9006' },
};

describe('material and offcut props (T350)', () => {
  let handle: DbHandle;
  let a: CompanyScope;
  let b: CompanyScope;

  beforeAll(async () => {
    handle = await openTestDb();
    a = forCompany(handle.db, (await newCompany(handle, 'A')).id);
    b = forCompany(handle.db, (await newCompany(handle, 'B')).id);
  });
  afterAll(async () => handle.close());

  it('stores only the kind fields; an MDF entry saves with empty props as before', async () => {
    const row = await a.materials.create(alu);
    expect(row.props).toEqual({ alloy: '5754', temper: 'H22' });
    const mdf = await a.materials.create({ ...alu, kind: 'mdf', name: 'MDF', props: undefined });
    expect(mdf.props).toEqual({});
    // an update keeps the props; a kind change drops the ones the new kind does not use
    expect((await a.materials.update(row.id, { name: 'Alu' }))?.props).toEqual({
      alloy: '5754',
      temper: 'H22',
    });
    expect((await a.materials.update(row.id, { kind: 'acm' }))?.props).toEqual({});
    // tenant isolation
    expect(await b.materials.get(row.id)).toBeNull();
    expect(await b.materials.update(row.id, { props: { alloy: '6082' } })).toBeNull();
  });

  it('offcuts keep their props and default to {}', async () => {
    const o = await a.offcuts.create({
      material: 'aluminium',
      thickness: 3,
      width: 500,
      height: 400,
      grain: null,
      props: { alloy: '5754' },
    });
    expect(o.props).toEqual({ alloy: '5754' });
    const plain = await a.offcuts.create({
      material: 'mdf',
      thickness: 18,
      width: 500,
      height: 400,
      grain: null,
    });
    expect(plain.props).toEqual({});
    expect(await b.offcuts.get(o.id)).toBeNull();
  });
});
