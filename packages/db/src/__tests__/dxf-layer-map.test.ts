import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forCompany, type CompanyScope, type DbHandle } from '../index';
import { newCompany, openTestDb } from './helpers';

describe('DXF layer mapping as a company setting (T145)', () => {
  let handle: DbHandle;
  let a: CompanyScope;
  let b: CompanyScope;

  beforeAll(async () => {
    handle = await openTestDb();
    a = forCompany(handle.db, (await newCompany(handle, 'A')).id);
    b = forCompany(handle.db, (await newCompany(handle, 'B')).id);
  });
  afterAll(async () => handle.close());

  it('starts empty, persists per company, never leaks to another company', async () => {
    expect((await a.company.get())?.dxfLayerMap).toEqual({});
    await a.company.update({ dxfLayerMap: { KESIM: 'outside', DELIK: 'drill' } });
    expect((await a.company.get())?.dxfLayerMap).toEqual({ KESIM: 'outside', DELIK: 'drill' });
    // A fresh scope (server restart) reads the same mapping.
    const again = forCompany(handle.db, a.companyId);
    expect((await again.company.get())?.dxfLayerMap).toEqual({ KESIM: 'outside', DELIK: 'drill' });
    expect((await b.company.get())?.dxfLayerMap).toEqual({});
  });
});
