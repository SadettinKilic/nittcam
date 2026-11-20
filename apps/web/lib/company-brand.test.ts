import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCompanyBrand,
  loadCompanyBrand,
  resetCompanyBrand,
  setCompanyBrand,
} from './company-brand';

const settings = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe('company brand store (T301)', () => {
  afterEach(() => {
    resetCompanyBrand();
    vi.unstubAllGlobals();
  });

  it('loads the saved name and logo', async () => {
    vi.stubGlobal('fetch', settings({ name: 'Şahin Ağaç', logoUrl: '/api/settings/logo?v=1' }));
    await loadCompanyBrand();
    expect(getCompanyBrand()).toEqual({ name: 'Şahin Ağaç', logoUrl: '/api/settings/logo?v=1' });
  });

  it('a save from Ayarlar wins over an older read', async () => {
    setCompanyBrand({ name: 'Yeni ad', logoUrl: null });
    vi.stubGlobal('fetch', settings({ name: 'Eski ad', logoUrl: '/x' }));
    await loadCompanyBrand();
    expect(getCompanyBrand()).toEqual({ name: 'Yeni ad', logoUrl: null });
  });

  it('a logo change keeps the name; a read fills a missing name', async () => {
    setCompanyBrand({ logoUrl: '/logo?v=2' });
    vi.stubGlobal('fetch', settings({ name: 'Atölye', logoUrl: '/logo?v=1' }));
    await loadCompanyBrand();
    expect(getCompanyBrand()).toEqual({ name: 'Atölye', logoUrl: '/logo?v=2' });
    setCompanyBrand({ logoUrl: null });
    expect(getCompanyBrand()).toEqual({ name: 'Atölye', logoUrl: null });
  });

  it('a failed read keeps the fallback (nothing stored)', async () => {
    vi.stubGlobal('fetch', settings({}, false));
    await loadCompanyBrand();
    expect(getCompanyBrand()).toBeNull();
  });
});
