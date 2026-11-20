import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { clone, machineOf, projectOf } from './toolpath.testing';

// B33 tester (T288): gcode-safety checklist over every combination of the Kesim ayarları options
// (tab mode × lead-in × direction, plus tab overrides) on both posts, read back by the independent
// reader through exportNc. Small parts are always held (≥ 2 tabs, or a thin skin + cleanup pass).

const T = 18;
const machine = machineOf({ thickness: T, spoilboard: 0.3 });

function project(parts = [{ id: 's', w: 80, h: 80, qty: 2 }]): Project {
  const base = clone(
    projectOf({
      parts: [{ id: 'big', w: 600, h: 400, qty: 1 }, ...parts],
      placements: [
        [
          { partId: 'big', index: 0, x: 20, y: 20, rot: 0 },
          ...parts.flatMap((p, k) =>
            Array.from({ length: p.qty }, (_, i) => ({
              partId: p.id,
              index: i,
              x: 700 + 150 * (i + 2 * k),
              y: 20,
              rot: 0 as const,
            })),
          ),
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
  return r.project;
}

function assertSmallHeld(p: Project) {
  const tp = buildToolpath(p, machine);
  expect(tp.errors).toEqual([]);
  const small = tp.toolpath.operations.filter((o) => o.partId === 's' && !o.skinCleanup);
  expect(small.length).toBe(2);
  for (const o of small) {
    if (p.cutting.skin) {
      expect(o.tabs).toEqual([]);
      expect(o.passDepths.at(-1)).toBeCloseTo(-(T - p.cutting.skin.thickness), 9);
    } else {
      expect(o.tabs.length).toBeGreaterThanOrEqual(2);
    }
  }
  if (p.cutting.skin) {
    expect(tp.toolpath.operations.filter((o) => o.skinCleanup && o.partId === 's')).toHaveLength(2);
  }
}

function assertReaderClean(p: Project) {
  for (const post of ['generic', 'mach3'] as const) {
    const r = exportNc(
      p,
      { profile: goldenProfile(post), version: 1, verification: 'draft' },
      postConfig(post),
    );
    expect(r.check?.violations ?? [], post).toEqual([]);
    expect(r.ok, post).toBe(true);
  }
}

const modes = ['all', 'small', 'off'] as const;
const leads = ['arc', 'line'] as const;
const dirs = ['climb', 'conventional'] as const;
const matrix = modes.flatMap((m) => leads.flatMap((l) => dirs.map((d) => [m, l, d] as const)));

describe('B33 tester: every Kesim ayarları combination (T288, §6.3, §7.2)', () => {
  it.each(matrix)(
    'tabs %s, lead-in %s, %s: small parts held, reader clean on both posts',
    (m, l, d) => {
      const p = run(
        run(run(project(), 'setTabs', { mode: m }), 'setLeadIn', { leadIn: l }),
        'setCutDirection',
        { direction: d },
      );
      assertSmallHeld(p);
      assertReaderClean(p);
    },
  );

  it.each(['all', 'small'] as const)('%s with count = 1 still gives small parts ≥ 2 tabs', (m) => {
    const p = run(project(), 'setTabs', { mode: m, count: 1 });
    assertSmallHeld(p);
    assertReaderClean(p);
  });

  it('tab height ≥ thickness is refused; a later thinner stock makes the build fail, not cut free', () => {
    const p = project();
    expect(applyCommand(p, 'setTabs', { height: T }).ok).toBe(false);
    expect(applyCommand(p, 'setTabs', { height: T + 1 }).ok).toBe(false);
    const h = run(p, 'setTabs', { mode: 'all', height: 10 });
    const thin = run(h, 'setThickness', { thickness: 8 });
    const tp = buildToolpath(thin, machineOf({ thickness: 8, spoilboard: 0.3 }));
    expect(tp.errors.length).toBeGreaterThan(0);
  });

  it('a tiny part with no room for 2 tabs: blocked in tab modes, held by the skin in "off"', () => {
    const tiny = [{ id: 's', w: 22, h: 22, qty: 2 }];
    for (const m of ['all', 'small'] as const) {
      const tp = buildToolpath(run(project(tiny), 'setTabs', { mode: m }), machine);
      const ops = tp.toolpath.operations.filter((o) => o.partId === 's' && !o.skinCleanup);
      // Either an error (never cut free) or each tiny part still has ≥ 2 tabs.
      if (tp.errors.length === 0)
        for (const o of ops) expect(o.tabs.length).toBeGreaterThanOrEqual(2);
    }
    const off = run(project(tiny), 'setTabs', { mode: 'off' });
    assertSmallHeld(off);
    assertReaderClean(off);
  });
});
