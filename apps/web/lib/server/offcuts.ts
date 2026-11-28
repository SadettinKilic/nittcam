/** Offcut stock (T168): validation, mapping and the "used" marking after an export. */
import {
  cleanProps,
  materialKindOf,
  materialPropsSchema,
  usedOffcutIds,
  type MaterialProps,
  type Project,
} from '@nittcam/core';
import type { CompanyScope } from '@nittcam/db';
import { NextResponse } from 'next/server';
import type { NewOffcut, OffcutApiError, OffcutItem, OffcutStatus } from '../offcuts-api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly OffcutStatus[] = ['available', 'reserved', 'used'];
const isMm = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10_000;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const KEYS = new Set([
  'material',
  'thickness',
  'width',
  'height',
  'grain',
  'sourceProjectId',
  'props',
]);

/** T350: valid props for the material (its own fields only), or null when malformed. */
function readProps(material: string, v: unknown): MaterialProps | null {
  const parsed = materialPropsSchema.safeParse(v);
  return parsed.success ? cleanProps(materialKindOf(material), parsed.data) : null;
}

/** One new offcut, strictly checked; null when anything is off. */
export function readNewOffcut(v: unknown): NewOffcut | null {
  if (!isObject(v) || Object.keys(v).some((k) => !KEYS.has(k))) return null;
  const { material, thickness, width, height, grain, sourceProjectId, props } = v;
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
  const cleaned = props === undefined ? {} : readProps(material, props);
  if (cleaned === null) return null;
  return {
    material: material.trim(),
    thickness,
    width,
    height,
    grain,
    sourceProjectId,
    ...(Object.keys(cleaned).length > 0 ? { props: cleaned } : {}),
  };
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

/** Fields an edit may change (T291); the source project and the date stay. */
export interface OffcutEdit {
  material?: string;
  thickness?: number;
  width?: number;
  height?: number;
  grain?: 0 | 90 | null;
  status?: OffcutStatus;
  /** T350: replaces the props (checked against the edited or stored material by the route). */
  props?: MaterialProps;
}

export type OffcutPatch =
  { kind: 'deleted'; deleted: boolean } | { kind: 'edit'; edit: OffcutEdit };

const EDIT_KEYS = new Set(['material', 'thickness', 'width', 'height', 'grain', 'status', 'props']);

/**
 * PATCH body of one offcut: `{ deleted: boolean }` alone (T291 delete / "Geri al"), or an edit with
 * one or more of material, thickness, width, height, grain, status (T168 status, T291 edit), each
 * checked like a new offcut. Null when anything is off.
 */
export function readOffcutPatch(body: unknown): OffcutPatch | null {
  if (!isObject(body)) return null;
  const keys = Object.keys(body);
  if (keys.length === 1 && keys[0] === 'deleted') {
    const deleted = body['deleted'];
    return typeof deleted === 'boolean' ? { kind: 'deleted', deleted } : null;
  }
  if (keys.length === 0 || keys.some((k) => !EDIT_KEYS.has(k))) return null;
  const edit: OffcutEdit = {};
  const { material, thickness, width, height, grain, status, props } = body;
  if (props !== undefined) {
    const parsed = materialPropsSchema.safeParse(props);
    if (!parsed.success) return null;
    edit.props = parsed.data;
  }
  if (material !== undefined) {
    if (typeof material !== 'string' || material.trim() === '' || material.length > 64) return null;
    edit.material = material.trim();
  }
  for (const [key, v] of [
    ['thickness', thickness],
    ['width', width],
    ['height', height],
  ] as const) {
    if (v === undefined) continue;
    if (!isMm(v)) return null;
    edit[key] = v;
  }
  if (grain !== undefined) {
    if (grain !== 0 && grain !== 90 && grain !== null) return null;
    edit.grain = grain;
  }
  if (status !== undefined) {
    const s = STATUSES.find((x) => x === status);
    if (!s) return null;
    edit.status = s;
  }
  return { kind: 'edit', edit };
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
  props?: unknown;
}

/** `names`: project id → name, for the stock list's source column (P4). */
export function toOffcutItem(row: OffcutRowLike, names?: ReadonlyMap<string, string>): OffcutItem {
  return {
    id: row.id,
    material: row.material,
    thickness: row.thickness,
    width: row.width,
    height: row.height,
    grain: row.grain,
    sourceProjectId: row.sourceProjectId,
    ...(names
      ? {
          sourceProjectName: row.sourceProjectId ? (names.get(row.sourceProjectId) ?? null) : null,
        }
      : {}),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    props: (readProps(row.material, row.props ?? {}) ?? {}) as MaterialProps,
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
    props: o.props ?? {},
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
