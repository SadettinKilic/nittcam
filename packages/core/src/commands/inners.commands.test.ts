/**
 * T134: inner contours (cut-outs). Validation cases (inside the outline, no overlap, larger than
 * the tool), storage (CW, part frame), one undo step, and the cut-out moving with the part.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boardPositions } from '../editor/board';
import { checkInnerContour } from '../editor/inners';
import { contour, orientation } from '../geometry/polyline';
import type { Vertex } from '../geometry/types';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import { validateProject } from '../validate';
import type { Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const rect = (x: number, y: number, w: number, h: number): Vertex[] => [
  v(x, y),
  v(x + w, y),
  v(x + w, y + h),
  v(x, y + h),
];
const OUTLINE = rect(0, 0, 400, 300);
const ctx: CommandContext = { actor: 'user', at: '2026-11-19T10:00:00Z' };

describe('checkInnerContour (T134)', () => {
  it('accepts a cut-out inside the outline that the tool fits through', () => {
    expect(checkInnerContour(OUTLINE, [], rect(50, 50, 100, 80), 6)).toBeUndefined();
    // a circle (two arcs) too
    expect(checkInnerContour(OUTLINE, [], [v(200, 150, 1), v(260, 150, 1)], 6)).toBeUndefined();
  });

  it('outside: crossing the outline, touching it, or lying outside', () => {
    expect(checkInnerContour(OUTLINE, [], rect(350, 50, 100, 80), 0)).toBe('outside');
    expect(checkInnerContour(OUTLINE, [], rect(0, 50, 100, 80), 0)).toBe('outside');
    expect(checkInnerContour(OUTLINE, [], rect(500, 50, 100, 80), 0)).toBe('outside');
  });

  it('overlap: crossing, containing or inside another cut-out', () => {
    const other = [rect(50, 50, 100, 80)];
    expect(checkInnerContour(OUTLINE, other, rect(100, 100, 100, 80), 0)).toBe('overlap');
    expect(checkInnerContour(OUTLINE, other, rect(60, 60, 20, 20), 0)).toBe('overlap');
    expect(checkInnerContour(OUTLINE, other, rect(40, 40, 150, 120), 0)).toBe('overlap');
    expect(checkInnerContour(OUTLINE, other, rect(200, 50, 100, 80), 0)).toBeUndefined();
  });

  it('tooSmall: narrower than the tool diameter; fine without a tool', () => {
    expect(checkInnerContour(OUTLINE, [], rect(50, 50, 5, 100), 6)).toBe('tooSmall');
    expect(checkInnerContour(OUTLINE, [], rect(50, 50, 5, 100), 0)).toBeUndefined();
    expect(checkInnerContour(OUTLINE, [], rect(50, 50, 7, 100), 6)).toBeUndefined();
  });

  it('degenerate and self-crossing shapes', () => {
    expect(checkInnerContour(OUTLINE, [], [v(10, 10), v(50, 10), v(90, 10)], 0)).toBe('degenerate');
    expect(
      checkInnerContour(OUTLINE, [], [v(50, 50), v(200, 150), v(200, 50), v(50, 120)], 0),
    ).toBe('crossing');
  });

  it('property: any rectangle strictly inside, wider than the tool, is accepted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 380 }),
        fc.integer({ min: 1, max: 280 }),
        fc.integer({ min: 7, max: 399 }),
        fc.integer({ min: 7, max: 299 }),
        (x, y, w, h) => {
          fc.pre(x + w < 400 && y + h < 300);
          expect(checkInnerContour(OUTLINE, [], rect(x, y, w, h), 6)).toBeUndefined();
        },
      ),
    );
  });
});

function base(): Project {
  return projectOf({ parts: [{ id: 'a', w: 400, h: 300 }] });
}

function shifted(p: Project, vs: Vertex[]): Vertex[] {
  const at = boardPositions(p).get('a') ?? { x: 0, y: 0 };
  return vs.map((q) => ({ x: q.x + at.x, y: q.y + at.y, bulge: q.bulge }));
}

describe('addInnerContour / removeInnerContour (T134)', () => {
  it('stores a drawn CCW shape CW in the part frame; one undo step; rect stays rect', () => {
    const p = base();
    const stack = new CommandStack(p);
    const res = stack.execute(
      'addInnerContour',
      { id: 'a', vertices: shifted(p, rect(50, 60, 100, 80)), toolDiameter: 6 },
      ctx,
    );
    expect(res.ok).toBe(true);
    const part = stack.project.parts[0];
    expect(part?.kind).toBe('rect');
    const inner = part?.inners[0] ?? [];
    expect(orientation(contour(inner))).toBe('cw');
    expect(inner.map((q) => [q.x, q.y]).sort()).toEqual(
      [
        [50, 60],
        [150, 60],
        [150, 140],
        [50, 140],
      ].sort(),
    );
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p));
  });

  it('refuses invalid cut-outs with a reason; removes by index', () => {
    const p = base();
    const out = applyCommand(p, 'addInnerContour', {
      id: 'a',
      vertices: shifted(p, rect(350, 50, 100, 80)),
    });
    expect(out.ok).toBe(false);
    const small = applyCommand(p, 'addInnerContour', {
      id: 'a',
      vertices: shifted(p, rect(50, 50, 4, 100)),
      toolDiameter: 6,
    });
    expect(small.ok).toBe(false);
    const ok = applyCommand(p, 'addInnerContour', {
      id: 'a',
      vertices: shifted(p, rect(50, 50, 100, 100)),
    });
    if (!ok.ok) throw new Error(ok.error.message);
    const overlap = applyCommand(ok.project, 'addInnerContour', {
      id: 'a',
      vertices: shifted(ok.project, rect(100, 100, 100, 100)),
    });
    expect(overlap.ok).toBe(false);
    const removed = applyCommand(ok.project, 'removeInnerContour', { id: 'a', index: 0 });
    if (!removed.ok) throw new Error(removed.error.message);
    expect(removed.project.parts[0]?.inners).toEqual([]);
    expect(applyCommand(ok.project, 'removeInnerContour', { id: 'a', index: 3 }).ok).toBe(false);
  });

  it('the cut-out turns with the part (rotatePart) and stays inside', () => {
    const p = base();
    const ok = applyCommand(p, 'addInnerContour', {
      id: 'a',
      vertices: shifted(p, rect(20, 30, 100, 50)),
    });
    if (!ok.ok) throw new Error(ok.error.message);
    const r = applyCommand(ok.project, 'rotatePart', { ids: ['a'], turns: 90 });
    if (!r.ok) throw new Error(r.error.message);
    const part = r.project.parts[0];
    if (!part || part.kind !== 'rect') throw new Error('rect');
    expect(part.params).toMatchObject({ w: 300, h: 400 });
    expect(checkInnerContour(rect(0, 0, 300, 400), [], part.inners[0] ?? [], 6)).toBeUndefined();
  });
});

describe('validation of inner contours (T134, D-045)', () => {
  function withInner(inner: Vertex[]): Project {
    const p = base();
    return { ...p, parts: p.parts.map((x) => ({ ...x, inners: [inner] })) };
  }
  const machine = machineOf({ toolDiameter: 6 });

  it('too small for the cutting tool: error at the part, on the parts step', () => {
    const issues = validateProject(withInner(rect(50, 50, 4, 100).reverse()), { machine });
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['INNER_CONTOUR_TOO_SMALL', 'parts[0].inners[0]'],
    ]);
    expect(validateProject(withInner(rect(50, 50, 40, 100).reverse()), { machine })).toEqual([]);
  });

  it('outside the outline (e.g. after the part got smaller): error', () => {
    const issues = validateProject(withInner(rect(350, 50, 100, 100).reverse()), { machine });
    expect(issues.map((i) => i.code)).toEqual(['INNER_CONTOUR_INVALID']);
  });
});
