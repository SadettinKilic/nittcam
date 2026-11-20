/** Offcut stock (T168): validation, mapping and the "used" marking after an export. */
import { usedOffcutIds, type Project } from '@nittcam/core';
import type { CompanyScope } from '@nittcam/db';
import { NextResponse } from 'next/server';
import type { NewOffcut, OffcutApiError, OffcutItem, OffcutStatus } from '../offcuts-api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly OffcutStatus[] = ['available', 'reserved', 'used'];
const isMm = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10_000;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const KEYS = new Set(['material', 'thickness', 'width', 'height', 'grain', 'sourceProjectId']);

/** One new offcut, strictly checked; null when anything is off. */
export function readNewOffcut(v: unknown): NewOffcut | null {
  if (!isObject(v) || Object.keys(v).some((k) => !KEYS.has(k))) return null;
  const { material, thickness, width, height, grain, sourceProjectId } = v;
  if (typeof material !== 'string' || material.trim() === '' || material.length > 64) return null;
  if (!isMm(thickness) || !isMm(width) || !isMm(height)) return null;
  if (grain !== 0 && grain !== 90 && grain !== null) return null;
  if (
    sourceProjectId !== undefined &&
    sourceProjectId !== null &&
    (typeof sourceProjectId !== 'string' || !UUID.test(sourceProjectId))
  ) {
    return null;
  }
  return { material: material.trim(), thickness, width, height, grain, sourceProjectId };
}

/** `{ offcuts: NewOffcut[] }` with 1–50 entries; null when invalid. */
export function readCreateBody(body: unknown): NewOffcut[] | null {
  if (!isObject(body) || Object.keys(body).length !== 1 || !Array.isArray(body['offcuts'])) {
    return null;
  }
  const list = body['offcuts'] as unknown[];
  if (list.length < 1 || list.length > 50) return null;
  const out: NewOffcut[] = [];
  for (const o of list) {
    const r = readNewOffcut(o);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

/** `{ status }`; null when invalid. */
export function readStatus(body: unknown): OffcutStatus | null {
  if (!isObject(body) || Object.keys(body).length !== 1) return null;
  const s = body['status'];
  return STATUSES.find((x) => x === s) ?? null;
}

interface OffcutRowLike {
  id: string;
  material: string;
  thickness: number;
  width: number;
  height: number;
  grain: number | null;
  sourceProjectId: string | null;
  status: OffcutStatus;
  createdAt: Date;
}

export function toOffcutItem(row: OffcutRowLike): OffcutItem {
  return {
    id: row.id,
    material: row.material,
    thickness: row.thickness,
    width: row.width,
    height: row.height,
    grain: row.grain,
    sourceProjectId: row.sourceProjectId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Newest first, then id (stable). */
export function sortOffcuts(items: OffcutItem[]): OffcutItem[] {
  return items.sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1,
  );
}

export function offcutError(body: OffcutApiError, status: number) {
  return NextResponse.json(body, { status });
}

export function isUuid(id: string): boolean {
  return UUID.test(id);
}

export function toInsert(o: NewOffcut) {
  return {
    material: o.material,
    thickness: o.thickness,
    width: o.width,
    height: o.height,
    grain: o.grain,
    sourceProjectId: o.sourceProjectId ?? null,
  };
}

/**
 * After an NC export (T168): every offcut the layout cuts from is consumed → `used`. Ids that are
 * not offcuts of this company are ignored (the scoped update finds no row).
 */
export async function markOffcutsUsed(scope: CompanyScope, project: Project): Promise<void> {
  for (const id of usedOffcutIds(project)) {
    if (UUID.test(id)) await scope.offcuts.update(id, { status: 'used' });
  }
}
