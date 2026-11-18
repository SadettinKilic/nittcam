import { arcOf, type Vertex } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import {
  backspace,
  clickAt,
  enter,
  fieldsFor,
  hintFor,
  parseTyped,
  preview,
  type DrawDraft,
  type DrawStep,
  type DrawTool,
} from './draw-tool';

/** Clicks through points with one tool; returns the last step. */
function clicks(tool: DrawTool, pts: [number, number][], start: DrawDraft | null = null): DrawStep {
  let step: DrawStep = { draft: start };
  for (const [x, y] of pts) step = clickAt(tool, step.draft, { x, y });
  return step;
}

describe('draw tool state machine (T127–T129)', () => {
  it('parses typed numbers with a decimal comma', () => {
    expect(parseTyped('596')).toBe(596);
    expect(parseTyped('12,5')).toBe(12.5);
    expect(parseTyped('')).toBeUndefined();
    expect(parseTyped('-')).toBeUndefined();
    expect(parseTyped('abc')).toBeUndefined();
  });

  it('rectangle: click-click gives a parametric rect at the lower-left corner', () => {
    const s = clicks('rect', [
      [100, 300],
      [400, 50],
    ]);
    expect(s.draft).toBeNull();
    expect(s.commit).toEqual({
      at: { x: 100, y: 50 },
      shape: { kind: 'rect', params: { w: 300, h: 250, r: 0 } },
    });
  });

  it('rectangle: typed W;H is exact and grows towards the cursor', () => {
    const first = clickAt('rect', null, { x: 10, y: 10 });
    expect(fieldsFor('rect', first.draft)).toEqual(['w', 'h']);
    const s = enter('rect', first.draft, { x: -3.7, y: 99.1 }, { w: 596, h: 716 });
    expect(s.commit).toEqual({
      at: { x: -586, y: 10 },
      shape: { kind: 'rect', params: { w: 596, h: 716, r: 0 } },
    });
  });

  it('rectangle: a zero-size second click keeps drawing', () => {
    const s = clicks('rect', [
      [5, 5],
      [5, 40],
    ]);
    expect(s.commit).toBeUndefined();
    expect(s.draft?.kind).toBe('rect');
  });

  it('circle: centre + typed radius → freeform circle of that radius', () => {
    const first = clickAt('circle', null, { x: 500, y: 500 });
    expect(fieldsFor('circle', first.draft)).toEqual(['r']);
    const s = enter('circle', first.draft, { x: 0, y: 0 }, { r: 150 });
    expect(s.commit?.at).toEqual({ x: 350, y: 350 });
    expect(s.commit?.shape.kind).toBe('outline');
    if (s.commit?.shape.kind !== 'outline') return;
    const [a, b] = s.commit.shape.vertices;
    expect(arcOf(a as Vertex, b as Vertex, (a as Vertex).bulge)?.radius).toBeCloseTo(150, 9);
  });

  it('line: typed lengths and angles draw an exact L-shape that closes into a part', () => {
    let step = clickAt('line', null, { x: 0, y: 0 });
    const typed: [number, number][] = [
      [600, 0],
      [300, 90],
      [300, 180],
      [300, 90],
      [300, 180],
    ];
    for (const [length, angle] of typed) {
      step = enter('line', step.draft, { x: 9, y: 9 }, { length, angle });
      expect(step.commit).toBeUndefined();
    }
    // close by clicking the start
    step = clickAt('line', step.draft, { x: 0, y: 0 });
    expect(step.draft).toBeNull();
    expect(step.commit?.shape.kind).toBe('outline');
    if (step.commit?.shape.kind !== 'outline') return;
    expect(step.commit.shape.vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 0],
      [600, 0],
      [600, 300],
      [300, 300],
      [300, 600],
      [0, 600],
    ]);
  });

  it('line: a typed length follows the cursor direction; Shift locks to 45°', () => {
    const s0 = clickAt('line', null, { x: 0, y: 0 });
    const s1 = enter('line', s0.draft, { x: 0, y: 50 }, { length: 200 });
    expect(s1.draft?.kind === 'path' && s1.draft.pts.at(-1)).toMatchObject({ x: 0, y: 200 });
    const s2 = clickAt('line', s1.draft, { x: 300, y: 207 }, {}, true);
    expect(s2.draft?.kind === 'path' && s2.draft.pts.at(-1)).toMatchObject({ x: 300, y: 200 });
  });

  it('line: Enter without values finishes an open path; Backspace removes vertices', () => {
    const s = clicks('line', [
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    const done = enter('line', s.draft, { x: 0, y: 0 }, {});
    expect(done.draft).toMatchObject({ kind: 'path', open: true });
    expect(hintFor('line', done.draft, preview('line', done.draft, { x: 0, y: 0 }))).toBe('open');
    expect(fieldsFor('line', done.draft)).toEqual([]);
    const b1 = backspace(done.draft);
    expect(b1?.kind === 'path' && b1.pts.length).toBe(2);
    expect(backspace(backspace(b1))).toBeNull();
    // a click resumes an open path
    const resumed = clickAt('line', done.draft, { x: 0, y: 100 });
    expect(resumed.draft).toMatchObject({ kind: 'path', open: false });
  });

  it('line: two straight segments back to the start do not close (no area)', () => {
    const s = clicks('line', [
      [0, 0],
      [100, 0],
      [0, 0],
    ]);
    expect(s.commit).toBeUndefined();
  });

  it('preview: closing is flagged when the cursor is on the start', () => {
    const s = clicks('line', [
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    const v = preview('line', s.draft, { x: 0.01, y: 0 });
    expect(v?.closing).toBe(true);
    expect(hintFor('line', s.draft, v)).toBe('lineClose');
    expect(v?.live.length).toBeCloseTo(Math.hypot(99.99, 100), 6);
  });

  it('arc: start, end, point on the arc → bulge; a half circle closes with a line', () => {
    let s = clicks('arc', [
      [0, 0],
      [200, 0],
    ]);
    expect(s.draft).toMatchObject({ kind: 'path', pending: { x: 200, y: 0 } });
    expect(fieldsFor('arc', s.draft)).toEqual(['r']);
    expect(hintFor('arc', s.draft, null)).toBe('arcBend');
    s = clickAt('arc', s.draft, { x: 100, y: -100 }); // below the chord = CCW half circle
    expect(s.draft?.kind === 'path' && s.draft.pts[0]?.bulge).toBeCloseTo(1, 9);
    // switch to the line tool and close
    s = clickAt('line', s.draft, { x: 0, y: 0 });
    expect(s.commit?.shape.kind).toBe('outline');
    if (s.commit?.shape.kind !== 'outline') return;
    expect(s.commit.shape.vertices).toHaveLength(2);
  });

  it('arc: a typed radius sets the arc radius; too small is refused', () => {
    const s = clicks('arc', [
      [0, 0],
      [300, 0],
    ]);
    const v = preview('arc', s.draft, { x: 150, y: -10 }, { r: 250 });
    expect(v?.live.r).toBeCloseTo(250, 6);
    expect(v?.centre).not.toBeNull();
    const ok = enter('arc', s.draft, { x: 150, y: -10 }, { r: 250 });
    const p = ok.draft?.kind === 'path' ? ok.draft.pts : [];
    const [q0, q1] = p as [Vertex, Vertex];
    expect(arcOf(q0, q1, q0.bulge)?.radius).toBeCloseTo(250, 9);
    const bad = enter('arc', s.draft, { x: 150, y: -10 }, { r: 100 });
    expect(bad.draft).toBe(s.draft);
  });

  it('hints follow the state', () => {
    expect(hintFor('rect', null, null)).toBe('rectStart');
    expect(hintFor('rect', { kind: 'rect', a: { x: 0, y: 0 } }, null)).toBe('rectEnd');
    expect(hintFor('circle', null, null)).toBe('circleStart');
    expect(hintFor('line', null, null)).toBe('lineStart');
    expect(hintFor('arc', null, null)).toBe('arcStart');
  });
});
