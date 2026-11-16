/** T011 tester: part commands at scale and failure atomicity. */
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import { parseProject, type Project } from '../schema';
import { CommandStack, applyCommand, type CommandContext } from './index';

const user: CommandContext = { actor: 'user', at: '2026-11-17T10:00:00Z' };
function load(): Project {
  const r = parseProject(JSON.parse(JSON.stringify(cabinetDoors)));
  if (!r.ok) throw new Error('fixture');
  return r.project;
}

describe('T011 tester', () => {
  it('importCutList of 2000 rows is one undo step; undo restores exactly; redo reapplies', () => {
    const stack = new CommandStack(load());
    const before = JSON.stringify(stack.project);
    const parts = Array.from({ length: 2000 }, (_, i) => ({
      id: `p${i}`,
      name: `Parça ${i}`,
      qty: 1 + (i % 3),
      params: { w: 300 + (i % 50), h: 500 + (i % 70), r: 0 },
    }));
    const t0 = Date.now();
    const res = stack.execute('importCutList', { parts }, user);
    expect(res.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(stack.log).toHaveLength(1);
    const after = JSON.stringify(stack.project);
    expect(stack.project.parts.length).toBe(JSON.parse(before).parts.length + 2000);
    expect(stack.undo()).toBe(true);
    expect(JSON.stringify(stack.project)).toBe(before);
    expect(stack.canUndo).toBe(false);
    expect(stack.redo()).toBe(true);
    expect(JSON.stringify(stack.project)).toBe(after);
    expect(stack.undo()).toBe(true);
    expect(JSON.stringify(stack.project)).toBe(before);
  });

  it('2001 rows are rejected', () => {
    const parts = Array.from({ length: 2001 }, (_, i) => ({
      id: `p${i}`,
      params: { w: 100, h: 100, r: 0 },
    }));
    expect(applyCommand(load(), 'importCutList', { parts }).ok).toBe(false);
  });

  it('updatePart lowering qty removes now-missing placements; undo restores byte for byte', () => {
    const stack = new CommandStack(load());
    const before = JSON.stringify(stack.project);
    const placed = stack.project.layout.sheets.flatMap((s) => s.placements);
    const target = placed.find((p) => p.index > 0);
    expect(target).toBeDefined();
    const id = target?.partId;
    expect(stack.execute('updatePart', { id, qty: 1 }, user).ok).toBe(true);
    const now = stack.project.layout.sheets.flatMap((s) => s.placements);
    expect(now.filter((p) => p.partId === id && p.index >= 1)).toEqual([]);
    expect(now.length).toBeLessThan(placed.length);
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(before);
  });

  it('duplicatePart with an existing id is rejected and leaves the state unchanged', () => {
    const stack = new CommandStack(load());
    const before = JSON.stringify(stack.project);
    const ids = stack.project.parts.map((p) => p.id);
    expect(stack.execute('duplicatePart', { id: ids[0], newId: ids[1] }, user).ok).toBe(false);
    expect(JSON.stringify(stack.project)).toBe(before);
    expect(stack.canUndo).toBe(false);
    expect(stack.execute('duplicatePart', { id: ids[0], newId: ids[0] }, user).ok).toBe(false);
    expect(JSON.stringify(stack.project)).toBe(before);
  });
});
