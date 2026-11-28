/**
 * Bench items → fit-check input (T388): the part's face holes in its mesh frame, whether its
 * outline is its bounding rectangle (box test exact) and, for the others, the mesh the worker
 * builds a BVH for.
 */
import type { BenchItem } from './assembly-model';
import { localOutline, ringArea, shapeKey, type MeshData } from './part-mesh';
import { boxSize } from './assembly-math';
import type { FitHole, FitPart, FitResult } from './fit-check';

export interface FitMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface FitRequest {
  id: number;
  parts: FitPart[];
  /** Per part: the mesh key for non-boxy parts (worker BVH), else null. */
  meshKeys: (string | null)[];
  /** Meshes by key (each sent once per request). */
  meshes: Record<string, FitMesh>;
}

export type FitResponse =
  { id: number; ok: true; result: FitResult } | { id: number; ok: false; detail: string };

/** Outline area at least this share of the box face → treated as a box. */
const BOXY_SHARE = 0.995;
const boxyCache = new WeakMap<MeshData, boolean>();

function isBoxy(item: BenchItem): boolean {
  const hit = boxyCache.get(item.mesh);
  if (hit !== undefined) return hit;
  const [w, h] = boxSize(item.box);
  const area = Math.abs(ringArea(localOutline(item.part)));
  const boxy = w * h > 0 && area >= w * h * BOXY_SHARE;
  boxyCache.set(item.mesh, boxy);
  return boxy;
}

export function fitHoles(item: BenchItem): FitHole[] {
  return item.part.holes.map((h) => ({
    cx: h.cx,
    cy: h.cy,
    d: h.d,
    through: h.type === 'through',
  }));
}

export function fitRequest(id: number, items: readonly BenchItem[]): FitRequest {
  const parts: FitPart[] = [];
  const meshKeys: (string | null)[] = [];
  const meshes: Record<string, FitMesh> = {};
  for (const it of items) {
    const boxy = isBoxy(it);
    parts.push({ id: it.id, box: it.box, pose: it.pose, holes: fitHoles(it), boxy });
    if (boxy) {
      meshKeys.push(null);
      continue;
    }
    const key = shapeKey(it.part, it.thickness);
    meshKeys.push(key);
    meshes[key] ??= { positions: it.mesh.positions, indices: it.mesh.indices };
  }
  return { id, parts, meshKeys, meshes };
}
