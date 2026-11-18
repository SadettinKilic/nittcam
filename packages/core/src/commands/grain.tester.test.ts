/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known fixtures */
/**
 * Tester (B5, T112/T114): undo of the new grain commands, the grainLock alias mapping on every
 * sheet grain, lockPlacement's grain rule and the board turns (D-038) through the CommandStack.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { allowedRotations } from '../geometry/grain';
import { nestProject } from '../nesting';
import { parseProject, type Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const ctx: CommandContext = { actor: 'user', at: '2026-11-18T10:00:00Z' };

function load(json: unknown = cabinetDoors): Project {
  const r = parseProject(JSON.parse(JSON.stringify(json)));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

const grain3 = fc.integer({ min: 0, max: 179_999 }).map((n) => n / 1000);

describe('setGrain (sheet) undo/redo (tester)', () => {
  it('any angle or null: apply → undo is byte-identical, redo re-applies', () => {
    fc.assert(
      fc.property(
        fc.option(grain3, { nil: null }),
        fc.constantFrom(cabinetDoors, mixed, shelfSet),
        (g, json) => {
          const start = load(json);
          const stack = new CommandStack(start);
          const r = stack.execute('setGrain', { grain: g }, ctx);
          expect(r.ok).toBe(true);
          expect(stack.project.stock.sheet.grain).toBe(g);
          stack.undo();
          expect(JSON.stringify(stack.project)).toBe(JSON.stringify(start));
          stack.redo();
          expect(stack.project.stock.sheet.grain).toBe(g);
          // The result still validates as v2.
          expect(parseProject(JSON.parse(JSON.stringify(stack.project))).ok).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('rejects 180, −1 and strings', () => {
    const start = load();
    for (const grain of [180, -1, '30', undefined]) {
      expect(applyCommand(start, 'setGrain', { grain }).ok).toBe(false);
    }
  });
});

describe('grainLock alias maps to the CURRENT sheet grain (tester)', () => {
  it.each([0, 90, 33.5, null])('sheet %s: updatePart grainLock true/false', (sheetGrain) => {
    const p0 = run(load(), 'setGrain', { grain: sheetGrain });
    const id = p0.parts[0]!.id;
    const locked = run(p0, 'updatePart', { id, grainLock: true });
    expect(locked.parts[0]!.grain).toEqual({ mode: 'fixed', angle: sheetGrain ?? 0 });
    if (sheetGrain !== null) {
      // Fixed along the sheet grain = the v1 meaning: 0/180 are the allowed rotations.
      expect(allowedRotations(locked.parts[0]!, locked.stock.sheet)).toEqual([0, 180]);
    }
    const free = run(locked, 'updatePart', { id, grainLock: false });
    expect(free.parts[0]!.grain).toEqual({ mode: 'free', angle: 0 });
  });

  it('importCutList rows accept grainLock and grain', () => {
    const p0 = run(load(), 'setGrain', { grain: 90 });
    const p = run(p0, 'importCutList', {
      parts: [
        { id: 'n1', params: { w: 300, h: 200, r: 0 }, grainLock: true },
        { id: 'n2', params: { w: 300, h: 200, r: 0 }, grain: { mode: 'fixed', angle: 15 } },
        { id: 'n3', params: { w: 300, h: 200, r: 0 } },
      ],
    });
    const g = (id: string) => p.parts.find((x) => x.id === id)!.grain;
    expect(g('n1')).toEqual({ mode: 'fixed', angle: 90 });
    expect(g('n2')).toEqual({ mode: 'fixed', angle: 15 });
    expect(g('n3')).toEqual({ mode: 'free', angle: 0 });
  });

  it('setPartGrain is one undo step on the stack', () => {
    const start = load(mixed);
    const stack = new CommandStack(start);
    const id = start.parts[0]!.id;
    expect(stack.execute('setPartGrain', { id, mode: 'fixed', angle: 42.125 }, ctx).ok).toBe(true);
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(start));
  });
});

describe('lockPlacement respects the grain rule (tester)', () => {
  function withFixed(sheet: number, part: number): Project {
    let p = load(shelfSet);
    p = run(p, 'setGrain', { grain: sheet });
    for (const pt of p.parts) p = run(p, 'setPartGrain', { id: pt.id, mode: 'fixed', angle: part });
    return { ...p, layout: nestProject(p, { toolDiameter: 8 }).layout };
  }

  it('only the two allowed rotations are accepted for a fixed part', () => {
    const p = withFixed(0, 30);
    const pl = p.layout.sheets[0]!.placements[0]!;
    const part = p.parts.find((x) => x.id === pl.partId)!;
    const allowed = allowedRotations(part, p.stock.sheet);
    expect(allowed).toEqual([150, 330]);
    for (const rot of [0, 90, 180, 270, 30, 210, 150.001])
      expect(
        applyCommand(p, 'lockPlacement', {
          partId: pl.partId,
          index: pl.index,
          x: pl.x,
          y: pl.y,
          rot,
        }).ok,
      ).toBe(false);
    for (const rot of allowed)
      expect(
        applyCommand(p, 'lockPlacement', {
          partId: pl.partId,
          index: pl.index,
          x: pl.x,
          y: pl.y,
          rot,
        }).ok,
      ).toBe(true);
  });

  it('a fixed 30° part never appears at another angle after nesting, for any sheet grain', () => {
    fc.assert(
      fc.property(grain3, grain3, (sheet, part) => {
        const p = withFixed(sheet, part);
        for (const s of p.layout.sheets)
          for (const pl of s.placements) {
            const pt = p.parts.find((x) => x.id === pl.partId)!;
            expect(allowedRotations(pt, p.stock.sheet)).toContain(pl.rot);
          }
      }),
      { numRuns: 25 },
    );
  });
});

describe('KNOWN GAP: a locked copy keeps a rotation the grain no longer allows (tester)', () => {
  /**
   * D-034: `allowedRotations` is the single source for placer, layout drag AND validation.
   * Repro: shelf-set (sheet 90°, fixed parts at grain 90 → rot 0/180), lock one copy at rot 0,
   * then `setGrain(0)`: the part now needs 90/270, but validation reports nothing and runNesting
   * keeps the locked copy at 0 → the cut part has its grain across the sheet grain.
   * `it.fails` = the expected behaviour below is NOT met yet; flip to `it` when fixed.
   */
  function lockedThenRegrained(): Project {
    let p = load(shelfSet);
    p = run(p, 'runNesting', { toolDiameter: 8 });
    const pl = p.layout.sheets[0]!.placements.find(
      (x) => p.parts.find((pt) => pt.id === x.partId)!.grain.mode === 'fixed',
    )!;
    p = run(p, 'lockPlacement', {
      partId: pl.partId,
      index: pl.index,
      x: pl.x,
      y: pl.y,
      rot: pl.rot,
    });
    return run(p, 'setGrain', { grain: 0 });
  }

  it.fails('validation flags a locked copy at a rotation outside allowedRotations', async () => {
    const { validateProject } = await import('../validate');
    const p = lockedThenRegrained();
    const issues = validateProject(p, {}).filter((i) => i.severity === 'error');
    expect(issues.length).toBeGreaterThan(0);
  });

  it.fails('after runNesting every copy of a fixed part is at an allowed rotation', () => {
    const p = run(lockedThenRegrained(), 'runNesting', { toolDiameter: 8 });
    for (const s of p.layout.sheets)
      for (const pl of s.placements) {
        const pt = p.parts.find((x) => x.id === pl.partId)!;
        expect(allowedRotations(pt, p.stock.sheet)).toContain(pl.rot);
      }
  });
});
