/**
 * Scene data of one sheet for the 3D preview (T153, D-033): part meshes grouped by shape
 * (identical parts share one geometry and are drawn instanced), single parts baked into one
 * merged mesh, the waste slab with the part openings, and all part edges as one line set. The
 * draw-call count stays bounded: one per shared shape + one merged mesh + waste + edges, so 300
 * parts never need more than ~150 + 3 calls (spec §3.8 perf budget). Pure data.
 */
import {
  defaultSheet,
  placedOutline,
  sheetSizeOf,
  toCutSizes,
  vGrooveTraitsOf,
  type Project,
} from '@nittcam/core';
import type { VGroove3d } from './vgroove-3d';
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
  /** Copy number on this sheet in placement order (= index into `drawnParts`): the shader slot (T155). */
  slot: number;
}

/** Footprint of one copy in the sheet frame, for picking (T155). */
export interface SlotOutline {
  ring: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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
  /** Per vertex of `merged`: the copy slot (lift and highlight, T155). */
  mergedSlots: Float32Array | null;
  /** Edge lines of every part in the sheet frame (one draw call). */
  edges: Float32Array;
  /** Per edge vertex: the copy slot. */
  edgeSlots: Float32Array;
  /** Outer outline of every copy, by slot. */
  outlines: SlotOutline[];
  parts: number;
}

/** Geometry cache per part shape (T153: "cached per part shape"); bounded. */
const cache = new Map<string, MeshData>();
const CACHE_MAX = 500;

export function cachedPartMesh(
  part: Parameters<typeof partMesh>[0],
  thickness: number,
  vGroove?: VGroove3d,
): MeshData {
  const key = shapeKey(part, thickness, vGroove);
  const hit = cache.get(key);
  if (hit) return hit;
  const mesh = partMesh(part, thickness, vGroove);
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

export function buildSheetScene(
  entered: Project,
  sheet: number,
  /** T353: the V-bit of the grooves (angle, tip); omitted = grooves are not drawn. */
  vBit?: { angleDeg: number; tipDiameter: number },
): SheetScene {
  // T169: parts are drawn at their cut size (edge-band deduction).
  const project = toCutSizes(entered);
  const T = project.stock.thickness;
  const traits = vBit ? vGrooveTraitsOf(project.stock.material) : null;
  const vGroove: VGroove3d | undefined =
    vBit && traits
      ? { ...vBit, traits, face: project.stock.machinedFace === 'back' ? 'back' : 'front' }
      : undefined;
  const parts = new Map(project.parts.map((p) => [p.id, p]));
  const groups = new Map<string, ShapeGroup>();
  const outlines: number[][] = [];
  let count = 0;
  for (const pl of project.layout.sheets[sheet]?.placements ?? []) {
    const part = parts.get(pl.partId);
    if (!part) continue;
    count++;
    const shape = shapeKey(part, T, vGroove);
    let g = groups.get(shape);
    if (!g) {
      g = { shape, mesh: cachedPartMesh(part, T, vGroove), instances: [] };
      groups.set(shape, g);
    }
    g.instances.push({
      key: `${pl.partId}#${pl.index}`,
      partId: pl.partId,
      transform: placementTransform(part, pl),
      grain: effectiveGrain(part, pl.rot, defaultSheet(project).grain),
      slot: count - 1,
    });
    outlines.push(flatten(placedOutline(part, pl)));
  }
  const instanced: ShapeGroup[] = [];
  const singles: ShapeGroup[] = [];
  for (const g of groups.values()) (g.instances.length > 1 ? instanced : singles).push(g);
  const edges: number[] = [];
  const edgeSlots: number[] = [];
  for (const g of groups.values())
    for (const inst of g.instances) {
      bakeEdges(g.mesh.edges, inst.transform, edges);
      while (edgeSlots.length < edges.length / 3) edgeSlots.push(inst.slot);
    }
  const merged = singles.length > 0 ? mergeBaked(singles) : null;
  return {
    instanced,
    merged: merged?.mesh ?? null,
    mergedGrain: merged?.grain ?? null,
    mergedSlots: merged?.slots ?? null,
    wasteGrain: defaultSheet(project).grain ?? 0,
    mergedRefs: singles.map((g) => g.instances[0]).filter((r): r is InstanceRef => !!r),
    waste: wasteMesh(sheetSizeOf(project, sheet), T, outlines),
    edges: new Float32Array(edges),
    edgeSlots: new Float32Array(edgeSlots),
    outlines: outlines.map(slotOutline),
    parts: count,
  };
}

/** Draw calls of the part layer: instanced shapes + merged + waste + edges. */
export function partDrawCalls(scene: SheetScene): number {
  return scene.instanced.length + (scene.merged ? 1 : 0) + 1 + (scene.edges.length > 0 ? 1 : 0);
}

function slotOutline(ring: number[]): SlotOutline {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const x = ring[i] ?? 0;
    const y = ring[i + 1] ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { ring, minX, minY, maxX, maxY };
}

/**
 * Slot of the copy under the sheet-frame point (x, y), or -1. Picking runs on the 2D outlines
 * (bbox, then even-odd test), so hovering 300 parts never ray-casts the merged mesh. The last
 * copy wins on (invalid) overlaps, like the 2D view that draws it on top.
 */
export function pickSlot(outlines: readonly SlotOutline[], x: number, y: number): number {
  for (let s = outlines.length - 1; s >= 0; s--) {
    const o = outlines[s];
    if (!o || x < o.minX || x > o.maxX || y < o.minY || y > o.maxY) continue;
    if (insideRing(o.ring, x, y)) return s;
  }
  return -1;
}

function insideRing(r: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i] ?? 0;
    const yi = r[2 * i + 1] ?? 0;
    const xj = r[2 * j] ?? 0;
    const yj = r[2 * j + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bakeEdges(src: Float32Array, t: PlacementTransform, out: number[]) {
  for (let i = 0; i + 2 < src.length; i += 3) {
    const [x, y] = applyTransform(t, src[i] ?? 0, src[i + 1] ?? 0);
    out.push(x, y, src[i + 2] ?? 0);
  }
}

/** Bakes single-copy shapes into one mesh in the sheet frame. */
function mergeBaked(groups: ShapeGroup[]): {
  mesh: MeshData;
  grain: Float32Array;
  slots: Float32Array;
} {
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
  const slots = new Float32Array(nv / 3);
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
    slots.fill(inst.slot, pv / 3, pv / 3 + g.mesh.bands.length);
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
    slots,
  };
}
