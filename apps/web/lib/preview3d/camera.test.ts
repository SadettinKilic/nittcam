import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  azimuthDeg,
  cubeMatrix,
  easeOut,
  fitDistance,
  fittedPosition,
  interpolatePose,
  polarDeg,
  presetDirection,
  presetPose,
  sheetFrameBox,
  type ViewPreset,
} from './camera';

const box = sheetFrameBox({ width: 2800, height: 2070 }, 18);

type V = readonly [number, number, number];

/** Projects a world point with a perspective camera at `pos` looking at the origin; NDC x/y. */
function project(pos: V, p: V, fov: number, aspect: number) {
  const d = Math.hypot(...pos);
  const f: V = [-pos[0] / d, -pos[1] / d, -pos[2] / d]; // forward
  const worldUp: V = Math.abs(f[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const r = norm(cross(f, worldUp));
  const u = cross(r, f);
  const rel: V = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
  const z = dot(rel, f);
  const t = Math.tan((fov * Math.PI) / 360);
  return { x: dot(rel, r) / z / (t * aspect), y: dot(rel, u) / z / t, z };
}
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V): V => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

describe('3D camera presets (T152)', () => {
  it('top looks straight down with the front at the bottom; front looks level', () => {
    const top = presetPose('top', box, 35, 1.6);
    expect(polarDeg(top)).toBeLessThan(0.01);
    expect(azimuthDeg(top)).toBeCloseTo(0, 3);
    const front = presetPose('front', box, 35, 1.6);
    expect(polarDeg(front)).toBeCloseTo(90, 6);
    expect(azimuthDeg(front)).toBeCloseTo(0, 6);
    const iso = presetPose('iso', box, 35, 1.6);
    expect(azimuthDeg(iso)).toBeCloseTo(45, 6);
    expect(polarDeg(iso)).toBeCloseTo(54.7356, 3);
    expect(azimuthDeg(presetPose('right', box, 35, 1.6))).toBeCloseTo(90, 6);
  });

  it('every preset keeps all box corners inside the view', () => {
    const presets: ViewPreset[] = ['top', 'iso', 'front', 'right', 'left', 'back', 'isoBackLeft'];
    fc.assert(
      fc.property(
        fc.constantFrom(...presets),
        fc.double({ min: 0.4, max: 3, noNaN: true }),
        fc.double({ min: 100, max: 4000, noNaN: true }),
        fc.double({ min: 100, max: 4000, noNaN: true }),
        (preset, aspect, w, h) => {
          const b = sheetFrameBox({ width: w, height: h }, 18);
          const pose = presetPose(preset, b, 35, aspect);
          for (const sx of [-1, 1])
            for (const sy of [-1, 1])
              for (const sz of [-1, 1]) {
                const p = project(pose.position, [sx * b.hx, sy * b.hy, sz * b.hz], 35, aspect);
                expect(p.z).toBeGreaterThan(0);
                expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-9);
                expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-9);
              }
        },
      ),
    );
  });

  it('a wider canvas needs no more distance than a narrow one', () => {
    const d = presetDirection('top');
    expect(fitDistance(d, box, 35, 2)).toBeLessThanOrEqual(fitDistance(d, box, 35, 1));
  });

  it('interpolation starts and ends on the poses and keeps the distance in range', () => {
    const a = presetPose('top', box, 35, 1.5);
    const b = presetPose('iso', box, 35, 1.5);
    expect(interpolatePose(a, b, 0).position[1]).toBeCloseTo(a.position[1], 6);
    const end = interpolatePose(a, b, 1);
    for (let i = 0; i < 3; i++) expect(end.position[i]).toBeCloseTo(b.position[i] ?? NaN, 6);
    const la = Math.hypot(...a.position);
    const lb = Math.hypot(...b.position);
    for (const t of [0.25, 0.5, 0.75]) {
      const l = Math.hypot(...interpolatePose(a, b, t).position);
      expect(l).toBeGreaterThanOrEqual(Math.min(la, lb) - 1e-6);
      expect(l).toBeLessThanOrEqual(Math.max(la, lb) + 1e-6);
    }
  });

  it('easeOut is clamped and monotonic', () => {
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  it('cube matrix flips Y for CSS and keeps the identity otherwise', () => {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -500, 1];
    expect(cubeMatrix(id)).toBe('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)');
    // 90° about X (world → camera): y' = -z, z' = y; column-major.
    const rx = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
    expect(cubeMatrix(rx)).toBe('matrix3d(1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1)');
  });
});

describe('fittedPosition (B44 assembly first camera)', () => {
  it('sits on the view direction at the fit distance, farther on a narrow canvas', () => {
    const box = { hx: 300, hy: 360, hz: 290 };
    const dir = [-0.45, 0.45, 0.77] as const;
    const wide = fittedPosition([300, 360, 290], dir, box, 35, 2);
    const narrow = fittedPosition([300, 360, 290], dir, box, 35, 0.8);
    const dist = (p: readonly [number, number, number]) =>
      Math.hypot(p[0] - 300, p[1] - 360, p[2] - 290);
    expect(dist(narrow)).toBeGreaterThan(dist(wide));
    const len = Math.hypot(...dir);
    expect(dist(wide)).toBeCloseTo(
      fitDistance(dir.map((v) => v / len) as unknown as typeof dir, box, 35, 2, 0.12),
      6,
    );
  });
});
