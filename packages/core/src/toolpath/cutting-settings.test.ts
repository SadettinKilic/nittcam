import { applyPatches, enablePatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import { goldenProfile } from '../post/golden.testing';
import { cuttingHeader } from '../post/generate';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { cuttingSettingsOf, tabModeOf } from './cutting-settings';
import { TAB_DEFAULTS } from './tabs';
import { clone, machineOf, projectOf } from './toolpath.testing';

// T288 (CTO #10 E1, K3): tabs, lead-in and direction are commands; the toolpath, the export and
// the "KESİM" header line read the same values; the small-part safety rule (§6.3, §7.2) holds in
// every tab mode.

enablePatches();

const T = 18;
const machine = machineOf({ thickness: T, spoilboard: 0.3 });

/** One 600 × 400 part and two 80 × 80 small parts on one sheet, default cutting settings. */
function project(): Project {
  const base = clone(
    projectOf({
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
  base.cutting = { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' };
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

function run(p: Project, name: string, params: unknown): Project {
  const r = applyCommand(p, name, params);
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r)}`);
  expect(JSON.stringify(applyPatches(r.project, r.inversePatches))).toBe(JSON.stringify(p));
  return r.project;
}

describe('setTabs / setLeadIn / setCutDirection (T288)', () => {
  it('the three tab modes map onto tabs.auto and the thin skin; undo restores byte for byte', () => {
    const p = project();
    expect(tabModeOf(p)).toBe('small');
    const all = run(p, 'setTabs', { mode: 'all' });
    expect(all.cutting.tabs.auto).toBe(true);
    expect(tabModeOf(all)).toBe('all');
    const off = run(p, 'setTabs', { mode: 'off' });
    expect(off.cutting.tabs.auto).toBe(false);
    expect(off.cutting.skin).toEqual({ thickness: 0.5 });
    expect(tabModeOf(off)).toBe('off');
    const back = run(off, 'setTabs', { mode: 'small' });
    expect(JSON.stringify(back)).toBe(JSON.stringify(p));
  });

  it('overrides count / width / height; null goes back to the material set; height < thickness', () => {
    const p = run(project(), 'setTabs', { count: 6, width: 12, height: 2.5 });
    expect(p.cutting.tabs).toMatchObject({ count: 6, width: 12, height: 2.5 });
    expect(cuttingSettingsOf(p, machine).tabs.source).toEqual({
      count: 'project',
      width: 'project',
      height: 'project',
    });
    const reset = run(p, 'setTabs', { count: null, width: null, height: null });
    expect(JSON.stringify(reset)).toBe(JSON.stringify(project()));
    expect(applyCommand(p, 'setTabs', { height: T }).ok).toBe(false);
    expect(applyCommand(p, 'setTabs', { count: 0 }).ok).toBe(false);
    expect(applyCommand(p, 'setTabs', { width: -1 }).ok).toBe(false);
    expect(applyCommand(p, 'setTabs', { mode: 'some' }).ok).toBe(false);
  });

  it('lead-in and direction', () => {
    const p = run(run(project(), 'setLeadIn', { leadIn: 'line' }), 'setCutDirection', {
      direction: 'conventional',
    });
    expect(p.cutting).toMatchObject({ leadIn: 'line', direction: 'conventional' });
    expect(applyCommand(p, 'setLeadIn', { leadIn: 'none' }).ok).toBe(false);
    expect(applyCommand(p, 'setCutDirection', { direction: 'ccw' }).ok).toBe(false);
  });
});

describe('cuttingSettingsOf (T288)', () => {
  it('resolves like the toolpath: project > material set > built-in default', () => {
    const c = cuttingSettingsOf(project());
    expect(c.tabs).toMatchObject({
      count: TAB_DEFAULTS.count,
      width: TAB_DEFAULTS.width,
      height: TAB_DEFAULTS.materialLeft,
    });
    expect(c.tabs.source.count).toBe('default');
    const own = run(project(), 'setTabs', { mode: 'all', count: 3 });
    const tp = buildToolpath(own, machine);
    expect(tp.errors).toEqual([]);
    const big = tp.toolpath.operations.find((o) => o.partId === 'big');
    expect(big?.tabs).toHaveLength(cuttingSettingsOf(own, machine).tabs.count);
  });
});

describe('gcode-safety per option (T288, §6.3, §7.2)', () => {
  const variants: [string, (p: Project) => Project][] = [
    ['small (default)', (p) => p],
    ['all', (p) => run(p, 'setTabs', { mode: 'all' })],
    ['off', (p) => run(p, 'setTabs', { mode: 'off' })],
    ['line lead-in', (p) => run(p, 'setLeadIn', { leadIn: 'line' })],
    ['conventional', (p) => run(p, 'setCutDirection', { direction: 'conventional' })],
    ['own tab size', (p) => run(p, 'setTabs', { mode: 'all', count: 2, width: 8, height: 2 })],
  ];

  it.each(variants)('%s: small parts stay held, the reader passes on both posts', (_n, make) => {
    const p = make(project());
    const tp = buildToolpath(p, machine);
    expect(tp.errors).toEqual([]);
    const small = tp.toolpath.operations.filter((o) => o.partId === 's' && !o.skinCleanup);
    expect(small).toHaveLength(2);
    for (const o of small) {
      // Safety rule: ≥ 2 tabs, or a skin (no tabs, last pass above the sheet bottom + cleanup).
      if (p.cutting.skin) {
        expect(o.tabs).toEqual([]);
        expect(o.passDepths.at(-1)).toBeCloseTo(-(T - p.cutting.skin.thickness), 9);
      } else {
        expect(o.tabs.length).toBeGreaterThanOrEqual(2);
      }
    }
    if (p.cutting.skin) {
      expect(tp.toolpath.operations.filter((o) => o.skinCleanup)).toHaveLength(2);
    }
    for (const post of ['generic', 'mach3'] as const) {
      const r = exportNc(
        p,
        { profile: goldenProfile(post), version: 1, verification: 'draft' },
        postConfig(post),
      );
      expect(r.check?.violations ?? []).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('"off" never leaves a large part with tabs, "all" puts tabs on it', () => {
    const big = (p: Project) =>
      buildToolpath(p, machine).toolpath.operations.find((o) => o.partId === 'big');
    expect(big(run(project(), 'setTabs', { mode: 'off' }))?.tabs).toEqual([]);
    expect(big(run(project(), 'setTabs', { mode: 'all' }))?.tabs.length).toBeGreaterThan(0);
  });
});

describe('KESİM header line (T288, K3)', () => {
  const exportFirst = (p: Project) => {
    const r = exportNc(
      p,
      { profile: goldenProfile('generic'), version: 1, verification: 'draft' },
      postConfig('generic'),
    );
    expect(r.ok).toBe(true);
    return r.files[0]?.content ?? '';
  };

  it('present in every file, a new project with default settings too (D-091)', () => {
    // D-091 (B51): the operator sees tabs, lead-in and direction in any program.
    expect(exportFirst(run(project(), 'setTabs', { mode: 'all' }))).toMatch(
      /KES[İI]M: k[öo]pr[üu] her par[çc]ada 4 adet 10.000 x 3.000 mm, giri[şs] yay, y[öo]n climb/,
    );
    expect(exportFirst(project())).toMatch(/KES[İI]M: k[öo]pr[üu] yaln[ıi]z/);
    const text = exportFirst(
      run(run(project(), 'setTabs', { mode: 'all', count: 3 }), 'setLeadIn', { leadIn: 'line' }),
    );
    expect(text).toMatch(/KES[İI]M: k[öo]pr[üu] her par[çc]ada 3 adet/);
    expect(text).toMatch(/giri[şs] d[üu]z, y[öo]n climb/);
  });

  it('wording per mode, never a parenthesis inside the comment', () => {
    const base = {
      tabCount: 4,
      tabWidth: 10,
      tabHeight: 3,
      skin: null,
      leadIn: 'arc',
      direction: 'climb',
    } as const;
    expect(cuttingHeader({ ...base, tabMode: 'small' })).toBe(
      'KESİM: köprü yalnız küçük parçada 4 adet 10.000 x 3.000 mm, giriş yay, yön climb',
    );
    expect(cuttingHeader({ ...base, tabMode: 'off', skin: 0.5, direction: 'conventional' })).toBe(
      'KESİM: köprü kapalı, küçük parça ince tabaka 0.500 mm, giriş yay, yön conventional',
    );
    expect(cuttingHeader({ ...base, tabMode: 'all', skin: 0.4 })).not.toMatch(/[()]/);
  });
});
