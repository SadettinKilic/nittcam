'use client';

/**
 * The company name and logo shown in the app shell (T301, CTO #12 E2). The layout is static, so
 * the shell starts with the fallback name and reads `/api/settings` once per page load; Ayarlar
 * publishes a saved name or logo here, so the sidebar updates without a reload.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { CompanySettings } from './settings-api';

export interface CompanyBrand {
  name: string;
  logoUrl: string | null;
}

let brand: CompanyBrand | null = null;
let requested = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replaces the shown brand (fields left out keep their value). */
export function setCompanyBrand(patch: Partial<CompanyBrand>): void {
  brand = {
    name: patch.name ?? brand?.name ?? '',
    logoUrl: patch.logoUrl !== undefined ? patch.logoUrl : (brand?.logoUrl ?? null),
  };
  for (const l of listeners) l();
}

/** Test hook: forget the loaded brand. */
export function resetCompanyBrand(): void {
  brand = null;
  requested = false;
}

/** The brand read or saved so far; null before either. */
export function getCompanyBrand(): CompanyBrand | null {
  return brand;
}

/** Reads the saved name and logo once (exported for tests). */
export async function loadCompanyBrand(): Promise<void> {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as Partial<CompanySettings>;
    // A save from Ayarlar that landed first wins over this (older) read.
    if (typeof body.name !== 'string' || !body.name) return;
    if (brand === null) setCompanyBrand({ name: body.name, logoUrl: body.logoUrl ?? null });
    else if (!brand.name) setCompanyBrand({ name: body.name });
  } catch {
    // Offline or server error: the fallback name stays.
  }
}

/** The company brand for the shell; `fallback` until the settings have been read. */
export function useCompanyBrand(fallback: string): CompanyBrand {
  const current = useSyncExternalStore(
    subscribe,
    () => brand,
    () => null,
  );
  useEffect(() => {
    if (requested) return;
    requested = true;
    void loadCompanyBrand();
  }, []);
  if (!current) return { name: fallback, logoUrl: null };
  return current.name ? current : { ...current, name: fallback };
}
