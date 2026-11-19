/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
import { applyCommand, CommandStack, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { newProject } from './draft-project';
import {
  appliedFromCache,
  NESTING_CACHE_SIZE,
  NestingCache,
  optionSetKey,
  optionSetKeyForMode,
} from './nesting-cache';

const ctx = { actor: 'user' as const, at: '2026-11-19T10:00:00Z' };

function withParts(): Project {
  let p = newProject();
  for (const [id, w, h, qty] of [
    ['a', 600, 400, 3],
    ['b', 300, 200, 5],
  ] as const) {
    const r = applyCommand(p, 'addPart', {
      id,
      name: id,
      params: { w, h, r: 0 },
      qty,
    });
    if (!r.ok) throw new Error(r.error.message);
    p = r.project;
  }
  return p;
}

function nested(p: Project, toolDiameter = 6): Project {
  const r = applyCommand(p, 'runNesting', { toolDiameter });
  if (!r.ok) throw new Error(r.error.message);
  return r.project;
}

describe('optionSetKey (T163)', () => {
  it('ignores unlocked placements but not locked ones', () => {
    const p = withParts();
    const n = nested(p);
    const params = { toolDiameter: 6 };
    expect(optionSetKey(n, params)).toBe(optionSetKey(p, params));
    const first = n.layout.sheets[0]!.placements[0]!;
    const locked = applyCommand(n, 'lockPlacement', { partId: first.partId, index: first.index });
    if (!locked.ok) throw new Error('lock');
    expect(optionSetKey(locked.project, params)).not.toBe(optionSetKey(p, params));
  });

  it('changes with every option the placer reads', () => {
    const p = withParts();
    const params = { toolDiameter: 6 };
    const k = optionSetKey(p, params);
    expect(optionSetKey(p, { toolDiameter: 8 })).not.toBe(k);
    expect(optionSetKey(p, { toolDiameter: 6, contourTool: 1 })).not.toBe(k);
    for (const change of [
      { mode: 'fastest' },
      { gap: 3 },
      { margin: 1 },
      { rotation: 'none' },
    ] as const) {
      const r = applyCommand(p, 'setNestingOptions', change);
      if (!r.ok) throw new Error('opt');
      expect(optionSetKey(r.project, params)).not.toBe(k);
    }
    expect(optionSetKeyForMode(p, params, p.nesting.mode)).toBe(k);
  });
});

describe('NestingCache', () => {
  it('keeps at most NESTING_CACHE_SIZE sets, dropping the least recently used', () => {
    const p = nested(withParts());
    const cache = new NestingCache();
    for (let i = 0; i < NESTING_CACHE_SIZE; i++) cache.set(`k${i}`, p.layout, p);
    cache.get('k0');
    cache.set('new', p.layout, p);
    expect(cache.size).toBe(NESTING_CACHE_SIZE);
    expect(cache.peek('k0')).toBeDefined();
    expect(cache.peek('k1')).toBeUndefined();
    expect(cache.peek('new')?.summary.sheetCount).toBe(p.layout.sheets.length);
  });
});

describe('appliedFromCache', () => {
  it('records like the command: one undo step back to the old layout; nothing when equal', () => {
    const p = withParts();
    const n = nested(p);
    const stack = new CommandStack(p);
    const before = JSON.stringify(stack.project);
    const r = stack.executeApplied(
      'runNesting',
      appliedFromCache(stack.project, { toolDiameter: 6 }, n.layout),
      ctx,
      stack.project,
    );
    expect(r.ok && r.changed).toBe(true);
    expect(stack.project.layout).toEqual(n.layout);
    const again = appliedFromCache(stack.project, { toolDiameter: 6 }, n.layout);
    expect(again.patches).toEqual([]);
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(before);
  });
});
