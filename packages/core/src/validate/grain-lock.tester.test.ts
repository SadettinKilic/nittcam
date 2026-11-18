/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known fixtures */
/** Tester round 2 (B5): LOCKED_PLACEMENT_GRAIN clearing paths and the 3-decimal tolerance. */
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { applyCommand } from '../commands';
import { allowedRotations, rotationAllowed } from '../geometry/grain';
import { parseProject, type Project } from '../schema';
import { validateProject } from './index';

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

const grainIssues = (p: Project) =>
  validateProject(p, {}).filter((i) => i.code === 'LOCKED_PLACEMENT_GRAIN');

/** shelf-set nested, a fixed-grain copy locked, then the sheet grain turned so its rotation is bad. */
function badLock() {
  const parsed = parseProject(JSON.parse(JSON.stringify(shelfSet)));
  if (!parsed.ok) throw new Error('fixture');
  let p = run(parsed.project, 'runNesting', { toolDiameter: 8 });
  const pl = p.layout.sheets[0]!.placements.find(
    (x) => p.parts.find((pt) => pt.id === x.partId)!.grain.mode === 'fixed',
  )!;
  p = run(p, 'lockPlacement', { partId: pl.partId, index: pl.index });
  const before = p.stock.sheet.grain;
  p = run(p, 'setGrain', { grain: before === 90 ? 0 : 90 });
  const part = p.parts.find((x) => x.id === pl.partId)!;
  expect(rotationAllowed(part, p.stock.sheet, pl.rot)).toBe(false);
  return { p, partId: pl.partId, index: pl.index, part };
}

const copyOf = (p: Project, partId: string, index: number) =>
  p.layout.sheets
    .flatMap((s) => s.placements)
    .find((x) => x.partId === partId && x.index === index)!;

describe('LOCKED_PLACEMENT_GRAIN (tester round 2)', () => {
  it('repro: the bad lock is one error, path points at the copy, message names the allowed angles', () => {
    const { p } = badLock();
    const issues = grainIssues(p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.message).toMatch(/allowed:/);
  });

  it('rotating the locked copy to an allowed angle clears it and keeps it locked', () => {
    const { p, partId, index, part } = badLock();
    const allowed = allowedRotations(part, p.stock.sheet);
    for (const rot of allowed) {
      const q = run(p, 'lockPlacement', { partId, index, rot });
      expect(copyOf(q, partId, index).locked).toBe(true);
      expect(copyOf(q, partId, index).rot).toBe(rot);
      expect(grainIssues(q)).toEqual([]);
    }
  });

  it('lockPlacement refuses a disallowed rotation, so a new bad lock cannot be made by hand', () => {
    const { p, partId, index } = badLock();
    const r = applyCommand(p, 'lockPlacement', {
      partId,
      index,
      rot: copyOf(p, partId, index).rot,
    });
    expect(r.ok).toBe(false);
  });

  it('unlocking clears the lock error (no re-nest needed for the error itself)', () => {
    const { p, partId, index } = badLock();
    const q = run(p, 'lockPlacement', { partId, index, locked: false });
    expect(grainIssues(q)).toEqual([]);
  });

  it('undo of setGrain clears it again (validation is a pure function of the project)', () => {
    const { p } = badLock();
    const back = run(p, 'setGrain', { grain: p.stock.sheet.grain === 90 ? 0 : 90 });
    expect(grainIssues(back)).toEqual([]);
  });

  it('a sheet without grain (null) never reports it', () => {
    const { p } = badLock();
    expect(grainIssues(run(p, 'setGrain', { grain: null }))).toEqual([]);
  });

  it('an unlocked copy is never reported by this rule', () => {
    const { p, partId, index } = badLock();
    const q = run(p, 'lockPlacement', { partId, index, locked: false });
    expect(copyOf(q, partId, index).locked).toBe(false);
    expect(grainIssues(q)).toEqual([]);
  });
});

describe('rotationAllowed 3-decimal boundary (tester round 2)', () => {
  // fixed grain 0 on a grain-90 sheet → allowed 90 and 270.
  const part = { grain: { mode: 'fixed' as const, angle: 0 } };
  const sheet = { grain: 90 };
  it('allowed set is 90/270', () => {
    expect(allowedRotations(part, sheet)).toEqual([90, 270]);
  });
  it.each([
    [90, true],
    [89.9995, true], // rounds up to 90.000
    [90.0004, true],
    [90.00049, true],
    [89.9994, false], // rounds to 89.999
    [90.0006, false], // rounds to 90.001 (exact .0005 halves are float-dependent, not asserted)
    [89.999, false],
    [90.001, false],
    [-270, true],
    [450, true],
    [269.9995, true],
    [0, false],
    [180, false],
  ])('rot %s → %s', (rot, ok) => {
    expect(rotationAllowed(part, sheet, rot)).toBe(ok);
  });
  it('validation and lockPlacement agree on the boundary (same function)', () => {
    const fixed30 = { grain: { mode: 'fixed' as const, angle: 30 } };
    const a = allowedRotations(fixed30, { grain: 0 });
    for (const r of a) {
      expect(rotationAllowed(fixed30, { grain: 0 }, r + 0.0004)).toBe(true);
      expect(rotationAllowed(fixed30, { grain: 0 }, r + 0.0006)).toBe(false);
    }
  });
});

describe('KNOWN GAP (tester round 2): an unlocked copy left at a stale rotation after a grain change', () => {
  /**
   * Nesting is manual in the web app (Diz button). After setGrain / setPartGrain without re-nesting,
   * unlocked copies keep their old rotation. No validation rule reports them, so the NC export
   * (which only gates LOCKED_PLACEMENT_GRAIN) would cut them against the grain.
   * `it.fails` = expected behaviour not met yet; flip to `it` when fixed.
   */
  it.fails('validation reports an unlocked copy at a rotation its grain does not allow', () => {
    const { p, partId, index } = badLock();
    const q = run(p, 'lockPlacement', { partId, index, locked: false });
    const part = q.parts.find((x) => x.id === partId)!;
    expect(rotationAllowed(part, q.stock.sheet, copyOf(q, partId, index).rot)).toBe(false);
    const errors = validateProject(q, {}).filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });
});
