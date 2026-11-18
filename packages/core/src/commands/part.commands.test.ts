/** T011 part commands: updatePart, removePart, duplicatePart, importCutList. */
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import mixed from '../schema/__fixtures__/mixed.json';
import { parseCutList, cutListToParts } from '../cutlist';
import { parseProject, type Project } from '../schema';
import {
  CommandStack,
  MAX_IMPORT_ROWS,
  applyCommand,
  commandToolDefinitions,
  type CommandContext,
} from './index';

const user: CommandContext = { actor: 'user', at: '2026-11-17T10:00:00Z' };

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

function rejected(project: Project, name: string, params: unknown) {
  const result = applyCommand(project, name, params);
  if (result.ok) throw new Error(`${name} should have been rejected`);
  return result.error;
}

const row = (id: string, w = 396, h = 716) => ({ id, params: { w, h, r: 0 } });

describe('importCutList', () => {
  it('appends rect parts in order with defaults, in one step', () => {
    const start = load();
    const next = applied(start, 'importCutList', {
      parts: [
        {
          ...row('a'),
          name: 'Kapak',
          qty: 4,
          grainLock: true,
          edgeBand: { top: 1, right: 1, bottom: 1, left: 1 },
        },
        row('b', 564, 300),
      ],
    });
    expect(next.parts.slice(0, start.parts.length)).toEqual(start.parts);
    expect(next.parts.slice(start.parts.length)).toEqual([
      {
        id: 'a',
        name: 'Kapak',
        qty: 4,
        grain: { mode: 'fixed', angle: 0 },
        kind: 'rect',
        params: { w: 396, h: 716, r: 0 },
        inners: [],
        holes: [],
        edgeBand: { top: 1, right: 1, bottom: 1, left: 1 },
        templates: [],
      },
      {
        id: 'b',
        name: '',
        qty: 1,
        grain: { mode: 'free', angle: 0 },
        kind: 'rect',
        params: { w: 564, h: 300, r: 0 },
        inners: [],
        holes: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ]);
  });

  it('is one undo step', () => {
    const stack = new CommandStack(load());
    const start = stack.project;
    expect(stack.execute('importCutList', { parts: [row('a'), row('b'), row('c')] }, user).ok).toBe(
      true,
    );
    expect(stack.project.parts).toHaveLength(start.parts.length + 3);
    expect(stack.log).toHaveLength(1);
    stack.undo();
    expect(stack.project).toEqual(start);
  });

  it('rejects duplicate ids (inside the list or already used), empty lists and bad rows', () => {
    const start = load();
    expect(rejected(start, 'importCutList', { parts: [row('a'), row('a')] }).code).toBe(
      'PRECONDITION_FAILED',
    );
    expect(rejected(start, 'importCutList', { parts: [row('door-left')] }).code).toBe(
      'PRECONDITION_FAILED',
    );
    expect(rejected(start, 'importCutList', { parts: [] }).issues[0]?.path).toBe('params.parts');
    const bad = rejected(start, 'importCutList', {
      parts: [row('a'), { id: 'b', params: { w: 0, h: 5, r: 0 } }],
    });
    expect(bad.code).toBe('INVALID_PARAMS');
    expect(bad.issues[0]?.path).toBe('params.parts[1].params.w');
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => row(`p${i}`));
    expect(rejected(start, 'importCutList', { parts: tooMany }).code).toBe('INVALID_PARAMS');
  });

  it('takes the output of parseCutList + cutListToParts as is', () => {
    const parsed = parseCutList(
      'Ad\tEn\tBoy\tAdet\tDamar\tBant\nKapak\t39,6\t71,6\t2\tevet\t0,8\n',
    );
    expect(parsed.unitAmbiguous).toBe(true);
    const parts = cutListToParts(parsed.rows, ['k1'], 'cm');
    const next = applied(load(), 'importCutList', { parts });
    expect(next.parts.at(-1)).toMatchObject({
      id: 'k1',
      name: 'Kapak',
      qty: 2,
      grain: { mode: 'fixed', angle: 0 },
      params: { w: 396, h: 716, r: 0 },
      edgeBand: { top: 0.8, right: 0.8, bottom: 0.8, left: 0.8 },
    });
  });
});

describe('updatePart', () => {
  it('changes only the given fields', () => {
    const start = load();
    const next = applied(start, 'updatePart', {
      id: 'door-left',
      name: 'Sol kapak',
      params: { w: 400 },
    });
    const [before] = start.parts;
    expect(next.parts[0]).toEqual({
      ...before,
      name: 'Sol kapak',
      params: { ...(before as { params: object }).params, w: 400 },
    });
    expect(next.parts[1]).toBe(start.parts[1]);
  });

  it('edge band may be partial; grainLock and qty change', () => {
    const next = applied(load(), 'updatePart', {
      id: 'door-left',
      grainLock: false,
      qty: 3,
      edgeBand: { left: 2 },
    });
    expect(next.parts[0]).toMatchObject({ grain: { mode: 'free', angle: 0 }, qty: 3 });
    expect(next.parts[0]?.edgeBand.left).toBe(2);
  });

  it('a size change drops the cached outline (params are the source)', () => {
    const start = load();
    expect(start.parts[1]?.kind === 'rect' && start.parts[1].outline).toBeTruthy();
    const next = applied(start, 'updatePart', { id: 'door-right', params: { h: 600 } });
    expect(next.parts[1]).not.toHaveProperty('outline');
    const renamed = applied(start, 'updatePart', { id: 'door-right', name: 'x' });
    expect(renamed.parts[1]).toHaveProperty('outline');
  });

  it('lowering qty drops placements of copies that no longer exist', () => {
    const next = applied(load(), 'updatePart', { id: 'door-left', qty: 1 });
    expect(next.layout.sheets[0]?.placements.map((p) => `${p.partId}#${p.index}`)).toEqual([
      'door-left#0',
      'door-right#0',
      'door-right#1',
    ]);
  });

  it('rejects unknown ids, empty changes, bad values and size changes on freeform parts', () => {
    const start = load();
    expect(rejected(start, 'updatePart', { id: 'nope', name: 'x' }).code).toBe(
      'PRECONDITION_FAILED',
    );
    expect(rejected(start, 'updatePart', { id: 'door-left' }).code).toBe('INVALID_PARAMS');
    expect(rejected(start, 'updatePart', { id: 'door-left', qty: 0 }).issues[0]?.path).toBe(
      'params.qty',
    );
    expect(rejected(start, 'updatePart', { id: 'door-left', params: { w: -1 } }).code).toBe(
      'INVALID_PARAMS',
    );
    expect(rejected(start, 'updatePart', { id: 'door-left', params: { r: 5000 } }).code).toBe(
      'INVALID_RESULT',
    );
    expect(rejected(load(mixed), 'updatePart', { id: 'arch-panel', params: { w: 10 } }).code).toBe(
      'PRECONDITION_FAILED',
    );
    expect(applied(load(mixed), 'updatePart', { id: 'arch-panel', qty: 2 }).parts[0]?.qty).toBe(2);
  });
});

describe('removePart', () => {
  it('removes the part and its placements', () => {
    const next = applied(load(), 'removePart', { id: 'door-left' });
    expect(next.parts.map((p) => p.id)).toEqual(['door-right']);
    expect(next.layout.sheets[0]?.placements.every((p) => p.partId === 'door-right')).toBe(true);
  });

  it('rejects an unknown id', () => {
    expect(rejected(load(), 'removePart', { id: 'nope' }).code).toBe('PRECONDITION_FAILED');
  });
});

describe('duplicatePart', () => {
  it('inserts a deep copy with the new id right after the original, unplaced', () => {
    const start = load(mixed);
    const next = applied(start, 'duplicatePart', {
      id: 'arch-panel',
      newId: 'arch-2',
      name: 'Kopya',
    });
    expect(next.parts.map((p) => p.id)).toEqual(['arch-panel', 'arch-2', 'tray']);
    expect(next.parts[1]).toEqual({ ...start.parts[0], id: 'arch-2', name: 'Kopya' });
    expect(next.parts[1]?.holes).not.toBe(start.parts[0]?.holes);
    expect(next.layout).toBe(start.layout);
  });

  it('keeps the name when none is given; rejects unknown source and taken new id', () => {
    const start = load();
    expect(applied(start, 'duplicatePart', { id: 'door-left', newId: 'x' }).parts[1]?.name).toBe(
      start.parts[0]?.name,
    );
    expect(rejected(start, 'duplicatePart', { id: 'nope', newId: 'x' }).code).toBe(
      'PRECONDITION_FAILED',
    );
    expect(rejected(start, 'duplicatePart', { id: 'door-left', newId: 'door-right' }).code).toBe(
      'PRECONDITION_FAILED',
    );
  });
});

describe('AI tool definitions of the part commands', () => {
  const tools = commandToolDefinitions();
  const schema = (name: string) => tools.find((t) => t.name === name)?.inputSchema;

  it('required fields', () => {
    expect(schema('importCutList')?.['required']).toEqual(['parts']);
    expect(schema('updatePart')?.['required']).toEqual(['id']);
    expect(schema('removePart')?.['required']).toEqual(['id']);
    expect(schema('duplicatePart')?.['required']).toEqual(['id', 'newId']);
  });
});

describe('no-op commands leave no history (T011 round 1)', () => {
  it('updatePart with the current values: accepted, no undo step, no log entry, redo kept', () => {
    const stack = new CommandStack(load());
    expect(stack.execute('updatePart', { id: 'door-left', params: { w: 500 } }, user).ok).toBe(
      true,
    );
    const afterEdit = stack.project;
    expect(stack.undo()).toBe(true);
    expect(stack.redo()).toBe(true);
    expect(stack.canRedo).toBe(false);

    const before = stack.project;
    const w = afterEdit.parts[0]?.kind === 'rect' ? afterEdit.parts[0].params.w : -1;
    const same = stack.execute('updatePart', { id: 'door-left', params: { w } }, user);
    expect(same).toMatchObject({ ok: true, changed: false });
    expect(stack.project).toBe(before);
    expect(stack.log).toHaveLength(1);

    // One undo still goes back to before the single real edit.
    expect(stack.undo()).toBe(true);
    expect(stack.canUndo).toBe(false);

    // A no-op after an undo keeps the redo stack.
    const name = stack.project.parts[0]?.name ?? '';
    expect(stack.execute('updatePart', { id: 'door-left', name }, user)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(stack.canRedo).toBe(true);
  });

  it('a real change reports changed: true', () => {
    const stack = new CommandStack(load());
    expect(stack.execute('updatePart', { id: 'door-left', qty: 9 }, user)).toMatchObject({
      ok: true,
      changed: true,
    });
  });
});
