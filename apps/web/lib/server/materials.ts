import type { MaterialKind, MaterialTone } from '@nittcam/core';
import { InvalidMaterial, NotFound, type MaterialRow } from '@nittcam/db';
import { NextResponse } from 'next/server';
import { isRepoError } from './errors';
import type { MaterialApiError, MaterialItem } from '../materials-api';

export function toItem(row: MaterialRow): MaterialItem {
  return {
    id: row.id,
    kind: row.kind as MaterialKind,
    name: row.name,
    thicknesses: row.thicknesses,
    tone: row.tone as MaterialTone,
    grain: row.grain,
    sheetSizes: row.sheetSizes,
  };
}

/** Sorts by name with Turkish collation (İ, ı, ş, ğ in the right place). */
export function sortItems(items: MaterialItem[]): MaterialItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

export function materialError(body: MaterialApiError, status: number) {
  return NextResponse.json(body, { status });
}

/** Reads a JSON body `{ material }`; `undefined` when the body is not JSON or has none. */
export async function readMaterial(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && 'material' in body) return body.material;
  } catch {
    // fall through
  }
  return undefined;
}

export function handleMaterialError(err: unknown) {
  if (isRepoError(err, InvalidMaterial, 'InvalidMaterial')) {
    return materialError({ error: 'invalid_material', issues: err.issues }, 400);
  }
  if (isRepoError(err, NotFound, 'NotFound')) return materialError({ error: 'not_found' }, 404);
  console.error(err);
  return materialError({ error: 'server_error' }, 500);
}
