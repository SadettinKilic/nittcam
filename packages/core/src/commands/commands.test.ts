import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import { parseProject, type Project } from '../schema';
import {
  COMMANDS,
  CommandStack,
  applyCommand,
  applyPatches,
  commandToolDefinitions,
  type CommandContext,
} from './index';

const user: CommandContext = { actor: 'user', at: '2026-11-16T10:00:00Z' };
const ai: CommandContext = { actor: 'ai', at: '2026-11-16T10:01:00+03:00' };

function load(json: unknown = cabinetDoors): Project {
  const result = parseProject(JSON.parse(JSON.stringify(json)));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

function applied(project: Project, name: string, params: unknown): Project {
  const result = applyCommand(project, name, params);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.project;
}

describe('plate commands: apply → expected JSON', () => {
  it('setMachine replaces the machine reference', () => {
    const next = applied(load(), 'setMachine', { machineId: 'big-router', profileVersion: 4 });
    expect(next.machine).toEqual({ machineId: 'big-router', profileVersion: 4 });
  });

  it('setMaterial changes only stock.material', () => {
    const start = load();
    const next = applied(start, 'setMaterial', { material: 'plywood' });
    expect(next).toEqual({ ...start, stock: { ...start.stock, material: 'plywood' } });
  });

  it('setThickness changes only stock.thickness', () => {
    const start = load();
    const next = applied(start, 'setThickness', { thickness: 25 });
    expect(next).toEqual({ ...start, stock: { ...start.stock, thickness: 25 } });
  });

  it('setSheetSize changes width and height and keeps the grain', () => {
    const start = load();
    const next = applied(start, 'setSheetSize', { width: 3660, height: 1830 });
    expect(next.stock.sheet).toEqual({ width: 3660, height: 1830, grain: start.stock.sheet.grain });
  });

  it('rejects invalid params with readable paths and leaves the project untouched', () => {
    const start = load();
    const before = JSON.stringify(start);
    for (const [name, params, path] of [
      ['setThickness', { thickness: 0 }, 'params.thickness'],
      ['setThickness', { thickness: -3 }, 'params.thickness'],
      ['setMaterial', { material: '' }, 'params.material'],
      ['setSheetSize', { width: 2800 }, 'params.height'],
      ['setMachine', { machineId: 'x', profileVersion: 1.5 }, 'params.profileVersion'],
      ['setThickness', { thickness: 18, extra: 1 }, 'params'],
    ] as const) {
      const result = applyCommand(start, name, params);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('INVALID_PARAMS');
      expect(result.error.issues.map((i) => i.path)).toContain(path);
    }
    expect(JSON.stringify(start)).toBe(before);
  });

  it('rejects an unknown command', () => {
    const result = applyCommand(load(), 'exportNc', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_COMMAND');
  });
});

describe('addPart', () => {
  it('appends a rect part with defaults applied', () => {
    const start = load();
    const next = applied(start, 'addPart', { id: 'shelf', params: { w: 600, h: 300, r: 0 } });
    expect(next.parts).toHaveLength(start.parts.length + 1);
    expect(next.parts.at(-1)).toEqual({
      id: 'shelf',
      name: '',
      qty: 1,
      grainLock: false,
      kind: 'rect',
      params: { w: 600, h: 300, r: 0 },
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    });
    expect(next.parts.slice(0, -1)).toEqual(start.parts);
  });

  it('keeps every given field', () => {
    const next = applied(load(), 'addPart', {
      id: 'top',
      name: 'Üst tabla',
      qty: 3,
      grainLock: true,
      params: { w: 800, h: 300, r: 5 },
      edgeBand: { top: 0, right: 2, bottom: 2, left: 2 },
    });
    expect(next.parts.at(-1)).toMatchObject({
      id: 'top',
      name: 'Üst tabla',
      qty: 3,
      grainLock: true,
      params: { w: 800, h: 300, r: 5 },
      edgeBand: { top: 0, right: 2, bottom: 2, left: 2 },
    });
  });

  it('rejects a duplicate id', () => {
    const result = applyCommand(load(), 'addPart', {
      id: 'door-left',
      params: { w: 10, h: 10, r: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PRECONDITION_FAILED');
      expect(result.error.message).toMatch(/door-left/);
    }
  });

  it('rejects a corner radius above half the shorter side', () => {
    const result = applyCommand(load(), 'addPart', { id: 'x', params: { w: 100, h: 40, r: 21 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues.map((i) => i.path)).toContain('params.params.r');
  });

  it('rejects zero or non-integer qty', () => {
    for (const qty of [0, 1.5, -1]) {
      const result = applyCommand(load(), 'addPart', {
        id: 'x',
        qty,
        params: { w: 1, h: 1, r: 0 },
      });
      expect(result.ok).toBe(false);
    }
  });
});

describe('patches', () => {
  it('inverse patches restore the start; forward patches reproduce the result', () => {
    const start = load();
    const result = applyCommand(start, 'addPart', { id: 'p', params: { w: 1, h: 2, r: 0 } });
    if (!result.ok) throw new Error('expected ok');
    expect(applyPatches(result.project, result.inversePatches)).toEqual(start);
    expect(applyPatches(start, result.patches)).toEqual(result.project);
  });

  it('does not mutate the input project', () => {
    const start = load();
    const snapshot = JSON.stringify(start);
    applied(start, 'setSheetSize', { width: 100, height: 100 });
    applied(start, 'addPart', { id: 'p', params: { w: 1, h: 2, r: 0 } });
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe('CommandStack', () => {
  it('execute, undo, redo, canUndo, canRedo', () => {
    const start = load();
    const stack = new CommandStack(start);
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    expect(stack.undo()).toBe(false);
    expect(stack.redo()).toBe(false);

    expect(stack.execute('setThickness', { thickness: 25 }, user).ok).toBe(true);
    const afterThickness = stack.project;
    expect(stack.execute('setMaterial', { material: 'plywood' }, ai).ok).toBe(true);
    expect(stack.canUndo).toBe(true);

    expect(stack.undo()).toBe(true);
    expect(stack.project).toEqual(afterThickness);
    expect(stack.canRedo).toBe(true);
    expect(stack.redo()).toBe(true);
    expect(stack.project.stock.material).toBe('plywood');
    expect(stack.undo() && stack.undo()).toBe(true);
    expect(stack.project).toEqual(start);
    expect(stack.canUndo).toBe(false);
  });

  it('executing after an undo clears the redo stack', () => {
    const stack = new CommandStack(load());
    stack.execute('setThickness', { thickness: 25 }, user);
    stack.undo();
    expect(stack.canRedo).toBe(true);
    stack.execute('setThickness', { thickness: 16 }, user);
    expect(stack.canRedo).toBe(false);
    expect(stack.redo()).toBe(false);
    expect(stack.project.stock.thickness).toBe(16);
  });

  it('logs who, when, which command and the parsed params', () => {
    const stack = new CommandStack(load());
    stack.execute('setThickness', { thickness: 25 }, user);
    stack.execute('addPart', { id: 'p', params: { w: 1, h: 2, r: 0 } }, ai);
    expect(stack.log).toEqual([
      { command: 'setThickness', params: { thickness: 25 }, actor: 'user', at: user.at },
      {
        command: 'addPart',
        params: {
          id: 'p',
          name: '',
          qty: 1,
          grainLock: false,
          params: { w: 1, h: 2, r: 0 },
          edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        actor: 'ai',
        at: ai.at,
      },
    ]);
  });

  it('a rejected command changes nothing: project, stacks and log', () => {
    const stack = new CommandStack(load());
    stack.execute('setThickness', { thickness: 25 }, user);
    stack.undo();
    const project = stack.project;
    const result = stack.execute('setThickness', { thickness: -1 }, user);
    expect(result.ok).toBe(false);
    expect(stack.project).toBe(project);
    expect(stack.canRedo).toBe(true);
    expect(stack.log).toHaveLength(1);
  });

  it('rejects a bad context (actor, timestamp)', () => {
    const stack = new CommandStack(load());
    const bad = [
      { actor: 'robot', at: user.at },
      { actor: 'user', at: 'yesterday' },
      { actor: 'user', at: '' },
    ] as unknown as CommandContext[];
    for (const ctx of bad) {
      const result = stack.execute('setThickness', { thickness: 20 }, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_CONTEXT');
    }
    expect(stack.log).toHaveLength(0);
  });

  it('runs validation after execute, undo and redo', () => {
    const stack = new CommandStack(load());
    expect(stack.issues).toEqual([]);
    const result = stack.execute('setThickness', { thickness: 10 }, user);
    if (!result.ok) throw new Error('expected ok');
    // The fixture's 12.5 mm hinge pockets are now deeper than the 10 mm stock.
    expect(result.issues.map((i) => i.code)).toEqual(
      Array(4).fill('HOLE_DEPTH_NOT_BELOW_THICKNESS'),
    );
    expect(stack.issues).toEqual(result.issues);
    stack.undo();
    expect(stack.issues).toEqual([]);
    stack.redo();
    expect(stack.issues).toHaveLength(4);
  });
});

describe('commandToolDefinitions (future AI tools)', () => {
  const tools = commandToolDefinitions();

  it('exports one JSON Schema per AI-callable command', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'addPart',
        'duplicatePart',
        'importCutList',
        'removePart',
        'setMachine',
        'setMaterial',
        'setSheetSize',
        'setThickness',
        'updatePart',
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema['type']).toBe('object');
      expect(tool.inputSchema['additionalProperties']).toBe(false);
      expect(JSON.parse(JSON.stringify(tool.inputSchema))).toEqual(tool.inputSchema);
    }
  });

  it('addPart: only id and params are required (the rest has defaults)', () => {
    const addPart = tools.find((t) => t.name === 'addPart');
    expect(addPart?.inputSchema['required']).toEqual(['id', 'params']);
    const props = addPart?.inputSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['params']?.['required']).toEqual(['w', 'h', 'r']);
    expect(props['qty']?.['default']).toBe(1);
  });

  it('setThickness: thickness is a positive number', () => {
    const schema = tools.find((t) => t.name === 'setThickness')?.inputSchema;
    expect(schema).toMatchObject({
      required: ['thickness'],
      properties: { thickness: { type: 'number', exclusiveMinimum: 0 } },
    });
  });

  it('never exposes export or machine-profile editing commands', () => {
    for (const tool of tools) {
      expect(tool.name).not.toMatch(/export|profile/i);
    }
    // Every registered command declares its AI flag explicitly.
    for (const def of Object.values(COMMANDS)) expect(typeof def.aiTool).toBe('boolean');
  });
});
