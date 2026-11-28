/** T389: measure snapping (vertex > edge > face) and point / face distances. */
import { describe, expect, it } from 'vitest';
import { IDENTITY, qAxisAngle, type V3 } from './assembly-math';
import { measure, snapPick, type MeasurePick, type MeasureTarget } from './assembly-measure';

// A 100 × 50 × 18 board's top outline as contour segments, centred at the world origin.
const top = [
  [0, 0, 18, 100, 0, 18],
  [100, 0, 18, 100, 50, 18],
  [100, 50, 18, 0, 50, 18],
  [0, 50, 18, 0, 0, 18],
].flat();
const board = (rotation = IDENTITY): MeasureTarget => ({
  id: 'b',
  pose: { position: [0, 0, 0], rotation },
  box: { min: [0, 0, 0], max: [100, 50, 18] },
  edges: top,
});
const up: V3 = [0, 0, 1];

describe('snapPick (T389)', () => {
  it('snaps to a corner within the tolerance', () => {
    const p = snapPick(board(), [48, 23, 9], up, 3);
    expect(p.kind).toBe('vertex');
    expect(p.point).toEqual([50, 25, 9]);
  });
  it('snaps to an edge when no corner is near', () => {
    const p = snapPick(board(), [0, 24, 9], up, 3);
    expect(p.kind).toBe('edge');
    expect(p.point[1]).toBeCloseTo(25, 9);
    expect(p.point[0]).toBeCloseTo(0, 9);
  });
  it('stays on the face otherwise', () => {
    expect(snapPick(board(), [0, 0, 9], up, 3)).toMatchObject({ kind: 'face', point: [0, 0, 9] });
  });
  it('follows the part pose', () => {
    // Turned 90° about Z: local corner (100, 50) → world (-25, 50).
    const p = snapPick(board(qAxisAngle([0, 0, 1], Math.PI / 2)), [-24, 49, 9], up, 3);
    expect(p.kind).toBe('vertex');
    expect(p.point[0]).toBeCloseTo(-25, 9);
    expect(p.point[1]).toBeCloseTo(50, 9);
  });
});

describe('measure (T389)', () => {
  const pick = (point: V3, kind: MeasurePick['kind'], normal: V3 = up): MeasurePick => ({
    id: 'x',
    point,
    kind,
    normal,
  });
  it('point to point: distance and per-axis deltas', () => {
    const m = measure(pick([0, 0, 0], 'vertex'), pick([300, 400, 0], 'vertex'));
    expect(m.distance).toBe(500);
    expect(m.delta).toEqual([300, 400, 0]);
    expect(m.faceGap).toBeNull();
  });
  it('face to face: the distance between parallel planes, not the points', () => {
    const m = measure(pick([0, 0, 18], 'face'), pick([120, 40, 36], 'face', [0, 0, -1]));
    expect(m.faceGap).toBe(18);
    expect(m.distance).toBeGreaterThan(18);
  });
  it('faces at an angle have no face gap', () => {
    expect(measure(pick([0, 0, 0], 'face'), pick([1, 0, 0], 'face', [1, 0, 0])).faceGap).toBeNull();
  });
});
