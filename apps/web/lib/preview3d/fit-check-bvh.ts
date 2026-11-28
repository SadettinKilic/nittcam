/**
 * Exact pair test for the fit check (T388): three-mesh-bvh (MIT) on the part meshes, used by the
 * worker for parts whose outline is not a rectangle. BVHs are kept per mesh key between runs.
 */
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { boxCentre, instanceMatrix } from './assembly-math';
import { at, GAP_LIST_MM, TOUCH_MM, type FitPart, type NarrowTest } from './fit-check';
import type { FitMesh } from './fit-check-input';

const MAX_CACHE = 64;
const cache = new Map<string, { geometry: BufferGeometry; bvh: MeshBVH }>();

function bvhOf(key: string, mesh: FitMesh) {
  const hit = cache.get(key);
  if (hit) return hit;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const bvh = new MeshBVH(geometry);
  (geometry as BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = bvh;
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  const out = { geometry, bvh };
  cache.set(key, out);
  return out;
}

/** A box-shaped part as a 12-triangle mesh (when only its partner needs the mesh test). */
function boxMesh(min: readonly number[], max: readonly number[]): FitMesh {
  const [x0, y0, z0] = min as [number, number, number];
  const [x1, y1, z1] = max as [number, number, number];
  const p = [
    x0,
    y0,
    z0,
    x1,
    y0,
    z0,
    x1,
    y1,
    z0,
    x0,
    y1,
    z0,
    x0,
    y0,
    z1,
    x1,
    y0,
    z1,
    x1,
    y1,
    z1,
    x0,
    y1,
    z1,
  ];
  const i = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ];
  return { positions: new Float32Array(p), indices: new Uint32Array(i) };
}

/** Push-out bisection precision, mm. */
const PUSH_EPS = 0.01;

/**
 * Smallest move of B along the 12 box face directions (±A axes, ±B axes) that frees it, by
 * bisection up to the box depth (+ TOUCH_MM): the mesh overlap depth shown in mm.
 */
function pushOut(
  meets: (shift: Vector3) => boolean,
  mats: readonly Matrix4[],
  a: number,
  b: number,
  limit: number,
): number {
  const dirs: Vector3[] = [];
  for (const m of [at(mats, a), at(mats, b)]) {
    const x = new Vector3();
    const y = new Vector3();
    const z = new Vector3();
    m.extractBasis(x, y, z);
    for (const v of [x, y, z]) dirs.push(v.clone().normalize(), v.clone().normalize().negate());
  }
  let best = Math.max(0, limit - TOUCH_MM);
  const hi0 = limit + 2 * TOUCH_MM;
  for (const d of dirs) {
    if (meets(d.clone().multiplyScalar(Math.min(best, hi0)))) continue;
    let lo = 0;
    let hi = Math.min(best, hi0);
    while (hi - lo > PUSH_EPS) {
      const mid = (lo + hi) / 2;
      if (meets(d.clone().multiplyScalar(mid))) lo = mid;
      else hi = mid;
    }
    best = Math.min(best, hi);
  }
  // The shrunk meshes free TOUCH_MM early: add it back.
  return Math.round((best + TOUCH_MM) * 100) / 100;
}

/** The narrow test over one request's parts (meshKeys[i] null = a box-shaped part). */
export function bvhNarrow(
  parts: readonly FitPart[],
  meshKeys: readonly (string | null)[],
  meshes: Readonly<Record<string, FitMesh>>,
): NarrowTest {
  const mats = parts.map((p) => new Matrix4().fromArray(instanceMatrix(p.pose, boxCentre(p.box))));
  const meshOf = (i: number) => {
    const p = at(parts, i);
    const key = meshKeys[i] ?? `box:${p.box.min.join(',')}:${p.box.max.join(',')}`;
    const mesh = meshKeys[i] ? meshes[key] : undefined;
    return bvhOf(key, mesh ?? boxMesh(p.box.min, p.box.max));
  };
  const shrink = (i: number) => {
    const p = at(parts, i);
    const c = boxCentre(p.box);
    const k = (axis: 0 | 1 | 2) => {
      const size = p.box.max[axis] - p.box.min[axis];
      return size > 4 * TOUCH_MM ? 1 - (2 * TOUCH_MM) / size : 1;
    };
    return new Matrix4()
      .makeTranslation(c[0], c[1], c[2])
      .multiply(new Matrix4().makeScale(k(0), k(1), k(2)))
      .multiply(new Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
  };
  return (a, b, boxDepth) => {
    const A = meshOf(a);
    const B = meshOf(b);
    const sa = shrink(a);
    const sb = shrink(b);
    const invA = at(mats, a).clone().invert();
    // Overlap only when each mesh, shrunk by TOUCH_MM about its centre, still meets the other:
    // faces that merely touch (also inside an L) stay a fit. `shift` moves B (world, mm).
    const meets = (shift: Vector3) => {
      const mb = new Matrix4().makeTranslation(shift.x, shift.y, shift.z).multiply(at(mats, b));
      const bToA = invA.clone().multiply(mb).multiply(sb);
      const aToB = mb.clone().invert().multiply(at(mats, a)).multiply(sa);
      return (
        A.bvh.intersectsGeometry(B.geometry, bToA) && B.bvh.intersectsGeometry(A.geometry, aToB)
      );
    };
    const zero = new Vector3();
    if (meets(zero))
      return { overlap: true, distance: 0, depth: pushOut(meets, mats, a, b, boxDepth) };
    const bToA = invA.clone().multiply(at(mats, b));
    const hit = A.bvh.closestPointToGeometry(
      B.geometry,
      bToA,
      undefined,
      undefined,
      0,
      GAP_LIST_MM,
    );
    return { overlap: false, distance: hit ? hit.distance : Infinity };
  };
}
