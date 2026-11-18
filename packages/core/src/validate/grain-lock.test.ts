/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known fixtures */
/** A locked copy whose grain no longer allows its rotation (D-034 amendment, B5 fix round 1). */
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { applyCommand } from '../commands';
import { rotationAllowed } from '../geometry/grain';
import { parseProject, type Project } from '../schema';
import { validateProject } from './index';

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

/** shelf-set nested, one fixed-grain copy locked at its current (allowed) rotation. */
function lockedFixed(): { project: Project; partId: string; index: number } {
  const parsed = parseProject(JSON.parse(JSON.stringify(shelfSet)));
  if (!parsed.ok) throw new Error('fixture');
  let p = run(parsed.project, 'runNesting', { toolDiameter: 8 });
  const pl = p.layout.sheets[0]!.placements.find(
    (x) => p.parts.find((pt) => pt.id === x.partId)!.grain.mode === 'fixed',
  )!;
  p = run(p, 'lockPlacement', { partId: pl.partId, index: pl.index });
  return { project: p, partId: pl.partId, index: pl.index };
}

const grainIssues = (p: Project) =>
  validateProject(p, {}).filter((i) => i.code === 'LOCKED_PLACEMENT_GRAIN');

describe('rotationAllowed', () => {
  const fixed = { grain: { mode: 'fixed' as const, angle: 30 } };
  it('compares at the stored 3-decimal precision, mod 360', () => {
    expect(rotationAllowed(fixed, { grain: 0 }, 330)).toBe(true);
    expect(rotationAllowed(fixed, { grain: 0 }, 150.0004)).toBe(true);
    expect(rotationAllowed(fixed, { grain: 0 }, -30)).toBe(true);
    expect(rotationAllowed(fixed, { grain: 0 }, 150.01)).toBe(false);
    expect(rotationAllowed(fixed, { grain: null }, 90)).toBe(true);
  });
});

describe('LOCKED_PLACEMENT_GRAIN', () => {
  it('a lock at an allowed rotation is fine', () => {
    expect(grainIssues(lockedFixed().project)).toEqual([]);
  });

  it('after the sheet grain changes the lock is an error; nothing moves it', () => {
    const { project, partId, index } = lockedFixed();
    const p = run(project, 'setGrain', { grain: 0 });
    const issues = grainIssues(p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.path).toMatch(/^layout\.sheets\[\d+\]\.placements\[\d+\]$/);
    const renested = run(p, 'runNesting', { toolDiameter: 8 });
    const kept = renested.layout.sheets
      .flatMap((s) => s.placements)
      .find((x) => x.partId === partId && x.index === index)!;
    expect(kept.locked).toBe(true);
    expect(kept.rot).toBe(0);
    expect(grainIssues(renested)).toHaveLength(1);
  });

  it('unlocking and re-nesting clears it', () => {
    const { project, partId, index } = lockedFixed();
    let p = run(project, 'setGrain', { grain: 0 });
    p = run(p, 'lockPlacement', { partId, index, locked: false });
    p = run(p, 'runNesting', { toolDiameter: 8 });
    expect(grainIssues(p)).toEqual([]);
  });
});

describe('PLACEMENT_GRAIN (B5 fix round 2)', () => {
  const codes = (p: Project) =>
    validateProject(p, {})
      .filter((i) => i.code === 'PLACEMENT_GRAIN' || i.code === 'LOCKED_PLACEMENT_GRAIN')
      .map((i) => ({ code: i.code, path: i.path }));

  it('an unlocked copy left at a stale rotation is an error until re-nested', () => {
    const { project, partId, index } = lockedFixed();
    let p = run(project, 'lockPlacement', { partId, index, locked: false });
    expect(codes(p)).toEqual([]);
    p = run(p, 'setGrain', { grain: 0 });
    const issues = validateProject(p, {}).filter((i) => i.code === 'PLACEMENT_GRAIN');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    for (const i of issues) {
      const [, s, k] = /^layout\.sheets\[(\d+)\]\.placements\[(\d+)\]$/.exec(i.path)!;
      const pl = p.layout.sheets[Number(s)]!.placements[Number(k)]!;
      const part = p.parts.find((x) => x.id === pl.partId)!;
      expect(pl.locked).toBeFalsy();
      expect(rotationAllowed(part, p.stock.sheet, pl.rot)).toBe(false);
    }
    expect(codes(run(p, 'runNesting', { toolDiameter: 8 }))).toEqual([]);
  });

  it('a locked copy gets only LOCKED_PLACEMENT_GRAIN, never both codes', () => {
    const { project } = lockedFixed();
    const p = run(project, 'setGrain', { grain: 0 });
    const locked = new Set(
      p.layout.sheets.flatMap((s, si) =>
        s.placements.flatMap((pl, k) =>
          pl.locked ? [`layout.sheets[${si}].placements[${k}]`] : [],
        ),
      ),
    );
    const all = codes(p);
    expect(new Set(all.map((i) => i.path)).size).toBe(all.length);
    for (const i of all) {
      expect(i.code).toBe(locked.has(i.path) ? 'LOCKED_PLACEMENT_GRAIN' : 'PLACEMENT_GRAIN');
    }
    expect(all.some((i) => i.code === 'LOCKED_PLACEMENT_GRAIN')).toBe(true);
  });
});
