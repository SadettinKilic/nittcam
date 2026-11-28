/** T386 / T387: bench seeding, instance matrices, mating and snapping math. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cabinetParts, DEFAULT_CABINET, type Project } from '@nittcam/core';
import tr from '../../messages/tr.json';
import { applyMatrix, assemblyFaceMatrix, cabinetGroups, hasFaceOnlyWork } from './assembly';
import {
  axesOf,
  boxCentre,
  dot,
  edgeSnap,
  eulerDeg,
  faceFrame,
  faceFromNormal,
  instanceMatrix,
  mate,
  meshVolume,
  qAxisAngle,
  qMul,
  qNormalize,
  quatFromEulerDeg,
  slideOnFace,
  turnAbout,
  worldBounds,
  type LocalBox,
  type Pose,
  type Quat,
  type V3,
} from './assembly-math';
import { benchItems, FLAT, instanceOf, localBoxOf, seedPoses } from './assembly-model';
import { cachedPartMesh } from './sheet-scene';

const roles = tr.cutList.cabinet.roles;

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing');
  return v;
}

function projectWith(parts: unknown[], assembly?: unknown): Project {
  return {
    stock: { thickness: 18 },
    settings: { dimensionMode: 'finished' },
    parts,
    ...(assembly ? { assembly } : {}),
  } as unknown as Project;
}

const rect = (id: string, w: number, h: number, qty = 1) => ({
  id,
  name: id,
  qty,
  kind: 'rect',
  params: { w, h, r: 0 },
  holes: [] as unknown[],
  inners: [] as unknown[],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
});

function generated(group: string) {
  const r = cabinetParts({ ...DEFAULT_CABINET, width: 600 });
  if (!r.ok) throw new Error(r.error);
  return r.parts.map((x, i) => ({
    ...rect(`${group}-${i}`, x.w, x.h, x.qty),
    name: roles[x.role],
    group,
    ...(x.thickness !== 18 ? { note: `${x.thickness} mm` } : {}),
    edgeBand: x.edgeBand,
  }));
}

const close = (a: readonly number[], b: readonly number[], eps = 1e-6) =>
  a.every((v, i) => Math.abs(v - (b[i] ?? NaN)) <= eps);

const quatArb = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter((q) => Math.hypot(...q) > 0.1)
  .map((q) => qNormalize(q as Quat));

describe('seedPoses (T386)', () => {
  it('cabinet boards stand where the read-only view puts them (T158 face matrix)', () => {
    const p = projectWith([...generated('Dolap 1'), rect('loose', 400, 300)]);
    const seeds = seedPoses(p, roles);
    const g = must(cabinetGroups(p, roles)[0]);
    const copies = new Map<string, number>();
    for (const b of g.assembly.boxes) {
      const part = must(g.parts.get(b.id));
      const copy = copies.get(b.id) ?? 0;
      copies.set(b.id, copy + 1);
      const mesh = cachedPartMesh(part, b.role === 'back' ? 8 : 18);
      const box = localBoxOf(mesh);
      const seed = must(seeds.get(`${b.id}#${copy}`));
      expect(seed.role).toBe(b.role);
      const expected = assemblyFaceMatrix(b, g.assembly.width, hasFaceOnlyWork(part, 18));
      const got = instanceMatrix(seed.pose, boxCentre(box));
      // Same corners in the world (rounded storage: within 0.01 mm).
      for (const c of [box.min, box.max]) {
        expect(close(applyMatrix(got, ...c), applyMatrix(expected, ...c), 0.01)).toBe(true);
      }
    }
  });

  it('other parts lie flat in rows on the bench, not overlapping, in front of the cabinets', () => {
    const p = projectWith([
      ...generated('Dolap 1'),
      rect('a', 400, 300, 3),
      rect('b', 2000, 600, 2),
    ]);
    const seeds = seedPoses(p, roles);
    const loose = ['a#0', 'a#1', 'a#2', 'b#0', 'b#1'].map((id) => must(seeds.get(id)));
    const depth = must(cabinetGroups(p, roles)[0]).assembly.depth;
    const bounds = loose.map((s, i) => {
      expect(close(s.pose.rotation, FLAT, 1e-6)).toBe(true);
      const w = i < 3 ? 400 : 2000;
      const h = i < 3 ? 300 : 600;
      return worldBounds(s.pose, { min: [0, 0, 0], max: [w, h, 18] });
    });
    for (const b of bounds) {
      expect(b.min[1]).toBeCloseTo(0, 3);
      expect(b.min[2]).toBeGreaterThanOrEqual(depth);
    }
    for (let i = 0; i < bounds.length; i++)
      for (let j = i + 1; j < bounds.length; j++) {
        const a = must(bounds[i]);
        const b = must(bounds[j]);
        const apart =
          a.max[0] <= b.min[0] + 1e-6 ||
          b.max[0] <= a.min[0] + 1e-6 ||
          a.max[2] <= b.min[2] + 1e-6 ||
          b.max[2] <= a.min[2] + 1e-6;
        expect(apart).toBe(true);
      }
  });

  it('a project without cabinets starts its bench at the origin', () => {
    const s = must(seedPoses(projectWith([rect('a', 400, 300)]), roles).get('a#0'));
    expect(s.pose.position).toEqual([200, 9, 150]);
  });
});

describe('benchItems (T386)', () => {
  it('one item per copy; a stored instance wins over the seed', () => {
    const p = projectWith([rect('a', 400, 300, 2)], {
      instances: [
        {
          id: 'a#1',
          partId: 'a',
          copy: 1,
          position: [1, 2, 3],
          rotation: [0, 0, 0, 1],
          hidden: true,
        },
      ],
      updatedAt: '2026-11-28T10:00:00Z',
    });
    const items = benchItems(p, roles);
    expect(items.map((i) => [i.id, i.placed, i.hidden])).toEqual([
      ['a#0', false, false],
      ['a#1', true, true],
    ]);
    expect(items[1]?.pose.position).toEqual([1, 2, 3]);
    const stored = instanceOf(must(items[0]), must(items[0]).pose);
    expect(stored).toMatchObject({ id: 'a#0', partId: 'a', copy: 0, hidden: false });
  });
});

describe('instance matrix (T386 property)', () => {
  const part = rect('p', 500, 320);
  const mesh = cachedPartMesh(part as never, 18);
  const box = localBoxOf(mesh);
  const local = meshVolume(mesh.positions, mesh.indices);

  it('rotation keeps the volume and the bounding size', () => {
    fc.assert(
      fc.property(
        quatArb,
        fc.tuple(
          fc.double({ min: -5000, max: 5000, noNaN: true }),
          fc.double({ min: -5000, max: 5000, noNaN: true }),
          fc.double({ min: -5000, max: 5000, noNaN: true }),
        ),
        (rotation, position) => {
          const pose: Pose = { position: position as V3, rotation };
          const m = instanceMatrix(pose, boxCentre(box));
          expect(meshVolume(mesh.positions, mesh.indices, m)).toBeCloseTo(local, 0);
          // Box edges keep their lengths; the centre lands on `position`.
          const o = applyMatrix(m, ...box.min);
          const ex = applyMatrix(m, box.max[0], box.min[1], box.min[2]);
          const ey = applyMatrix(m, box.min[0], box.max[1], box.min[2]);
          const ez = applyMatrix(m, box.min[0], box.min[1], box.max[2]);
          const d = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          expect(d(o, ex)).toBeCloseTo(500, 6);
          expect(d(o, ey)).toBeCloseTo(320, 6);
          expect(d(o, ez)).toBeCloseTo(18, 6);
          expect(close(applyMatrix(m, ...boxCentre(box)), position, 1e-6)).toBe(true);
        },
      ),
    );
  });

  it('90° turns permute the world size', () => {
    const pose: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const turned = turnAbout(pose, 2, 90);
    const b = worldBounds(turned, box);
    expect(
      close(
        b.max.map((v, i) => v - must(b.min[i])),
        [320, 500, 18],
        1e-9,
      ),
    ).toBe(true);
  });
});

describe('euler fields (T387)', () => {
  it('round trip within 0.01°', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -179, max: 179 }),
        fc.integer({ min: -89, max: 89 }),
        fc.integer({ min: -179, max: 179 }),
        (x, y, z) => {
          expect(close(eulerDeg(quatFromEulerDeg([x, y, z])), [x, y, z], 0.011)).toBe(true);
        },
      ),
    );
  });
});

describe('face-to-face mate (T387)', () => {
  const side: LocalBox = { min: [0, 0, 0], max: [560, 720, 18] };
  const deck: LocalBox = { min: [0, 0, 0], max: [564, 560, 18] };
  // A side standing: local z (thickness) along world x, its inner face looking +x.
  const sidePose: Pose = { position: [9, 360, 280], rotation: qAxisAngle([0, 1, 0], Math.PI / 2) };

  it('faces end up flush with opposite normals, squared and pulled to the edge', () => {
    fc.assert(
      fc.property(quatArb, (start) => {
        const faceA = faceFromNormal(sidePose.rotation, [1, 0, 0]);
        const deckPose: Pose = { position: [2000, 0, 0], rotation: start };
        // The deck's end face: its local -x face.
        const faceB = { axis: 0 as const, sign: -1 as const };
        // Clicked near the bottom front corner of the side's inner face.
        const out = mate(sidePose, side, faceA, deckPose, deck, faceB, [18, 15, 550]);
        const fa = faceFrame(sidePose, side, faceA);
        const fb = faceFrame(out, deck, faceB);
        expect(dot(fa.normal, fb.normal)).toBeCloseTo(-1, 9);
        // Flush: B's face lies in A's plane.
        expect(dot(fb.centre, fa.normal)).toBeCloseTo(dot(fa.centre, fa.normal), 6);
        // Squared: every B axis is parallel to a world axis here.
        for (const a of axesOf(out.rotation))
          expect(Math.max(...a.map(Math.abs))).toBeCloseTo(1, 9);
      }),
    );
  });

  it("a lying deck mated near the side's bottom corner is pulled flush to both edges", () => {
    const faceA = faceFromNormal(sidePose.rotation, [1, 0, 0]);
    const out = mate(
      sidePose,
      side,
      faceA,
      { position: [0, 0, 0], rotation: FLAT },
      deck,
      {
        axis: 0,
        sign: -1,
      },
      [18, 15, 300],
    );
    const b = worldBounds(out, deck);
    expect(close([...b.min, ...b.max], [18, 0, 0, 582, 18, 560], 1e-6)).toBe(true);
  });

  it('sliding keeps the faces flush and snaps edges within 2 mm', () => {
    const faceA = faceFromNormal(sidePose.rotation, [1, 0, 0]);
    const fa = faceFrame(sidePose, side, faceA);
    const start = mate(sidePose, side, faceA, { position: [0, 0, 0], rotation: FLAT }, deck, {
      axis: 0,
      sign: -1,
    });
    // Up by 301,5 mm along y and 7 mm along x (off the plane): x is dropped, y does not snap.
    const moved = slideOnFace(start, deck, fa, [7, 301.5, 0]);
    expect(dot(moved.pose.position, fa.normal)).toBeCloseTo(dot(start.position, fa.normal), 9);
    expect(moved.pose.position[1] - start.position[1]).toBeCloseTo(301.5, 9);
    // 1,5 mm short of the top edge: snaps flush.
    const top = 720 - worldBounds(moved.pose, deck).max[1];
    const snapped = slideOnFace(moved.pose, deck, fa, [0, top - 1.5, 0]);
    expect(worldBounds(snapped.pose, deck).max[1]).toBeCloseTo(720, 9);
    expect(snapped.snappedV || snapped.snappedU).toBe(true);
  });

  it('edgeSnap picks the nearest flush line within the tolerance', () => {
    expect(edgeSnap([1, 11], [0, 100], 2)).toEqual({ shift: -1, snapped: true });
    expect(edgeSnap([50, 60], [0, 100], 2)).toEqual({ shift: 0, snapped: false });
    expect(edgeSnap([101.5, 120], [0, 100], 2).shift).toBeCloseTo(-1.5);
  });

  it('qMul composes rotations', () => {
    const a = qAxisAngle([0, 0, 1], Math.PI / 2);
    const twice = qMul(a, a);
    expect(close(axesOf(twice)[0], [-1, 0, 0], 1e-12)).toBe(true);
  });
});
