/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- tests forge raw JSON */
/** Tester additions for T005 (PR #6): rejection, empty history, log, immutability, tools, rules, perf. */
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { CommandStack, applyCommand, commandToolDefinitions, type CommandContext } from './index';

/** Timing budgets apply as written in CI; local runs on a loaded PC get PERF_BUDGET_SCALE (default 3, D-048). */
const BUDGET = process.env.CI ? 1 : Number(process.env.PERF_BUDGET_SCALE ?? 3);

const user: CommandContext = { actor: 'user', at: '2026-11-16T10:00:00Z' };
const ai: CommandContext = { actor: 'ai', at: '2026-11-16T12:30:45.123+03:00' };

function load(mutate: (json: any) => void = () => {}): Project {
  const json = JSON.parse(JSON.stringify(cabinetDoors));
  mutate(json);
  const result = parseProject(json);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

const part = (id: string, w = 100, h = 100) => ({ id, params: { w, h, r: 0 } });

describe('T005 tester: rejected commands', () => {
  it('invalid params, duplicate id and unknown command change nothing; undo hits the previous valid command', () => {
    const start = load();
    const stack = new CommandStack(start);
    expect(stack.execute('setThickness', { thickness: 20 }, user).ok).toBe(true);
    const afterThickness = stack.project;
    expect(stack.execute('addPart', part('dup'), user).ok).toBe(true);
    const afterAdd = stack.project;
    const logSnapshot = JSON.stringify(stack.log);

    const rejected = [
      stack.execute('setThickness', { thickness: 'x' }, user),
      stack.execute('addPart', { ...part('zz'), extra: 1 }, user),
      stack.execute('addPart', part('dup'), user),
      stack.execute('nope', {}, user),
    ];
    for (const r of rejected) expect(r.ok).toBe(false);
    expect(stack.project).toBe(afterAdd);
    expect(JSON.stringify(stack.log)).toBe(logSnapshot);
    expect(stack.canRedo).toBe(false);

    expect(stack.undo()).toBe(true);
    expect(stack.project).toEqual(afterThickness);
    expect(stack.undo()).toBe(true);
    expect(stack.project).toEqual(start);
    expect(stack.undo()).toBe(false);
  });

  it('a result that would be invalid is rejected with INVALID_RESULT and changes nothing', () => {
    // No reachable command breaks the schema yet, so forge a project that already has a duplicate part id.
    const forged = JSON.parse(JSON.stringify(load())) as any;
    forged.parts.push(JSON.parse(JSON.stringify(forged.parts[0])));
    const stack = new CommandStack(forged as Project);
    const r = stack.execute('setThickness', { thickness: 21 }, user);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_RESULT');
    expect(stack.project).toBe(forged);
    expect(stack.canUndo).toBe(false);
    expect(stack.log).toHaveLength(0);
  });
});

describe('T005 tester: empty history', () => {
  it('undo and redo with nothing to do are no-ops returning false', () => {
    const start = load();
    const stack = new CommandStack(start);
    expect(stack.undo()).toBe(false);
    expect(stack.redo()).toBe(false);
    expect(stack.project).toBe(start);
    expect(stack.log).toHaveLength(0);
    stack.execute('setThickness', { thickness: 20 }, user);
    expect(stack.redo()).toBe(false);
    expect(stack.project.stock.thickness).toBe(20);
    stack.undo();
    expect(stack.undo()).toBe(false);
    expect(stack.project).toEqual(start);
  });

  it('execute after undo clears redo for good', () => {
    const stack = new CommandStack(load());
    stack.execute('setThickness', { thickness: 20 }, user);
    stack.execute('setMaterial', { material: 'ply' }, user);
    stack.undo();
    stack.undo();
    stack.execute('setThickness', { thickness: 30 }, user);
    expect(stack.canRedo).toBe(false);
    expect(stack.redo()).toBe(false);
    expect(stack.project.stock.material).toBe('mdf');
    expect(stack.log.map((e) => e.command)).toEqual([
      'setThickness',
      'setMaterial',
      'setThickness',
    ]);
  });
});

describe('T005 tester: log', () => {
  it('records actor ai vs user and the exact given at; undo/redo do not change it', () => {
    const stack = new CommandStack(load());
    stack.execute('setThickness', { thickness: 20 }, user);
    stack.execute('setThickness', { thickness: 21 }, ai);
    stack.undo();
    stack.redo();
    expect(stack.log.map((e) => [e.actor, e.at])).toEqual([
      ['user', user.at],
      ['ai', ai.at],
    ]);
  });
});

describe('T005 tester: immutability', () => {
  it('returned projects are deeply frozen; mutation throws in strict mode', () => {
    const stack = new CommandStack(load());
    stack.execute('addPart', part('p'), user);
    const p = stack.project;
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.stock)).toBe(true);
    expect(Object.isFrozen(p.parts)).toBe(true);
    expect(Object.isFrozen(p.parts[p.parts.length - 1])).toBe(true);
    expect(() => {
      p.stock.thickness = 99;
    }).toThrow(TypeError);
    expect(() => {
      p.parts.push(p.parts[0] as never);
    }).toThrow(TypeError);
    stack.undo();
    expect(() => {
      stack.project.stock.thickness = 99;
    }).toThrow(TypeError);
    stack.redo();
    expect(Object.isFrozen(stack.project.parts)).toBe(true);
  });

  it('the input project is never mutated', () => {
    const start = load();
    const snap = JSON.stringify(start);
    const stack = new CommandStack(start);
    stack.execute('addPart', part('p'), user);
    stack.execute('setSheetSize', { width: 1, height: 1 }, user);
    stack.undo();
    stack.redo();
    expect(applyCommand(start, 'addPart', part('q')).ok).toBe(true);
    expect(JSON.stringify(start)).toBe(snap);
  });
});

describe('T005 tester: AI tool definitions', () => {
  it('one valid object schema per aiTool command; no export or profile editing', () => {
    const tools = commandToolDefinitions();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(
      [
        'addHole',
        'updateHole',
        'removeHole',
        'addPart',
        'duplicatePart',
        'importCutList',
        'runNesting',
        'setNestingOptions',
        'removePart',
        'setMachine',
        'setMaterial',
        'setGrain',
        'setPartGrain',
        'setSheetSize',
        'setThickness',
        'updatePart',
        'updateParts',
      ].sort(),
    );
    for (const t of tools) {
      expect(t.inputSchema['type']).toBe('object');
      expect(typeof t.inputSchema['properties']).toBe('object');
      expect(t.name).not.toMatch(/export|profile|gcode|dxf|pdf/i);
      expect(JSON.parse(JSON.stringify(t))).toEqual(t);
    }
  });
});

describe('T005 tester: validation scenarios', () => {
  // Sheet 2800 x 2100; a 100 x 2110 part is 10 mm too tall as is and only fits turned (2110 <= 2800, 100 <= 2100).
  const withSheet = () => {
    const stack = new CommandStack(load((j) => (j.layout.sheets = [])));
    stack.execute('setSheetSize', { width: 2800, height: 2100 }, user);
    return stack;
  };

  it('10 mm too tall with grainLock false fits rotated: no issue', () => {
    const stack = withSheet();
    const r = stack.execute(
      'addPart',
      { id: 'rot', grainLock: false, params: { w: 100, h: 2110, r: 0 } },
      user,
    );
    expect(r.ok).toBe(true);
    expect(stack.issues).toEqual([]);
  });

  it('the same part with grainLock true is flagged and unflagged after undo', () => {
    const stack = withSheet();
    stack.execute('addPart', { id: 'g', grainLock: true, params: { w: 100, h: 2110, r: 0 } }, user);
    expect(stack.issues.map((i) => i.code)).toEqual(['PART_LARGER_THAN_SHEET']);
    stack.undo();
    expect(stack.issues).toEqual([]);
  });

  it('pocket depth == thickness is flagged; thickness - 0.1 is not', () => {
    const eq = load((j) => (j.parts[0].holes[0].depth = j.stock.thickness));
    expect(validateProject(eq).map((i) => i.code)).toEqual(['HOLE_DEPTH_NOT_BELOW_THICKNESS']);
    const below = load((j) => (j.parts[0].holes[0].depth = j.stock.thickness - 0.1));
    expect(validateProject(below)).toEqual([]);
  });
});

describe('T005 tester: performance', () => {
  it('1000 sequential addPart then 1000 undo finish in under 20 s (O(n²) guard, tolerant of load)', () => {
    const stack = new CommandStack(load());
    const baseParts = stack.project.parts.length;
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      const r = stack.execute('addPart', part(`p${i}`, 50 + (i % 10), 60), user);
      if (!r.ok) throw new Error(`addPart ${i} failed: ${r.error.message}`);
    }
    expect(stack.project.parts).toHaveLength(baseParts + 1000);
    for (let i = 0; i < 1000; i++) expect(stack.undo()).toBe(true);
    const total = Date.now() - t0;
    expect(total).toBeLessThan(20_000 * BUDGET);
    expect(stack.canUndo).toBe(false);
    expect(stack.project.parts).toHaveLength(baseParts);
  }, 60_000);
});
