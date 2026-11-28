/**
 * Montaj tezgâhı math (T386, T387): quaternions, instance matrices, oriented boxes, face-to-face
 * mating and edge snapping. Plain numbers (no `three`), so it is unit-tested and stays out of the
 * main chunk. Frame: mm, y up (see `packages/core/src/schema/assembly.ts`).
 */

export type V3 = [number, number, number];
/** Unit quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

export interface Pose {
  position: V3;
  rotation: Quat;
}

/** Bounding box of a part's local mesh (T153 frame). */
export interface LocalBox {
  min: V3;
  max: V3;
}

export const IDENTITY: Quat = [0, 0, 0, 1];
const DEG = Math.PI / 180;

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
};

export function qNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  // One sign per rotation (w ≥ 0) keeps stored values stable.
  const s = q[3] < 0 ? -1 / l : 1 / l;
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
}

/** a · b: first b, then a. */
export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qAxisAngle(axis: V3, rad: number): Quat {
  const n = norm(axis);
  const s = Math.sin(rad / 2);
  return qNormalize([n[0] * s, n[1] * s, n[2] * s, Math.cos(rad / 2)]);
}

export function qRotate(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  const u: V3 = [x, y, z];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, w)), cross(u, t));
}

/** The shortest rotation taking unit vector a onto unit vector b. */
export function qFromTo(a: V3, b: V3): Quat {
  const d = dot(a, b);
  if (d > 1 - 1e-12) return IDENTITY;
  if (d < -1 + 1e-12) {
    // Opposite: half a turn about any axis across a.
    const axis = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    return qAxisAngle(axis, Math.PI);
  }
  const c = cross(a, b);
  return qNormalize([c[0], c[1], c[2], 1 + d]);
}

/** Rotation whose matrix has the given columns (images of local x, y, z; orthonormal, det +1). */
export function qFromBasis(cx: V3, cy: V3, cz: V3): Quat {
  const [m00, m10, m20] = cx;
  const [m01, m11, m21] = cy;
  const [m02, m12, m22] = cz;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return qNormalize(q);
}

/** The three local axes of a rotation in world coordinates. */
export function axesOf(q: Quat): [V3, V3, V3] {
  return [qRotate(q, [1, 0, 0]), qRotate(q, [0, 1, 0]), qRotate(q, [0, 0, 1])];
}

export const boxCentre = (b: LocalBox): V3 => scale(add(b.min, b.max), 0.5);
export const boxSize = (b: LocalBox): V3 => sub(b.max, b.min);

/**
 * Column-major 4×4 (`Matrix4.fromArray` order) placing a part's local mesh:
 * world = position + R · (local − centre).
 */
export function instanceMatrix(pose: Pose, centre: V3): number[] {
  const [cx, cy, cz] = axesOf(pose.rotation);
  const t = sub(pose.position, qRotate(pose.rotation, centre));
  return [...cx, 0, ...cy, 0, ...cz, 0, ...t, 1];
}

/** The pose of a rigid column-major matrix (local mesh frame → world). */
export function poseFromMatrix(m: readonly number[], centre: V3): Pose {
  const e = (i: number) => m[i] ?? 0;
  const rotation = qFromBasis([e(0), e(1), e(2)], [e(4), e(5), e(6)], [e(8), e(9), e(10)]);
  const position = add([e(12), e(13), e(14)], qRotate(rotation, centre));
  return { position, rotation };
}

/** Rounded for storage: positions to 0,001 mm, rotations to 1e-6 (then normalised). */
export function roundPose(p: Pose): Pose {
  const r = (v: number, k: number) => Math.round(v * k) / k + 0; // + 0 turns -0 into 0
  return {
    position: [r(p.position[0], 1e3), r(p.position[1], 1e3), r(p.position[2], 1e3)],
    rotation: qNormalize([
      r(p.rotation[0], 1e6),
      r(p.rotation[1], 1e6),
      r(p.rotation[2], 1e6),
      r(p.rotation[3], 1e6),
    ]),
  };
}

/** World axis-aligned bounds of a placed part. */
export function worldBounds(pose: Pose, box: LocalBox): { min: V3; max: V3 } {
  const half = scale(boxSize(box), 0.5);
  const axes = axesOf(pose.rotation);
  const ext: V3 = [0, 1, 2].map((i) =>
    axes.reduce((s, a, k) => s + Math.abs(a[i] ?? 0) * (half[k] ?? 0), 0),
  ) as V3;
  return { min: sub(pose.position, ext), max: add(pose.position, ext) };
}

/** Turns a part 90° (or any angle) about a world axis through its own centre. */
export function turnAbout(pose: Pose, axis: 0 | 1 | 2, deg: number): Pose {
  const a: V3 = [0, 0, 0];
  a[axis] = 1;
  return { ...pose, rotation: qNormalize(qMul(qAxisAngle(a, deg * DEG), pose.rotation)) };
}

// ---------------------------------------------------------------------------
// Euler angles for the numeric fields (XYZ order, degrees)
// ---------------------------------------------------------------------------

export function eulerDeg(q: Quat): V3 {
  const [cx, cy, cz] = axesOf(q);
  // Matrix entries m[row][col]: column k is axis k.
  const m02 = cz[0];
  const m12 = cz[1];
  const m22 = cz[2];
  const m01 = cy[0];
  const m00 = cx[0];
  const m11 = cy[1];
  const m21 = cy[2];
  const y = Math.asin(Math.max(-1, Math.min(1, m02)));
  let x: number;
  let z: number;
  if (Math.abs(m02) < 0.9999999) {
    x = Math.atan2(-m12, m22);
    z = Math.atan2(-m01, m00);
  } else {
    x = Math.atan2(m21, m11);
    z = 0;
  }
  const r = (v: number) => Math.round((v / DEG) * 100) / 100 + 0;
  return [r(x), r(y), r(z)];
}

export function quatFromEulerDeg(e: V3): Quat {
  const qx = qAxisAngle([1, 0, 0], e[0] * DEG);
  const qy = qAxisAngle([0, 1, 0], e[1] * DEG);
  const qz = qAxisAngle([0, 0, 1], e[2] * DEG);
  // Same order as three's 'XYZ': R = Rx · Ry · Rz.
  return qNormalize(qMul(qMul(qx, qy), qz));
}

/** Snaps an angle (degrees) to a step; `step` 0 = free. */
export function snapAngle(deg: number, step: number): number {
  return step > 0 ? Math.round(deg / step) * step : deg;
}

// ---------------------------------------------------------------------------
// Faces and face-to-face mating (T387 "yüzey yüzeye oturt")
// ---------------------------------------------------------------------------

/** One face of a part's box: local axis 0/1/2 and side ±1. */
export interface BoxFace {
  axis: 0 | 1 | 2;
  sign: 1 | -1;
}

/** The box face a world normal on a placed part belongs to (nearest local axis). */
export function faceFromNormal(rotation: Quat, worldNormal: V3): BoxFace {
  const axes = axesOf(rotation);
  let best: BoxFace = { axis: 0, sign: 1 };
  let bestDot = -Infinity;
  axes.forEach((a, k) => {
    const d = dot(a, worldNormal);
    if (Math.abs(d) > bestDot) {
      bestDot = Math.abs(d);
      best = { axis: k as 0 | 1 | 2, sign: d >= 0 ? 1 : -1 };
    }
  });
  return best;
}

export interface FaceFrame {
  /** Outward unit normal. */
  normal: V3;
  /** Face centre (world). */
  centre: V3;
  /** In-plane unit axes and the face half sizes along them. */
  u: V3;
  v: V3;
  hu: number;
  hv: number;
}

export function faceFrame(pose: Pose, box: LocalBox, face: BoxFace): FaceFrame {
  const axes = axesOf(pose.rotation);
  const half = scale(boxSize(box), 0.5);
  const normal = scale(axes[face.axis], face.sign);
  const ui = ((face.axis + 1) % 3) as 0 | 1 | 2;
  const vi = ((face.axis + 2) % 3) as 0 | 1 | 2;
  return {
    normal,
    centre: add(pose.position, scale(normal, half[face.axis])),
    u: axes[ui],
    v: axes[vi],
    hu: half[ui],
    hv: half[vi],
  };
}

/** Extent of a placed box along a world direction: [min, max] of dot(x, dir). */
export function extentAlong(pose: Pose, box: LocalBox, dir: V3): [number, number] {
  const half = scale(boxSize(box), 0.5);
  const r = axesOf(pose.rotation).reduce(
    (s, a, k) => s + Math.abs(dot(a, dir)) * (half[k] ?? 0),
    0,
  );
  const c = dot(pose.position, dir);
  return [c - r, c + r];
}

/** Default edge / corner snap distance while sliding, mm (T387). */
export const SNAP_MM = 2;
/** The first placement of a mate pulls an edge flush from this far (mm). */
export const MATE_PULL_MM = 25;

/**
 * Shift along one in-plane axis that brings B's edges onto A's face edges or centre: B's [lo, hi]
 * against A's [lo, hi] (flush inside, flush outside, centred). Returns 0 when nothing is within
 * `tol`. `snapped` says which kind won (for the feedback line).
 */
export function edgeSnap(
  b: [number, number],
  a: [number, number],
  tol: number,
): { shift: number; snapped: boolean } {
  const cands = [
    a[0] - b[0], // low edges flush
    a[1] - b[1], // high edges flush
    a[1] - b[0], // B starts where A ends
    a[0] - b[1], // B ends where A starts
    (a[0] + a[1]) / 2 - (b[0] + b[1]) / 2, // centred
  ];
  let shift = 0;
  let best = Infinity;
  for (const c of cands) {
    if (Math.abs(c) < best) {
      best = Math.abs(c);
      shift = c;
    }
  }
  const snapped = best <= tol + 1e-9;
  return { shift: snapped ? shift : 0, snapped };
}

/** B slid in A's face plane so its edges snap to A's (tolerance `tol` mm). */
export function snapOnFace(
  poseB: Pose,
  boxB: LocalBox,
  frameA: FaceFrame,
  tol: number,
): { pose: Pose; snappedU: boolean; snappedV: boolean } {
  const cu = dot(frameA.centre, frameA.u);
  const cv = dot(frameA.centre, frameA.v);
  const su = edgeSnap(extentAlong(poseB, boxB, frameA.u), [cu - frameA.hu, cu + frameA.hu], tol);
  const sv = edgeSnap(extentAlong(poseB, boxB, frameA.v), [cv - frameA.hv, cv + frameA.hv], tol);
  const position = add(add(poseB.position, scale(frameA.u, su.shift)), scale(frameA.v, sv.shift));
  return { pose: { ...poseB, position }, snappedU: su.snapped, snappedV: sv.snapped };
}

/**
 * Face-to-face mate (T387): B turns so its picked face looks straight at A's picked face (normals
 * opposite), squared to A (its in-plane axes on A's, the smallest twist), and moves so the two
 * faces lie flush with B's face centred on `at` (a point on A's face; default A's face centre).
 * Edges within `pull` mm of A's face edges are pulled flush.
 */
export function mate(
  poseA: Pose,
  boxA: LocalBox,
  faceA: BoxFace,
  poseB: Pose,
  boxB: LocalBox,
  faceB: BoxFace,
  at?: V3,
  pull = MATE_PULL_MM,
): Pose {
  const fa = faceFrame(poseA, boxA, faceA);
  const nBWorld = scale(axesOf(poseB.rotation)[faceB.axis], faceB.sign);
  const target = scale(fa.normal, -1);
  let rotation = qNormalize(qMul(qFromTo(nBWorld, target), poseB.rotation));
  // Square the twist about the normal: B's nearest in-plane axis onto A's u (multiple of 90°).
  const axesB = axesOf(rotation);
  const inPlane = axesB.filter((_, k) => k !== faceB.axis);
  let best = 0;
  let bestDot = -Infinity;
  for (const a of inPlane) {
    for (const ref of [fa.u, fa.v, scale(fa.u, -1), scale(fa.v, -1)]) {
      const d = dot(a, ref);
      if (d > bestDot) {
        bestDot = d;
        // Signed angle from a to ref about the normal `target`.
        best = Math.atan2(dot(cross(a, ref), target), dot(a, ref));
      }
    }
  }
  rotation = qNormalize(qMul(qAxisAngle(target, best), rotation));
  const halfB = scale(boxSize(boxB), 0.5)[faceB.axis];
  const point = at ?? fa.centre;
  // Tangential spot from `at`, depth from A's face plane.
  const tangential = sub(point, scale(fa.normal, dot(point, fa.normal)));
  const planeD = dot(fa.centre, fa.normal);
  const position = add(tangential, scale(fa.normal, planeD + halfB));
  return snapOnFace({ position, rotation }, boxB, fa, pull).pose;
}

/**
 * Slides B in A's face plane by a world delta (the in-plane part only) and snaps its edges within
 * `tol` mm (T387 "then slides on that face").
 */
export function slideOnFace(
  start: Pose,
  boxB: LocalBox,
  frameA: FaceFrame,
  delta: V3,
  tol = SNAP_MM,
): { pose: Pose; snappedU: boolean; snappedV: boolean } {
  const d = sub(delta, scale(frameA.normal, dot(delta, frameA.normal)));
  return snapOnFace({ ...start, position: add(start.position, d) }, boxB, frameA, tol);
}

/** Signed volume of a closed triangle mesh (positions xyz, indices) after a column-major matrix. */
export function meshVolume(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  m?: readonly number[],
): number {
  const p = (i: number): V3 => {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    const z = positions[i * 3 + 2] ?? 0;
    if (!m) return [x, y, z];
    const e = (k: number) => m[k] ?? 0;
    return [
      e(0) * x + e(4) * y + e(8) * z + e(12),
      e(1) * x + e(5) * y + e(9) * z + e(13),
      e(2) * x + e(6) * y + e(10) * z + e(14),
    ];
  };
  let v = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = p(indices[t] ?? 0);
    const b = p(indices[t + 1] ?? 0);
    const c = p(indices[t + 2] ?? 0);
    v += dot(a, cross(b, c)) / 6;
  }
  return v;
}
