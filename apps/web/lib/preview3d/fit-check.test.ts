import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  qAxisAngle,
  qMul,
  type LocalBox,
  type Pose,
  type Quat,
  type V3,
} from './assembly-math';
import {
  candidatePairs,
  checkFit,
  holeAlignment,
  obbOf,
  obbSeparation,
  toLocal,
  toWorld,
  type FitHole,
  type FitPart,
  at,
} from './fit-check';

const box = (w: number, h: number, t: number): LocalBox => ({ min: [0, 0, 0], max: [w, h, t] });
const part = (
  id: string,
  b: LocalBox,
  position: V3,
  rotation: Quat = IDENTITY,
  holes: FitHole[] = [],
): FitPart => ({ id, box: b, pose: { position, rotation }, holes, boxy: true });
const sep = (a: FitPart, b: FitPart) => obbSeparation(obbOf(a.pose, a.box), obbOf(b.pose, b.box));

describe('obbSeparation (T388)', () => {
  const panel = box(500, 400, 18);
  it('two panels overlapping by 2 mm report a 2 mm depth', () => {
    const a = part('a', panel, [0, 0, 0]);
    const b = part('b', panel, [498, 0, 0]);
    expect(sep(a, b)).toBeCloseTo(2, 6);
  });
  it('touching panels separate by 0, a gap is negative', () => {
    const a = part('a', panel, [0, 0, 0]);
    expect(sep(a, part('b', panel, [500, 0, 0]))).toBeCloseTo(0, 6);
    expect(sep(a, part('b', panel, [500.6, 0, 0]))).toBeCloseTo(-0.6, 6);
  });
  it('rotated boxes: a panel turned 90° about Z standing on another', () => {
    const a = part('a', panel, [0, 0, 0]);
    // 500×400×18 turned 90° about Z spans 400 in x, 500 in y; its bottom at y = 200 - 250 = -50
    // meets a's top (y = 200) when its centre is at y = 450 - 3 → 3 mm overlap.
    const b = part('b', panel, [0, 447, 0], qAxisAngle([0, 0, 1], Math.PI / 2));
    expect(sep(a, b)).toBeCloseTo(3, 6);
  });
  it('a 45° turned box: the corner reaches √2·half', () => {
    const cube = box(100, 100, 100);
    const a = part('a', cube, [0, 0, 0]);
    const b = part('b', cube, [50 + 50 * Math.SQRT2 + 1, 0, 0], qAxisAngle([0, 0, 1], Math.PI / 4));
    expect(sep(a, b)).toBeCloseTo(-1, 6);
  });
  it('invariant: rotating and moving both boxes together keeps the separation', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.double({ min: -1, max: 1, noNaN: true }),
          fc.double({ min: -1, max: 1, noNaN: true }),
          fc.double({ min: -1, max: 1, noNaN: true }),
        ),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        (axis, angle, dx) => {
          if (Math.hypot(...axis) < 0.1) return;
          const q = qAxisAngle(axis, angle);
          const a = part('a', panel, [0, 0, 0]);
          const b = part('b', panel, [500 + dx, 0, 0]);
          const move = (p: FitPart): FitPart => ({
            ...p,
            pose: { position: rot(q, p.pose.position), rotation: qMul(q, p.pose.rotation) },
          });
          expect(sep(move(a), move(b))).toBeCloseTo(-dx, 4);
        },
      ),
    );
  });
});

function rot(q: Quat, v: V3): V3 {
  return toWorld({ position: [0, 0, 0], rotation: q }, { min: [0, 0, 0], max: [0, 0, 0] }, v);
}

describe('checkFit (T388)', () => {
  const panel = box(500, 400, 18);
  it('overlap → red issue with depth; touch → fit; small gap listed; far → nothing', () => {
    const r = checkFit([
      part('a', panel, [0, 0, 0]),
      part('b', panel, [498, 0, 0]),
      part('c', panel, [0, 400, 0]),
      part('d', panel, [0, -400.6, 0]),
      part('e', panel, [5000, 0, 0]),
    ]);
    // b also faces d (0,6 mm) and c (touching): every near pair is checked.
    expect(r.issues[0]).toEqual({ kind: 'overlap', a: 'a', b: 'b', depth: 2 });
    expect(r.issues).toContainEqual({ kind: 'gap', a: 'a', b: 'd', gap: 0.6 });
    expect(r.issues).toHaveLength(3);
    expect(r.issues.some((i) => i.a === 'e' || i.b === 'e')).toBe(false);
    expect(r.touching).toBe(2);
    expect(r.parts).toBe(5);
  });
  it('within ±0,05 mm counts as touching', () => {
    const a = part('a', panel, [0, 0, 0]);
    expect(checkFit([a, part('b', panel, [500.04, 0, 0])]).touching).toBe(1);
    expect(checkFit([a, part('b', panel, [499.96, 0, 0])]).touching).toBe(1);
    expect(checkFit([a, part('b', panel, [499.9, 0, 0])]).issues[0]).toMatchObject({
      kind: 'overlap',
      depth: 0.1,
    });
  });
  it('a narrow test replaces the box answer for non-box parts', () => {
    const a = { ...part('a', panel, [0, 0, 0]), boxy: false };
    const b = part('b', panel, [498, 0, 0]);
    expect(checkFit([a, b], () => ({ overlap: false, distance: 0.5 })).issues).toEqual([
      { kind: 'gap', a: 'a', b: 'b', gap: 0.5 },
    ]);
    expect(checkFit([a, b], () => ({ overlap: false, distance: Infinity })).issues).toEqual([]);
    expect(checkFit([a, b], () => ({ overlap: true, distance: 0 })).issues[0]).toMatchObject({
      kind: 'overlap',
    });
  });
  it('candidate pairs match the brute-force near pairs', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 0, max: 3000 })), {
          maxLength: 25,
        }),
        (spots) => {
          const parts = spots.map(([x, z], i) => part(`p${i}`, box(300, 200, 18), [x, 0, z]));
          const got = new Set(candidatePairs(parts, 1).map(([i, j]) => `${i}-${j}`));
          for (let i = 0; i < parts.length; i++)
            for (let j = i + 1; j < parts.length; j++) {
              const near = sep(at(parts, i), at(parts, j)) >= -1;
              if (near) expect(got.has(`${i}-${j}`)).toBe(true);
            }
        },
      ),
    );
  });
});

describe('holeAlignment (T388)', () => {
  const panel = box(500, 400, 18);
  const flipX: Quat = qAxisAngle([1, 0, 0], Math.PI);
  // a's top face (z = 9 world) against b's top face turned down (b flipped about X, above a).
  const dowel = (cx: number, cy: number): FitHole => ({ cx, cy, d: 8, through: false });
  it('matching dowel holes are green, a 1,5 mm offset is orange', () => {
    const a = part('a', panel, [0, 0, 0], IDENTITY, [dowel(50, 50), dowel(450, 50)]);
    // b flipped about X: local (x, y) → world (x - 250, -(y - 200)); a: (x - 250, y - 200).
    // a's hole (50, 50) sits at world (-200, -150): b's hole at local (50, 350) matches.
    const b = part('b', panel, [0, 0, 18], flipX, [dowel(50, 350), dowel(451.5, 350)]);
    const out = holeAlignment(a, b);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'hole', ok: true, offset: 0 });
    expect(out[1]).toMatchObject({ kind: 'hole', ok: false, offset: 1.5 });
  });
  it('no partner within 10 mm → nothing; faces apart > 1 mm → nothing', () => {
    const a = part('a', panel, [0, 0, 0], IDENTITY, [dowel(50, 50)]);
    expect(holeAlignment(a, part('b', panel, [0, 0, 18], flipX, [dowel(80, 350)]))).toEqual([]);
    expect(holeAlignment(a, part('b', panel, [0, 0, 20], flipX, [dowel(50, 350)]))).toEqual([]);
  });
  it('a blind hole on the bottom face does not count; a through hole does', () => {
    const a = part('a', panel, [0, 0, 0], IDENTITY, [dowel(50, 50)]);
    // b below a, not flipped: b's top face (with its holes) faces a's bottom face.
    const under = part('b', panel, [0, 0, -18], IDENTITY, [dowel(50, 50)]);
    expect(holeAlignment(a, under)).toEqual([]);
    const aThrough = part('a', panel, [0, 0, 0], IDENTITY, [
      { cx: 50, cy: 50, d: 5, through: true },
    ]);
    expect(holeAlignment(aThrough, under)).toHaveLength(1);
  });
  it('checkFit lists hole issues with the touching pair, offsets first', () => {
    const a = part('a', panel, [0, 0, 0], IDENTITY, [dowel(50, 50), dowel(450, 50)]);
    const b = part('b', panel, [0, 0, 18], flipX, [dowel(50, 350), dowel(451.5, 350)]);
    const r = checkFit([a, b]);
    expect(r.touching).toBe(1);
    expect(r.issues.map((i) => (i.kind === 'hole' ? i.ok : null))).toEqual([false, true]);
  });
});

describe('toLocal / toWorld', () => {
  it('round-trip', () => {
    const pose: Pose = { position: [10, 20, 30], rotation: qAxisAngle([1, 2, 3], 0.7) };
    const b = box(100, 50, 18);
    const w = toWorld(pose, b, [12, 34, 5]);
    const l = toLocal(pose, b, w);
    expect(l[0]).toBeCloseTo(12, 9);
    expect(l[1]).toBeCloseTo(34, 9);
    expect(l[2]).toBeCloseTo(5, 9);
  });
});
