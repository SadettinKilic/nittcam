/**
 * T170: `lockPlacements` locks or unlocks a multi-selection in one undo step, positions untouched;
 * re-nesting ("kilitsizleri yeniden diz") keeps the locked copies where they are.
 */
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { applyCommand, CommandStack } from './index';

const ctx = { actor: 'user' as const, at: '2026-11-20T10:00:00Z' };

function nested(): Project {
  const r = parseProject(JSON.parse(JSON.stringify(shelfSet)));
  if (!r.ok) throw new Error('fixture');
  const n = applyCommand(r.project, 'runNesting', { toolDiameter: 8 });
  if (!n.ok) throw new Error('not nested');
  return n.project;
}

const all = (p: Project) => p.layout.sheets.flatMap((s) => s.placements);

describe('lockPlacements (T170)', () => {
  it('locks several copies in one undo step and keeps their positions', () => {
    const p = nested();
    const refs = all(p)
      .slice(0, 3)
      .map((pl) => ({ partId: pl.partId, index: pl.index }));
    const stack = new CommandStack(p);
    const r = stack.execute('lockPlacements', { refs, locked: true }, ctx);
    expect(r.ok && r.changed).toBe(true);
    const after = all(stack.project);
    const pos = (pl: { x: number; y: number; rot: number }) => [pl.x, pl.y, pl.rot];
    expect(after.slice(0, 3).map(pos)).toEqual(all(p).slice(0, 3).map(pos));
    for (const pl of after.slice(0, 3)) {
      expect(pl.locked).toBe(true);
    }
    expect(after.slice(3).every((pl) => !pl.locked)).toBe(true);
    stack.undo();
    expect(all(stack.project).every((pl) => !pl.locked)).toBe(true);
  });

  it('unlocks; an unchanged call records nothing', () => {
    const p = nested();
    const refs = all(p)
      .slice(0, 2)
      .map((pl) => ({ partId: pl.partId, index: pl.index }));
    const stack = new CommandStack(p);
    const same = stack.execute('lockPlacements', { refs, locked: false }, ctx);
    expect(same.ok && same.changed).toBe(false);
    stack.execute('lockPlacements', { refs }, ctx);
    stack.execute('lockPlacements', { refs, locked: false }, ctx);
    expect(all(stack.project).every((pl) => !pl.locked)).toBe(true);
  });

  it('refuses an unplaced copy and an empty selection', () => {
    const p = nested();
    expect(
      applyCommand(p, 'lockPlacements', { refs: [{ partId: 'nope', index: 0 }] }),
    ).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
    expect(applyCommand(p, 'lockPlacements', { refs: [] }).ok).toBe(false);
  });

  it('re-nesting keeps the locked copies in place', () => {
    const p = nested();
    const pick = all(p).slice(0, 2);
    const locked = applyCommand(p, 'lockPlacements', {
      refs: pick.map((pl) => ({ partId: pl.partId, index: pl.index })),
    });
    if (!locked.ok) throw new Error('lock');
    const again = applyCommand(locked.project, 'runNesting', { toolDiameter: 8 });
    if (!again.ok) throw new Error('renest');
    for (const pl of pick) {
      const now = all(again.project).find((q) => q.partId === pl.partId && q.index === pl.index);
      expect(now).toMatchObject({ x: pl.x, y: pl.y, rot: pl.rot, locked: true });
    }
  });
});
