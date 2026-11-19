/**
 * Scene data of one sheet for the 3D preview (T153, D-033): part meshes grouped by shape
 * (identical parts share one geometry and are drawn instanced), single parts baked into one
 * merged mesh, the waste slab with the part openings, and all part edges as one line set. The
 * draw-call count stays bounded: one per shared shape + one merged mesh + waste + edges, so 300
 * parts never need more than ~150 + 3 calls (spec §3.8 perf budget). Pure data.
 */
import { defaultSheet, placedOutline, sheetSizeOf, type Project } from '@nittcam/core';
import { flatten } from './outlines';
import { effectiveGrain } from './textures';
import {
  applyTransform,
  partMesh,
  placementTransform,
  shapeKey,
  wasteMesh,
  type MeshData,
  type PlacementTransform,
} from './part-mesh';

export interface InstanceRef {
  /** `partId#index`, the copy key of the 2D view (selection, T155). */
  key: string;
  partId: string;
  transform: PlacementTransform;
  /** Effective grain of this copy in the sheet frame, degrees [0, 180) (T154, D-034). */
  grain: number;
}

export interface ShapeGroup {
  shape: string;
  mesh: MeshData;
  instances: InstanceRef[];
}

export interface SheetScene {
  /** Shapes with two or more copies on this sheet: one instanced draw call each. */
  instanced: ShapeGroup[];
  /** Shapes with one copy, baked into the sheet frame: one draw call together. */
  merged: MeshData | null;
  /** Copies inside `merged`, in order. */
  mergedRefs: InstanceRef[];
  /** Per vertex of `merged`: effective grain in degrees (the texture direction). */
  mergedGrain: Float32Array | null;
  /** Grain of the waste (the sheet grain; 0 without one). */
  wasteGrain: number;
  waste: MeshData;
  /** Edge lines of every part in the sheet frame (one draw call). */
  edges: Float32Array;
  parts: number;
}

/** Geometry cache per part shape (T153: "cached per part shape"); bounded. */
const cache = new Map<string, MeshData>();
const CACHE_MAX = 500;

export function cachedPartMesh(part: Parameters<typeof partMesh>[0], thickness: number): MeshData {
  const key = shapeKey(part, thickness);
  const hit = cache.get(key);
  if (hit) return hit;
  const mesh = partMesh(part, thickness);
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, mesh);
  return mesh;
}

/** Test hook. */
export function clearMeshCache(): void {
  cache.clear();
}

export function meshCacheSize(): number {
  return cache.size;
}

export function buildSheetScene(project: Project, sheet: number): SheetScene {
  const T = project.stock.thickness;
  const parts = new Map(project.parts.map((p) => [p.id, p]));
  const groups = new Map<string, ShapeGroup>();
  const outlines: number[][] = [];
  let count = 0;
  for (const pl of project.layout.sheets[sheet]?.placements ?? []) {
    const part = parts.get(pl.partId);
    if (!part) continue;
    count++;
    const shape = shapeKey(part, T);
    let g = groups.get(shape);
    if (!g) {
      g = { shape, mesh: cachedPartMesh(part, T), instances: [] };
      groups.set(shape, g);
    }
    g.instances.push({
      key: `${pl.partId}#${pl.index}`,
      partId: pl.partId,
      transform: placementTransform(part, pl),
      grain: effectiveGrain(part, pl.rot, defaultSheet(project).grain),
    });
    outlines.push(flatten(placedOutline(part, pl)));
  }
  const instanced: ShapeGroup[] = [];
  const singles: ShapeGroup[] = [];
  for (const g of groups.values()) (g.instances.length > 1 ? instanced : singles).push(g);
  const edges: number[] = [];
  for (const g of groups.values())
    for (const inst of g.instances) bakeEdges(g.mesh.edges, inst.transform, edges);
  const merged = singles.length > 0 ? mergeBaked(singles) : null;
  return {
    instanced,
    merged: merged?.mesh ?? null,
    mergedGrain: merged?.grain ?? null,
    wasteGrain: defaultSheet(project).grain ?? 0,
    mergedRefs: singles.map((g) => g.instances[0]).filter((r): r is InstanceRef => !!r),
    waste: wasteMesh(sheetSizeOf(project, sheet), T, outlines),
    edges: new Float32Array(edges),
    parts: count,
  };
}

/** Draw calls of the part layer: instanced shapes + merged + waste + edges. */
export function partDrawCalls(scene: SheetScene): number {
  return scene.instanced.length + (scene.merged ? 1 : 0) + 1 + (scene.edges.length > 0 ? 1 : 0);
}

function bakeEdges(src: Float32Array, t: PlacementTransform, out: number[]) {
  for (let i = 0; i + 2 < src.length; i += 3) {
    const [x, y] = applyTransform(t, src[i] ?? 0, src[i + 1] ?? 0);
    out.push(x, y, src[i + 2] ?? 0);
  }
}

/** Bakes single-copy shapes into one mesh in the sheet frame. */
function mergeBaked(groups: ShapeGroup[]): { mesh: MeshData; grain: Float32Array } {
  let nv = 0;
  let ni = 0;
  for (const g of groups) {
    nv += g.mesh.positions.length;
    ni += g.mesh.indices.length;
  }
  const positions = new Float32Array(nv);
  const normals = new Float32Array(nv);
  const bands = new Float32Array(nv / 3);
  const grain = new Float32Array(nv / 3);
  const indices = new Uint32Array(ni);
  let pv = 0;
  let pi = 0;
  let openings = 0;
  let throughOpenings = 0;
  for (const g of groups) {
    const inst = g.instances[0];
    if (!inst) continue;
    const t = inst.transform;
    bands.set(g.mesh.bands, pv / 3);
    grain.fill(inst.grain, pv / 3, pv / 3 + g.mesh.bands.length);
    const { positions: P, normals: N, indices: I } = g.mesh;
    const r = (t.rot * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const base = pv / 3;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i] ?? 0;
      const y = P[i + 1] ?? 0;
      positions[pv + i] = x * c - y * s + t.tx;
      positions[pv + i + 1] = x * s + y * c + t.ty;
      positions[pv + i + 2] = P[i + 2] ?? 0;
      const nx = N[i] ?? 0;
      const ny = N[i + 1] ?? 0;
      normals[pv + i] = nx * c - ny * s;
      normals[pv + i + 1] = nx * s + ny * c;
      normals[pv + i + 2] = N[i + 2] ?? 0;
    }
    for (let i = 0; i < I.length; i++) indices[pi + i] = (I[i] ?? 0) + base;
    pv += P.length;
    pi += I.length;
    openings += g.mesh.openings;
    throughOpenings += g.mesh.throughOpenings;
  }
  return {
    mesh: {
      positions,
      normals,
      bands,
      indices,
      edges: new Float32Array(0),
      openings,
      throughOpenings,
    },
    grain,
  };
}
