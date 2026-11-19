/**
 * T135: the drawing board arranges parts in a non-overlapping area. Parts without a `draw`
 * position never overlap each other or a placed part, whatever their sizes; drawing positions
 * are not nesting positions (the layout is untouched).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { projectOf } from '../toolpath/toolpath.testing';
import { boardParts } from './board';

describe('board arrangement (T135)', () => {
  it('property: auto-arranged parts never overlap each other or the placed ones', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            w: fc.integer({ min: 10, max: 3000 }),
            h: fc.integer({ min: 10, max: 2000 }),
            placed: fc.option(
              fc.record({
                x: fc.integer({ min: -2000, max: 2000 }),
                y: fc.integer({ min: -2000, max: 2000 }),
              }),
              { freq: 3 },
            ),
          }),
          { minLength: 1, maxLength: 25 },
        ),
        (specs) => {
          const base = projectOf({ parts: specs.map((s, i) => ({ id: `p${i}`, w: s.w, h: s.h })) });
          const project = {
            ...base,
            parts: base.parts.map((p, i) => {
              const at = specs[i]?.placed;
              return at ? { ...p, draw: at } : p;
            }),
          };
          const parts = boardParts(project);
          for (let i = 0; i < parts.length; i++) {
            for (let j = i + 1; j < parts.length; j++) {
              const a = parts[i];
              const b = parts[j];
              if (!a || !b || (a.placed && b.placed)) continue; // the user may overlap placed parts
              const overlap =
                a.box.minX < b.box.maxX - 1e-9 &&
                b.box.minX < a.box.maxX - 1e-9 &&
                a.box.minY < b.box.maxY - 1e-9 &&
                b.box.minY < a.box.maxY - 1e-9;
              expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
            }
          }
          expect(project.layout).toEqual(base.layout);
        },
      ),
      { numRuns: 200 },
    );
  });
});
