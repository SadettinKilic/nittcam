import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Polyline } from '@nittcam/core';
import { hasWebGL2, probe, resetWebGL2Cache } from './capability';
import { registerLeaveTransition, runLeaveTransition } from './leave';
import { ARC_STEPS, flatten, flattenOpen } from './outlines';

/**
 * T161: the 3D helpers without a scene (capability probe, leave transition, outline sampling).
 * Scene building, camera, picking and playback have their own unit files; the e2e suite only
 * covers mounting, fixtures as screenshots, the fallback and playback.
 */

function fakeDoc(ctx: unknown, onLose?: () => void) {
  let created = 0;
  return {
    created: () => created,
    doc: {
      createElement: () => {
        created++;
        return {
          getContext: (type: string) => {
            if (type !== 'webgl2') return null;
            if (ctx instanceof Error) throw ctx;
            return ctx === null
              ? null
              : { getExtension: () => ({ loseContext: () => onLose?.() }) };
          },
        };
      },
    } as unknown as Pick<Document, 'createElement'>,
  };
}

describe('WebGL2 capability (T152 fallback)', () => {
  it('true with a context and frees the probe context', () => {
    let lost = 0;
    expect(probe(fakeDoc({}, () => lost++).doc)).toBe(true);
    expect(lost).toBe(1);
  });

  it('false without a document, without WebGL2, or when getContext throws', () => {
    expect(probe(null)).toBe(false);
    expect(probe(fakeDoc(null).doc)).toBe(false);
    expect(probe(fakeDoc(new Error('blocked')).doc)).toBe(false);
  });

  it('caches the first answer until reset', () => {
    resetWebGL2Cache();
    const yes = fakeDoc({});
    expect(hasWebGL2(yes.doc)).toBe(true);
    expect(hasWebGL2(fakeDoc(null).doc)).toBe(true);
    expect(yes.created()).toBe(1);
    resetWebGL2Cache();
    expect(hasWebGL2(fakeDoc(null).doc)).toBe(false);
    resetWebGL2Cache();
  });
});

describe('leave transition (T155 wizard İleri)', () => {
  it('0 without a handler; the handler wait otherwise, never negative', () => {
    expect(runLeaveTransition()).toBe(0);
    const off = registerLeaveTransition(() => 300);
    expect(runLeaveTransition()).toBe(300);
    off();
    expect(runLeaveTransition()).toBe(0);
    const off2 = registerLeaveTransition(() => -5);
    expect(runLeaveTransition()).toBe(0);
    off2();
  });

  it('a stale unregister does not drop the newer handler', () => {
    const offOld = registerLeaveTransition(() => 100);
    const offNew = registerLeaveTransition(() => 200);
    offOld();
    expect(runLeaveTransition()).toBe(200);
    offNew();
    expect(runLeaveTransition()).toBe(0);
  });
});

describe('outline sampling (spec §3.8: arcs tessellated for display only)', () => {
  const square: Polyline = {
    closed: true,
    vertices: [
      { x: 0, y: 0, bulge: 0 },
      { x: 100, y: 0, bulge: 0 },
      { x: 100, y: 50, bulge: 0 },
      { x: 0, y: 50, bulge: 0 },
    ],
  };

  it('straight edges keep their vertices, the closing point is not repeated', () => {
    expect(flatten(square)).toEqual([0, 0, 100, 0, 100, 50, 0, 50]);
  });

  it('a bulged edge becomes ARC_STEPS chords on its circle', () => {
    // Half circle from (0,0) to (100,0) (bulge 1), straight back.
    const half: Polyline = {
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 1 },
        { x: 100, y: 0, bulge: 0 },
      ],
    };
    const flat = flatten(half);
    expect(flat.length / 2).toBe(ARC_STEPS + 1);
    for (let i = 0; i < ARC_STEPS * 2; i += 2) {
      const r = Math.hypot((flat[i] ?? 0) - 50, flat[i + 1] ?? 0);
      expect(r).toBeCloseTo(50, 6);
    }
  });

  it('open polylines end on their last vertex and ignore its bulge', () => {
    const open = flattenOpen([
      { x: 0, y: 0, bulge: 0 },
      { x: 10, y: 0, bulge: 0 },
      { x: 10, y: 10, bulge: 1 },
    ]);
    expect(open).toEqual([0, 0, 10, 0, 10, 10]);
    expect(flattenOpen([])).toEqual([]);
  });

  it('is deterministic and finite for any rectangle', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 1, max: 3000 }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (w, h, bulge) => {
          const p: Polyline = {
            closed: true,
            vertices: [
              { x: 0, y: 0, bulge },
              { x: w, y: 0, bulge: 0 },
              { x: w, y: h, bulge: 0 },
              { x: 0, y: h, bulge: 0 },
            ],
          };
          const a = flatten(p);
          expect(flatten(p)).toEqual(a);
          expect(a.every(Number.isFinite)).toBe(true);
          expect(a.length % 2).toBe(0);
        },
      ),
    );
  });
});
