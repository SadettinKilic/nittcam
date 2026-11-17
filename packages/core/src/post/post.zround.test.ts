/**
 * Z rounding toward +Z (PO decision on PR #25, D-025): a written Z is never deeper than the
 * model, and never more than one unit of the last decimal above it.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readGcode } from '../gcode-reader';
import { buildToolpath } from '../toolpath';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import { formatFixedUp } from './format';
import { config, metaFor, SHEET } from './post.testing';
import { generateGcode } from './generate';

describe('formatFixedUp (Z words)', () => {
  it('random values with many decimals: written ≥ value and < value + 1 unit', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.integer({ min: 0, max: 6 }),
        (v, d) => {
          const s = formatFixedUp(v, d);
          const w = Number(s);
          expect(s).toMatch(d === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+\\.\\d{${d}}$`));
          // the snap slack (1e-6 of a unit) absorbs float noise only
          expect(w).toBeGreaterThanOrEqual(v - 1e-6 * 10 ** -d);
          expect(w - v).toBeLessThan(10 ** -d);
        },
      ),
      { numRuns: 5000 },
    );
  });
  it('hand cases', () => {
    expect(formatFixedUp(-3.1635, 3)).toBe('-3.163');
    expect(formatFixedUp(-18.5, 3)).toBe('-18.500');
    expect(formatFixedUp(-12.199999999999999, 3)).toBe('-12.200');
    expect(formatFixedUp(-6.1000001, 3)).toBe('-6.100');
    expect(formatFixedUp(-0.0004, 3)).toBe('0.000');
    expect(formatFixedUp(20.0001, 3)).toBe('20.001');
  });
});

describe('generated programs: no Z deeper than the model', () => {
  it('random thickness and spoilboard with many decimals, both posts', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 3, max: 30, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 1.5, max: 12, noNaN: true }),
        fc.constantFrom('generic' as const, 'mach3' as const),
        (thickness, spoilboard, passDepth, post) => {
          const profile = machineOf({ thickness, spoilboard, passDepth, toolDiameter: 6 });
          profile.post = { id: post, version: '1.0.0' };
          profile.toolChanger =
            post === 'generic'
              ? { type: 'auto', capacity: 8, lengthCompensation: false }
              : { type: 'manual', capacity: 1, lengthCompensation: false };
          const project = projectOf({
            parts: [{ id: 'a', w: 300, h: 200, r: 10 }],
            sheet: SHEET,
            thickness,
            placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
          });
          const tp = buildToolpath(project, profile);
          fc.pre(tp.ok);
          const res = generateGcode(
            tp.toolpath,
            { profile, version: 1, verification: 'draft' },
            config(post),
            metaFor(thickness),
          );
          expect(res.errors).toEqual([]);
          const target = tp.toolpath.targetDepth;
          const unit = 10 ** -config(post).decimals.z;
          const read = readGcode(res.files[0]?.content ?? '', {});
          expect(read.errors).toEqual([]);
          const minZ = Math.min(...read.moves.map((m) => m.to.z));
          // Z zero = material top in machineOf: machine Z = sheet Z.
          expect(minZ).toBeGreaterThanOrEqual(target - 1e-9);
          expect(minZ - target).toBeLessThan(unit);
          // every pass depth written at or above its model depth
          const depths = new Set(tp.toolpath.operations.flatMap((o) => o.passDepths));
          for (const z of depths) {
            const w = read.moves.map((m) => m.to.z).filter((v) => Math.abs(v - z) < unit);
            expect(w.length).toBeGreaterThan(0);
            for (const v of w) expect(v).toBeGreaterThanOrEqual(z - 1e-9);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
