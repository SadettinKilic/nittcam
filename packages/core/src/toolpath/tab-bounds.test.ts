import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { TAB_BOUNDS, maxTabHeight, tabSizeProblem } from './tabs';
import { clone, machineOf, projectOf } from './toolpath.testing';

// T293 (CTO #11 A, D-069): tabs below 3 mm wide or outside 1 … thickness − 1 mm high do not hold
// a part. The command refuses them, and the toolpath refuses a small part held only by them,
// whatever the size came from (old or hand-edited project, material set).

const codes = (p: Project, thickness = 18, tabs?: { width?: number; height?: number }) => {
  const machine = machineOf({ thickness });
  const set = machine.materials[0];
  if (tabs && set) machine.materials[0] = { ...set, tabs: { count: 4, ...tabs } } as never;
  const r = buildToolpath(p, machine);
  return {
    errors: r.errors.map((i) => i.code),
    warnings: r.warnings.map((i) => i.code),
  };
};

/** A 600 × 400 part and two 80 × 80 small parts; `cutting` as given (no schema checks bypassed). */
function project(thickness = 18, cutting: Record<string, unknown> = {}): Project {
  const base = clone(
    projectOf({
      thickness,
      parts: [
        { id: 'big', w: 600, h: 400, qty: 1 },
        { id: 's', w: 80, h: 80, qty: 2 },
      ],
      placements: [
        [
          { partId: 'big', index: 0, x: 20, y: 20, rot: 0 },
          { partId: 's', index: 0, x: 700, y: 20, rot: 0 },
          { partId: 's', index: 1, x: 800, y: 20, rot: 0 },
        ],
      ],
    }),
  ) as unknown as { cutting: Record<string, unknown> };
  base.cutting = { tabs: { auto: false }, leadIn: 'arc', direction: 'climb', ...cutting };
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

describe('tab size bounds (T293)', () => {
  it('tabSizeProblem: width ≥ 3, height 1 … t − 1', () => {
    expect(TAB_BOUNDS).toEqual({ minWidth: 3, minHeight: 1, belowThickness: 1 });
    expect(maxTabHeight(18)).toBe(17);
    expect(tabSizeProblem(3, 1, 18)).toBeNull();
    expect(tabSizeProblem(3, 17, 18)).toBeNull();
    expect(tabSizeProblem(2.99, 3, 18)).toBe('width');
    expect(tabSizeProblem(10, 0.99, 18)).toBe('height');
    expect(tabSizeProblem(10, 17.01, 18)).toBe('height');
    expect(tabSizeProblem(0.1, 0.01, 18)).toBe('width');
  });

  it('setTabs refuses sizes outside the bounds and accepts the edges (18 and 5 mm)', () => {
    const p = project();
    const ok = (params: unknown, q = p) => applyCommand(q, 'setTabs', params).ok;
    expect(ok({ width: 0.1, height: 0.01 })).toBe(false);
    expect(ok({ width: 2.9 })).toBe(false);
    expect(ok({ width: 3 })).toBe(true);
    expect(ok({ height: 0.9 })).toBe(false);
    expect(ok({ height: 1 })).toBe(true);
    expect(ok({ height: 17 })).toBe(true);
    expect(ok({ height: 17.1 })).toBe(false);
    const thin = project(5);
    expect(ok({ height: 4 }, thin)).toBe(true);
    expect(ok({ height: 4.5 }, thin)).toBe(false);
  });

  it('defaults (18 mm): no new issue', () => {
    const r = codes(project());
    expect(r.errors).toEqual([]);
    expect(r.warnings).not.toContain('TABS_TOO_SMALL');
  });

  it('an old / hand-edited project with 0.1 × 0.01 mm tabs: the small parts are refused', () => {
    const r = codes(project(18, { tabs: { auto: false, width: 0.1, height: 0.01 } }));
    expect(r.errors.filter((c) => c === 'SMALL_PART_TAB_TOO_SMALL')).toHaveLength(1);
    // tabs on every part: the big part gets a warning, the small ones the error
    const all = codes(project(18, { tabs: { auto: true, width: 2, height: 3 } }));
    expect(all.errors).toContain('SMALL_PART_TAB_TOO_SMALL');
    expect(all.warnings).toContain('TABS_TOO_SMALL');
  });

  it('a too-thick bridge (height 17.9 on 18 mm) is refused on small parts', () => {
    const r = codes(project(18, { tabs: { auto: false, height: 17.9 } }));
    expect(r.errors).toContain('SMALL_PART_TAB_TOO_SMALL');
  });

  it('small values from the material set are caught too', () => {
    expect(codes(project(), 18, { width: 1, height: 3 }).errors).toContain(
      'SMALL_PART_TAB_TOO_SMALL',
    );
  });

  it('small parts on a thin skin (Köprü: Kapalı) do not use tabs: no error', () => {
    const r = codes(project(18, { tabs: { auto: false, width: 0.1 }, skin: { thickness: 0.5 } }));
    expect(r.errors).not.toContain('SMALL_PART_TAB_TOO_SMALL');
  });

  it('the NC export of a 0.1 × 0.01 mm tab project is refused (no file)', () => {
    const p = project(18, { tabs: { auto: false, width: 0.1, height: 0.01 } });
    const r = exportNc(
      p,
      { profile: goldenProfile('generic'), version: 1, verification: 'draft' },
      postConfig('generic'),
    );
    expect(r.ok).toBe(false);
    expect(r.files ?? []).toEqual([]);
  });
});
