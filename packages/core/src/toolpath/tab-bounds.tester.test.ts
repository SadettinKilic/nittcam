import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { TAB_BOUNDS, maxTabHeight, tabSizeProblem } from './tabs';
import { clone, machineOf, projectOf } from './toolpath.testing';

// Tester (B40, T293): the holding bounds as invariants, for any size a hand-edited project JSON
// can carry (the schema only asks > 0). A small part held only by a tab below the bounds never
// reaches an NC file; a size inside the bounds never raises the new error.

function project(thickness: number, cutting: Record<string, unknown>): Project {
  const base = clone(
    projectOf({
      thickness,
      parts: [
        { id: 'big', w: 600, h: 400, qty: 1 },
        { id: 's', w: 80, h: 80, qty: 1 },
      ],
      placements: [
        [
          { partId: 'big', index: 0, x: 20, y: 20, rot: 0 },
          { partId: 's', index: 0, x: 700, y: 20, rot: 0 },
        ],
      ],
    }),
  ) as unknown as { cutting: Record<string, unknown> };
  base.cutting = { tabs: { auto: false }, leadIn: 'arc', direction: 'climb', ...cutting };
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

const errorsOf = (p: Project, thickness: number) =>
  buildToolpath(p, machineOf({ thickness })).errors.map((i) => i.code);

const thicknessArb = fc.constantFrom(5, 8, 12, 18, 25);
const sizeArb = fc.double({ min: 0.001, max: 30, noNaN: true, noDefaultInfinity: true });

describe('tab bounds invariants (tester, T293)', () => {
  it('tabSizeProblem is null exactly when width ≥ 3 and 1 ≤ height ≤ t − 1', () => {
    fc.assert(
      fc.property(sizeArb, sizeArb, thicknessArb, (w, h, t) => {
        const holds = w >= TAB_BOUNDS.minWidth && h >= TAB_BOUNDS.minHeight && h <= maxTabHeight(t);
        expect(tabSizeProblem(w, h, t) === null).toBe(holds);
      }),
    );
  });

  it('hand-edited sizes: a small part on bad tabs is an error and no NC file is made', () => {
    fc.assert(
      fc.property(sizeArb, sizeArb, thicknessArb, (w, h, t) => {
        const p = project(t, { tabs: { auto: false, width: w, height: h } });
        const bad = tabSizeProblem(w, h, t) !== null;
        const errs = errorsOf(p, t);
        // A height ≥ thickness was refused before T293 already (INVALID_TAB); both stop the file.
        const refused = errs.includes('SMALL_PART_TAB_TOO_SMALL') || errs.includes('INVALID_TAB');
        expect(refused).toBe(bad);
        if (!bad) expect(errs).toEqual([]);
        if (bad) {
          const r = exportNc(
            p,
            { profile: goldenProfile('generic'), version: 1, verification: 'draft' },
            postConfig('generic'),
          );
          expect(r.ok).toBe(false);
          expect(r.files ?? []).toEqual([]);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('PO edge values: 18 mm width 2.99/3, height 0.99/1 and 17/17.1; 5 mm height 4/4.5', () => {
    const err = (t: number, w: number, h: number) =>
      errorsOf(project(t, { tabs: { auto: false, width: w, height: h } }), t).includes(
        'SMALL_PART_TAB_TOO_SMALL',
      );
    expect(err(18, 2.99, 3)).toBe(true);
    expect(err(18, 3, 3)).toBe(false);
    expect(err(18, 6, 0.99)).toBe(true);
    expect(err(18, 6, 1)).toBe(false);
    expect(err(18, 6, 17)).toBe(false);
    expect(err(18, 6, 17.1)).toBe(true);
    expect(err(5, 6, 4)).toBe(false);
    expect(err(5, 6, 4.5)).toBe(true);
    expect(err(18, 0.1, 0.01)).toBe(true);
  });

  it('a height valid on 18 mm is refused on thinner stock (the resolved size is checked)', () => {
    expect(errorsOf(project(5, { tabs: { auto: false, height: 4.5 } }), 5)).toContain(
      'SMALL_PART_TAB_TOO_SMALL',
    );
    expect(errorsOf(project(5, { tabs: { auto: false, height: 17 } }), 5)).toContain('INVALID_TAB');
  });

  it('"Köprü: Kapalı" (skin, no tabs) with a bad stored tab size: no new error', () => {
    const p = project(18, {
      tabs: { auto: false, width: 0.1, height: 0.01 },
      skin: { thickness: 0.5 },
    });
    expect(errorsOf(p, 18)).not.toContain('SMALL_PART_TAB_TOO_SMALL');
  });
});
