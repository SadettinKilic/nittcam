/** Shapes of the `/api/materials` route handlers (T121), shared by server and client (D-016). */
import type { LibraryMaterial } from '@nittcam/core';

/** A library entry as the API returns it. */
export interface MaterialItem extends LibraryMaterial {
  id: string;
}

export type MaterialApiError =
  | { error: 'invalid_material'; issues: { path: string; message: string }[] }
  | { error: 'not_found' }
  | { error: 'bad_request' }
  | { error: 'server_error' };

/** Loads the company library; `null` when the request fails (callers fall back gracefully). */
export async function fetchMaterials(): Promise<MaterialItem[] | null> {
  try {
    const res = await fetch('/api/materials', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as MaterialItem[];
  } catch {
    return null;
  }
}
