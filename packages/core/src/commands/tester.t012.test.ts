import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { applyCommand, CommandStack } from './index';

const ctx = { actor: 'user' as const, at: '2026-11-17T10:00:00Z' };
function load(): Project {
  const r = parseProject(JSON.parse(JSON.stringify(shelfSet)));
  if (!r.ok) throw new Error('bad fixture');
  return r.project;
}

describe('T012 tester: executeApplied with a stale base', () => {
  it('STALE_BASE after the project changed; project, log and undo stack unchanged', () => {
    const start = load();
    const stack = new CommandStack(start);
    const applied = applyCommand(start, 'runNesting', { toolDiameter: 8 });
    if (!applied.ok) throw new Error('not applied');
    // The user edits the options while the worker runs.
    expect(stack.execute('setNestingOptions', { gap: 3 }, ctx).ok).toBe(true);
    const before = stack.project;
    const snapshot = JSON.stringify(before);
    const logLen = stack.log.length;
    const r = stack.executeApplied('runNesting', applied, ctx, start);
    expect(r).toMatchObject({ ok: false, error: { code: 'STALE_BASE' } });
    expect(stack.project).toBe(before);
    expect(JSON.stringify(stack.project)).toBe(snapshot);
    expect(stack.log).toHaveLength(logLen);
    expect(stack.project.layout.sheets).toEqual(start.layout.sheets);
    stack.undo(); // undoes the option edit, not a phantom nesting
    expect(stack.project.nesting.gap).toBe(start.nesting.gap);
  });
});
