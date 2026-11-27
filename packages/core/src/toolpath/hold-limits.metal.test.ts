import { describe, expect, it, vi } from 'vitest';
import { applyCommand } from '../commands';
import { expectedLayout } from '../gcode-check/layout';
import { materialTabIssues } from '../machine/profile';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { cuttingSettingsOf } from './cutting-settings';
import { holdLimitsOf, maxTabHeight, tabSizeProblem } from './tabs';
import { clone, machineOf, projectOf } from './toolpath.testing';

// T343: a traits row with other bounds changes the limits end to end (profile save, command
// validation, toolpath, cutting settings, G-code check). Test-only row: `pvc` is replaced by a
// thin-metal-like row (tab ≥ 2 mm wide, height 0.5 … t − 0.5, skin ≥ 0.1 mm, small part below
// 20 000 mm² or 60 mm, at least 3 tabs, built-in 3 × 8 × ≤ 1 mm).
vi.mock('../machine/material-traits', async (importOriginal) => {
  const real = await importOriginal<typeof import('../machine/material-traits')>();
  const metal = {
    ...real.MATERIAL_TRAITS.pvc,
    tabs: {
      defaults: { count: 3, width: 8, materialLeft: 1, smallPartMinCount: 3 },
      bounds: { minWidth: 2, minAnchor: 3, minHeight: 0.5, belowThickness: 0.5 },
    },
    skin: { min: 0.1, belowThickness: 0.5 },
    smallPart: { area: 20_000, minSide: 60 },
  };
  return {
    ...real,
    MATERIAL_TRAITS: { ...real.MATERIAL_TRAITS, pvc: metal },
    traitsOf: (kind: Parameters<typeof real.traitsOf>[0]) =>
      kind === 'pvc' ? metal : real.traitsOf(kind),
  };
});

function project(material: string, thickness: number, small = { w: 80, h: 80 }): Project {
  const base = clone(
    projectOf({
      thickness,
      parts: [
        { id: 'big', w: 600, h: 400, qty: 1 },
        { id: 's', ...small, qty: 1 },
      ],
      placements: [
        [
          { partId: 'big', index: 0, x: 20, y: 20, rot: 0 },
          { partId: 's', index: 0, x: 700, y: 20, rot: 0 },
        ],
      ],
    }),
  ) as unknown as { cutting: Record<string, unknown>; stock: { material: string } };
  base.stock.material = material;
  base.cutting = { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' };
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

function machine(material: 'pvc' | 'mdf', thickness: number, tabs?: object) {
  const m = machineOf({ thickness });
  const set = m.materials[0];
  if (set) m.materials[0] = { ...set, material, ...(tabs ? { tabs } : {}) } as never;
  return m;
}

const codes = (p: Project, m: ReturnType<typeof machine>) =>
  buildToolpath(p, m).errors.map((i) => i.code);

describe('a traits row with other bounds (T343, test-only metal row)', () => {
  it('limits: 1,5 mm stock allows a 0,5 mm tab; MDF keeps 1 … t − 1', () => {
    const l = holdLimitsOf('pvc');
    expect(maxTabHeight(1.5, l)).toBe(1);
    expect(tabSizeProblem(2, 0.5, 1.5, l)).toBeNull();
    expect(tabSizeProblem(3, 0.5, 18, holdLimitsOf('mdf'))).toBe('height');
  });

  it('profile save: the set bounds follow the kind', () => {
    const tabs = { count: 4, width: 2, height: 0.5 };
    expect(materialTabIssues({ materials: machine('pvc', 1.5, tabs).materials })).toEqual([]);
    const mdf = materialTabIssues({ materials: machine('mdf', 18, tabs).materials });
    expect(mdf.map((i) => i.path)).toEqual(['materials[0].tabs.width', 'materials[0].tabs.height']);
    const high = materialTabIssues({
      materials: machine('pvc', 1.5, { ...tabs, height: 1.2 }).materials,
    });
    expect(high).toMatchObject([{ code: 'too_big', maximum: 1 }]);
  });

  it('commands: setTabs / setThinSkin use the stock bounds', () => {
    const pvc = project('pvc', 1.5);
    expect(applyCommand(pvc, 'setTabs', { width: 2, height: 0.5 }).ok).toBe(true);
    expect(applyCommand(pvc, 'setTabs', { height: 1.2 }).ok).toBe(false);
    expect(applyCommand(pvc, 'setThinSkin', { thickness: 0.1 }).ok).toBe(true);
    const mdf = project('mdf', 18);
    expect(applyCommand(mdf, 'setTabs', { width: 2 }).ok).toBe(false);
    expect(applyCommand(mdf, 'setTabs', { height: 0.5 }).ok).toBe(false);
    expect(applyCommand(mdf, 'setThinSkin', { thickness: 0.1 }).ok).toBe(false);
    expect(applyCommand(mdf, 'setThinSkin', { thickness: 0.2 }).ok).toBe(true);
  });

  it('toolpath: a 0,5 mm tab holds on 1,5 mm metal-like stock, MDF 18 refuses it', () => {
    const tabs = { count: 4, width: 2, height: 0.5 };
    expect(codes(project('pvc', 1.5), machine('pvc', 1.5, tabs))).not.toContain(
      'SMALL_PART_TAB_TOO_SMALL',
    );
    expect(codes(project('mdf', 18), machine('mdf', 18, tabs))).toContain(
      'SMALL_PART_TAB_TOO_SMALL',
    );
  });

  it('cutting settings: built-in defaults and the small-part minimum follow the row', () => {
    const c = cuttingSettingsOf(project('pvc', 1.5));
    expect(c.tabs).toMatchObject({ count: 3, smallCount: 3, width: 8, height: 0.75 });
    expect(cuttingSettingsOf(project('mdf', 18)).tabs).toMatchObject({
      count: 4,
      smallCount: 4,
      width: 10,
      height: 3,
    });
  });

  it('G-code check: the small-part threshold follows the row', () => {
    // a 200 × 120 part: small for wood (24 000 mm² < 50 000), not for the row (≥ 20 000, sides ≥ 60)
    const p = (material: string) => project(material, 1.5, { w: 200, h: 120 });
    const smallOf = (q: Project) =>
      Object.fromEntries(expectedLayout(q, 0).map((e) => [e.partId, e.small]));
    expect(smallOf(p('mdf'))).toEqual({ big: false, s: true });
    expect(smallOf(p('pvc'))).toEqual({ big: false, s: false });
  });
});
