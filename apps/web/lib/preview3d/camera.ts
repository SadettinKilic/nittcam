/**
 * Camera math of the 3D preview (T152, spec §3.8): view presets, fit distance, the first-open
 * ease and the view-cube orientation. Plain numbers only (no `three`), so the light host
 * component can use it without pulling the 3D chunk.
 *
 * World frame of the scene: Y up, +X right, +Z toward the operator (the machine front). The sheet
 * frame (X right, Y away from the operator, Z up; spec §6.1) maps to world (x, z, -y), and the
 * sheet centre sits at the world origin.
 */

export type Vec3 = readonly [number, number, number];

/** Named views: the three toolbar presets plus the view-cube faces and top corners. */
export type ViewPreset =
  | 'top'
  | 'iso'
  | 'front'
  | 'right'
  | 'left'
  | 'back'
  | 'isoFrontLeft'
  | 'isoBackRight'
  | 'isoBackLeft';

/** Toolbar presets (spec §3.8: Üst / İzometrik / Ön). */
export const TOOLBAR_PRESETS = ['top', 'iso', 'front'] as const satisfies readonly ViewPreset[];

/**
 * Direction from the target to the camera per preset (not normalised). Top is tilted by a hair
 * so the orbit controls keep a defined azimuth (front stays at the bottom of the screen).
 */
const DIRECTIONS: Record<ViewPreset, Vec3> = {
  top: [0, 1, 1e-4],
  iso: [1, 1, 1],
  front: [0, 0, 1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  back: [0, 0, -1],
  isoFrontLeft: [-1, 1, 1],
  isoBackRight: [1, 1, -1],
  isoBackLeft: [-1, 1, -1],
};

export function presetDirection(preset: ViewPreset): Vec3 {
  return normalize(DIRECTIONS[preset]);
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

/** Half extents of the box the camera frames (world axes), centred on `target`. */
export interface FrameBox {
  hx: number;
  hy: number;
  hz: number;
}

/** The sheet as a frame box: width along X, thickness along Y, depth (sheet height) along Z. */
export function sheetFrameBox(sheet: { width: number; height: number }, thickness: number) {
  return { hx: sheet.width / 2, hy: thickness / 2, hz: sheet.height / 2 } satisfies FrameBox;
}

/**
 * Distance along `dir` at which a perspective camera (vertical `fovDeg`, `aspect` = w / h) shows
 * the whole box with `pad` (fraction) of room: the box corners are projected on the camera's
 * right/up axes and the nearest corner depth is added.
 */
export function fitDistance(dir: Vec3, box: FrameBox, fovDeg: number, aspect: number, pad = 0.15) {
  const d = normalize(dir);
  const { right, up } = basis(d);
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * Math.max(1e-6, aspect);
  let need = 0;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const c: Vec3 = [sx * box.hx, sy * box.hy, sz * box.hz];
        const depth = dot(c, d); // > 0 = toward the camera
        const u = Math.abs(dot(c, right)) * (1 + pad);
        const v = Math.abs(dot(c, up)) * (1 + pad);
        need = Math.max(need, depth + u / tanH, depth + v / tanV);
      }
  return need;
}

/** Position on `dir` from `target` at which the whole `box` is in view (assembly first camera, B44). */
export function fittedPosition(
  target: Vec3,
  dir: Vec3,
  box: FrameBox,
  fovDeg: number,
  aspect: number,
  pad = 0.12,
): [number, number, number] {
  const d = normalize(dir);
  const dist = fitDistance(d, box, fovDeg, aspect, pad);
  return [target[0] + d[0] * dist, target[1] + d[1] * dist, target[2] + d[2] * dist];
}

/** Camera pose of a preset that frames `box` around `target`. */
export function presetPose(
  preset: ViewPreset,
  box: FrameBox,
  fovDeg: number,
  aspect: number,
  target: Vec3 = [0, 0, 0],
): CameraPose {
  const d = presetDirection(preset);
  const dist = fitDistance(d, box, fovDeg, aspect);
  return { position: add(target, scale(d, dist)), target };
}

/** Ease-out cubic on [0, 1]. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** Length of the first-open ease from top to isometric, ms (T152: ≤ 400 ms). */
export const INTRO_MS = 380;
/** Length of a preset change, ms. */
export const PRESET_MS = 320;

/**
 * Pose between `a` and `b` at `t` (0..1, already eased): the view direction turns on the great
 * circle (slerp), the distance and target are interpolated linearly, so the camera swings around
 * the target instead of cutting through it.
 */
export function interpolatePose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const target = lerp3(a.target, b.target, t);
  const va = sub(a.position, a.target);
  const vb = sub(b.position, b.target);
  const la = length(va);
  const lb = length(vb);
  const dir = slerp(scale(va, 1 / la), scale(vb, 1 / lb), t);
  const dist = la + (lb - la) * t;
  return { position: add(target, scale(dir, dist)), target };
}

/** Azimuth of a camera around its target, degrees in [0, 360): 0 = front, 90 = right. */
export function azimuthDeg(pose: CameraPose): number {
  const v = sub(pose.position, pose.target);
  const a = (Math.atan2(v[0], v[2]) * 180) / Math.PI;
  return ((a % 360) + 360) % 360;
}

/** Polar angle from straight above, degrees: 0 = top view, 90 = level. */
export function polarDeg(pose: CameraPose): number {
  const v = normalize(sub(pose.position, pose.target));
  return (Math.acos(Math.min(1, Math.max(-1, v[1]))) * 180) / Math.PI;
}

/**
 * CSS `matrix3d` for the DOM view cube from the camera's world-inverse matrix (column-major, as
 * `three` stores it): only the rotation is kept, and Y is flipped because CSS Y points down.
 */
export function cubeMatrix(viewInverse: ArrayLike<number>): string {
  const s = [1, -1, 1];
  const out: number[] = [];
  // Column-major 3×3 rotation R[row][col] = e[col * 4 + row]; M = S·R·S.
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      if (col === 3 || row === 3) out.push(col === row ? 1 : 0);
      else out.push(round6((s[row] ?? 1) * (viewInverse[col * 4 + row] ?? 0) * (s[col] ?? 1)));
    }
  return `matrix3d(${out.join(',')})`;
}

// ---------------------------------------------------------------------------------------------

function round6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

function basis(d: Vec3): { right: Vec3; up: Vec3 } {
  const worldUp: Vec3 = Math.abs(d[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const right = normalize(cross(worldUp, d));
  const up = cross(d, right);
  return { right, up };
}

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const c = Math.min(1, Math.max(-1, dot(a, b)));
  const omega = Math.acos(c);
  if (omega < 1e-6) return normalize(lerp3(a, b, t));
  const s = Math.sin(omega);
  return normalize(add(scale(a, Math.sin((1 - t) * omega) / s), scale(b, Math.sin(t * omega) / s)));
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function normalize(a: Vec3): Vec3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
