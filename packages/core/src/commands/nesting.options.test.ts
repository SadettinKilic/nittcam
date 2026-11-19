/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion -- tests edit raw JSON and index known results */
/**
 * T163: rotation policy (`nesting.rotation`, D-055), the nesting progress hook and
 * `runNestingWithProgress` (the worker's path: same result as the command, one undo step).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { allowedRotations, rotationPolicyOf } from '../geometry/grain';
import { kitchenCabinets } from '../nesting/__bench__/datasets';
import { nest, nestProject } from '../nesting';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { applyCommand, CommandStack, runNestingWithProgress } from './index';

const ctx = { actor: 'user' as const, at: '2026-11-19T10:00:00Z' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function load(mutate: (j: Record<string, any>) => void = () => {}): Project {
  const copy = clone(shelfSet) as Record<string, any>;
  mutate(copy);
  const r = parseProject(copy);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

describe('nesting.rotation (D-055)', () => {
  it('is optional: projects without it parse and behave as "free"', () => {
    const p = load();
    expect(p.nesting.rotation).toBeUndefined();
    expect(rotationPolicyOf(p.nesting)).toEqual({});
    expect(rotationPolicyOf({ rotation: 'free' })).toEqual({});
    expect(rotationPolicyOf({ rotation: 'none' })).toEqual({ freeRotations: [0, 180] });
  });

  it('rejects unknown values', () => {
    const p = load();
    expect(applyCommand(p, 'setNestingOptions', { rotation: 'any' })).toMatchObject({
      ok: false,
    });
    expect(parseProject({ ...clone(p), nesting: { ...p.nesting, rotation: 'x' } }).ok).toBe(false);
  });

  it('setNestingOptions sets it in one undo step; "free" on an absent field records nothing', () => {
    const stack = new CommandStack(load());
    const same = stack.execute('setNestingOptions', { rotation: 'free' }, ctx);
    expect(same.ok && same.changed).toBe(false);
    const r = stack.execute('setNestingOptions', { rotation: 'none' }, ctx);
    expect(r.ok && r.changed).toBe(true);
    expect(stack.project.nesting.rotation).toBe('none');
    stack.undo();
    expect(stack.project.nesting.rotation).toBeUndefined();
  });

  it('"none" keeps free parts at 0°/180°; the grain rule still wins for fixed parts', () => {
    const p = load((j) => {
      j.nesting.rotation = 'none';
    });
    const policy = rotationPolicyOf(p.nesting);
    for (const part of p.parts) {
      const rots = allowedRotations(part, p.stock.sheet, policy);
      if (part.grain.mode === 'fixed' && p.stock.sheet.grain !== null) {
        expect(rots).toEqual(allowedRotations(part, p.stock.sheet));
      } else {
        expect(rots).toEqual([0, 180]);
      }
    }
    const layout = nestProject(p, { toolDiameter: 8 }).layout;
    for (const sh of layout.sheets) {
      for (const pl of sh.placements) {
        const part = p.parts.find((x) => x.id === pl.partId)!;
        expect(allowedRotations(part, p.stock.sheet, policy)).toContain(pl.rot);
      }
    }
  });

  it('a layout with a turned free part is flagged after switching to "none"; lockPlacement refuses 90°', () => {
    const free = load((j) => {
      j.stock.sheet.grain = null;
    });
    const nested = applyCommand(free, 'runNesting', { toolDiameter: 8 });
    if (!nested.ok) throw new Error('not nested');
    const turned = nested.project.layout.sheets
      .flatMap((s) => s.placements)
      .find((pl) => pl.rot === 90 || pl.rot === 270);
    const none = applyCommand(nested.project, 'setNestingOptions', { rotation: 'none' });
    if (!none.ok) throw new Error('not set');
    const flagged = validateProject(none.project).filter((i) => i.code === 'PLACEMENT_GRAIN');
    expect(flagged.length > 0).toBe(turned !== undefined);
    const any = none.project.layout.sheets[0]!.placements[0]!;
    expect(
      applyCommand(none.project, 'lockPlacement', {
        partId: any.partId,
        index: any.index,
        rot: 90,
      }),
    ).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
  });
});

describe('progress hook (T163)', () => {
  it('reports every candidate once, in order, ending at the total; the result is unchanged', () => {
    const calls: [number, number][] = [];
    const r = nest(kitchenCabinets, { onProgress: (d, t) => calls.push([d, t]) });
    expect(calls.length).toBe(r.candidates);
    calls.forEach(([d, t], i) => {
      expect(d).toBe(i + 1);
      expect(t).toBe(r.candidates);
    });
    expect(JSON.stringify(r)).toBe(JSON.stringify(nest(kitchenCabinets)));
  });
});

describe('runNestingWithProgress (worker path)', () => {
  it('gives the same project and patches as the runNesting command', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('minWaste' as const, 'fastest' as const, 'minToolChanges' as const),
        fc.constantFrom('free' as const, 'none' as const),
        fc.constantFrom(3, 6, 8),
        (mode, rotation, toolDiameter) => {
          const p = load((j) => {
            j.nesting.mode = mode;
            j.nesting.rotation = rotation;
          });
          const a = applyCommand(clone(p), 'runNesting', { toolDiameter });
          const b = runNestingWithProgress(clone(p), { toolDiameter });
          expect(a.ok && b.ok).toBe(true);
          if (!a.ok || !b.ok) return;
          expect(b.project).toEqual(a.project);
          expect(b.patches).toEqual(a.patches);
          expect(b.inversePatches).toEqual(a.inversePatches);
        },
      ),
      { numRuns: 12 },
    );
  });

  it('records as one undo step that restores the old layout byte for byte', () => {
    const start = load();
    const stack = new CommandStack(start);
    const before = JSON.stringify(stack.project);
    const r = runNestingWithProgress(stack.project, { toolDiameter: 6 });
    if (!r.ok) throw new Error(r.error);
    const rec = stack.executeApplied('runNesting', r, ctx, start);
    expect(rec.ok && rec.changed).toBe(true);
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(before);
  });

  it('rejects invalid params without running', () => {
    expect(runNestingWithProgress(load(), { toolDiameter: -1 })).toMatchObject({ ok: false });
  });
});
