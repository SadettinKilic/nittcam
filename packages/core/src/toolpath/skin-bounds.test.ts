import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { SKIN_BOUNDS, maxSkinThickness, skinThicknessOk } from './tabs';
import { clone, machineOf, projectOf } from './toolpath.testing';

// T298 (CTO #12 A, D-083): a thin skin below 0.2 mm or above thickness − 1 mm does not hold a
// small part. The command refuses it, and the toolpath refuses a small part held only by it,
// whatever the value came from (old or hand-edited project).

const codes = (p: Project, thickness = 18) => {
  const r = buildToolpath(p, machineOf({ thickness }));
  return { errors: r.errors.map((i) => i.code), warnings: r.warnings.map((i) => i.code) };
};

/** A 600 × 400 part and two 80 × 80 small parts on `thickness` mm stock, skin as given. */
function project(thickness = 18, skin?: number): Project {
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
  base.cutting = {
    tabs: { auto: false },
    leadIn: 'arc',
    direction: 'climb',
    ...(skin === undefined ? {} : { skin: { thickness: skin } }),
  };
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

describe('thin skin bounds (T298)', () => {
  it('skinThicknessOk: 0.2 … t − 1', () => {
    expect(SKIN_BOUNDS).toEqual({ min: 0.2, belowThickness: 1 });
    expect(maxSkinThickness(18)).toBe(17);
    expect(skinThicknessOk(0.2, 18)).toBe(true);
    expect(skinThicknessOk(0.5, 18)).toBe(true);
    expect(skinThicknessOk(17, 18)).toBe(true);
    expect(skinThicknessOk(0.19, 18)).toBe(false);
    expect(skinThicknessOk(0.001, 18)).toBe(false);
    expect(skinThicknessOk(17.01, 18)).toBe(false);
    expect(skinThicknessOk(4.5, 5)).toBe(false);
  });

  it('setThinSkin refuses values outside the bounds, accepts the edges', () => {
    const p = project(18);
    for (const v of [0.001, 0.01, 0.05, 0.19, 17.01, 17.99]) {
      expect(applyCommand(p, 'setThinSkin', { thickness: v }).ok, String(v)).toBe(false);
    }
    for (const v of [0.2, 0.5, 17]) {
      expect(applyCommand(p, 'setThinSkin', { thickness: v }).ok, String(v)).toBe(true);
    }
    expect(applyCommand(project(5), 'setThinSkin', { thickness: 4.5 }).ok).toBe(false);
    expect(applyCommand(project(5), 'setThinSkin', { thickness: 4 }).ok).toBe(true);
  });

  it('a small part on a 0.001 mm skin (old / hand-edited project) is an error, once per part', () => {
    const r = codes(project(18, 0.001));
    expect(r.errors.filter((c) => c === 'SMALL_PART_SKIN_OUT_OF_BOUNDS')).toHaveLength(1);
    expect(r.warnings).not.toContain('SMALL_PART_SKIN');
  });

  it('a 17.99 mm skin on 18 mm and 4.5 mm on 5 mm are errors; 0.5 mm is not', () => {
    expect(codes(project(18, 17.99)).errors).toContain('SMALL_PART_SKIN_OUT_OF_BOUNDS');
    expect(codes(project(5, 4.5), 5).errors).toContain('SMALL_PART_SKIN_OUT_OF_BOUNDS');
    const ok = codes(project(18, 0.5));
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toContain('SMALL_PART_SKIN');
  });

  it('the NC export of a 0.001 mm skin project is refused (no file)', () => {
    const r = exportNc(
      project(18, 0.001),
      { profile: goldenProfile('generic'), version: 1, verification: 'draft' },
      postConfig('generic'),
    );
    expect(r.ok).toBe(false);
    expect(r.files ?? []).toEqual([]);
  });
});
