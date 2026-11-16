/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit raw JSON to build projects */
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { nestProject, summarizeLayout } from '../nesting';
import { applyCommand, CommandStack, commandToolDefinitions } from './index';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const ctx = { actor: 'user' as const, at: '2026-11-17T10:00:00Z' };

function load(mutate: (j: any) => void = () => {}): Project {
  const copy = JSON.parse(JSON.stringify(shelfSet));
  mutate(copy);
  const r = parseProject(copy);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

describe('setNestingOptions', () => {
  it('sets only the given fields; one undo step each', () => {
    const stack = new CommandStack(load());
    const r = stack.execute('setNestingOptions', { gap: 4 }, ctx);
    expect(r.ok).toBe(true);
    expect(stack.project.nesting).toEqual({ mode: 'fastest', gap: 4, margin: 12 });
    stack.execute('setNestingOptions', { mode: 'minWaste', margin: 0 }, ctx);
    expect(stack.project.nesting).toEqual({ mode: 'minWaste', gap: 4, margin: 0 });
    stack.undo();
    stack.undo();
    expect(stack.project.nesting).toEqual({ mode: 'fastest', gap: 10, margin: 12 });
  });

  it('rejects empty params, a negative gap and unknown modes', () => {
    const p = load();
    expect(applyCommand(p, 'setNestingOptions', {})).toMatchObject({ ok: false });
    expect(applyCommand(p, 'setNestingOptions', { gap: -1 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PARAMS' },
    });
    expect(applyCommand(p, 'setNestingOptions', { mode: 'cheapest' })).toMatchObject({
      ok: false,
    });
  });
});

describe('runNesting', () => {
  it('writes the placer layout; undo restores the old layout byte for byte', () => {
    const start = load();
    const startJson = JSON.stringify(start);
    const stack = new CommandStack(start);
    const r = stack.execute('runNesting', { toolDiameter: 8 }, ctx);
    expect(r.ok && r.changed).toBe(true);
    expect(stack.project.layout).toEqual(nestProject(start, { toolDiameter: 8 }).layout);
    expect(summarizeLayout(stack.project).sheetCount).toBe(1);
    expect(stack.log.at(-1)).toEqual({
      command: 'runNesting',
      params: { toolDiameter: 8 },
      ...ctx,
    });
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(startJson);
  });

  it('running twice changes nothing the second time (deterministic)', () => {
    const stack = new CommandStack(load());
    stack.execute('runNesting', { toolDiameter: 6 }, ctx);
    const again = stack.execute('runNesting', { toolDiameter: 6 }, ctx);
    expect(again.ok && again.changed).toBe(false);
  });

  it('keeps locked placements and re-nests the unlocked ones', () => {
    const locked = { partId: 'side', index: 1, x: 1500, y: 100, rot: 0 as const, locked: true };
    const start = load((j) => {
      j.layout.sheets = [
        {
          placements: [{ partId: 'shelf', index: 0, x: 12, y: 12, rot: 0, locked: false }, locked],
        },
      ];
    });
    const r = applyCommand(start, 'runNesting', { toolDiameter: 8 });
    if (!r.ok) throw new Error(r.error.message);
    const sheet0 = r.project.layout.sheets[0]!.placements;
    expect(sheet0[0]).toEqual(locked);
    expect(sheet0.filter((p) => p.locked)).toEqual([locked]);
    const keys = r.project.layout.sheets.flatMap((s) =>
      s.placements.map((p) => `${p.partId}#${p.index}`),
    );
    expect(new Set(keys).size).toBe(8);
    expect(keys).toHaveLength(8);
  });

  it('rejects a missing, zero or too large tool diameter', () => {
    const p = load();
    for (const params of [{}, { toolDiameter: 0 }, { toolDiameter: 51 }]) {
      expect(applyCommand(p, 'runNesting', params)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PARAMS' },
      });
    }
  });

  it('is an AI tool that takes only the tool diameter (the AI never supplies placements)', () => {
    const tool = commandToolDefinitions().find((t) => t.name === 'runNesting')!;
    expect(Object.keys(tool.inputSchema['properties'] as object)).toEqual(['toolDiameter']);
  });
});

describe('CommandStack.executeApplied (worker results)', () => {
  it('records a command applied elsewhere as one undo step', () => {
    const start = load();
    const stack = new CommandStack(start);
    const applied = applyCommand(clone(start), 'runNesting', { toolDiameter: 8 });
    if (!applied.ok) throw new Error('not applied');
    const r = stack.executeApplied('runNesting', clone(applied), ctx, start);
    expect(r.ok && r.changed).toBe(true);
    expect(stack.project).toEqual(applied.project);
    expect(stack.log).toHaveLength(1);
    stack.undo();
    expect(stack.project).toEqual(start);
    stack.redo();
    expect(stack.project).toEqual(applied.project);
  });

  it('rejects a stale base, an unknown command and a bad context; nothing changes', () => {
    const start = load();
    const stack = new CommandStack(start);
    const applied = applyCommand(start, 'runNesting', { toolDiameter: 8 });
    if (!applied.ok) throw new Error('not applied');
    stack.execute('setNestingOptions', { gap: 2 }, ctx);
    const before = stack.project;
    expect(stack.executeApplied('runNesting', applied, ctx, start)).toMatchObject({
      ok: false,
      error: { code: 'STALE_BASE' },
    });
    expect(stack.executeApplied('nope', applied, ctx, before)).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_COMMAND' },
    });
    expect(
      stack.executeApplied('runNesting', applied, { actor: 'robot', at: 'x' } as never, before),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_CONTEXT' } });
    expect(stack.project).toBe(before);
    expect(stack.log).toHaveLength(1);
  });

  it('rejects patches that would make the project invalid', () => {
    const start = load();
    const stack = new CommandStack(start);
    const r = stack.executeApplied(
      'runNesting',
      {
        params: { toolDiameter: 8 },
        patches: [{ op: 'replace', path: ['layout'], value: { sheets: 'x' } }],
        inversePatches: [],
      },
      ctx,
      start,
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_RESULT' } });
    expect(stack.project).toBe(start);
  });
});
