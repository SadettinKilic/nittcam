/** T386 assembly model: schema, setAssemblyInstances / resetAssembly, pruning on part edits. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import { parseProject, projectSchema, type AssemblyInstance, type Project } from '../schema';
import { CommandStack, applyCommand, type CommandContext } from './index';

const user: CommandContext = { actor: 'user', at: '2026-11-28T10:00:00Z' };
const at = '2026-11-28T10:00:00Z';

function load(): Project {
  const result = parseProject(JSON.parse(JSON.stringify(cabinetDoors)));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

function applied(project: Project, name: string, params: unknown): Project {
  const result = applyCommand(project, name, params);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.project;
}

const inst = (partId: string, copy: number, x = 0): AssemblyInstance => ({
  id: `${partId}#${copy}`,
  partId,
  copy,
  position: [x, 10, 20],
  rotation: [0, 0, 0, 1],
  hidden: false,
});

describe('assembly schema (T386)', () => {
  it('old projects stay valid without an assembly', () => {
    const p = load();
    expect(p.assembly).toBeUndefined();
    expect(projectSchema.safeParse(p).success).toBe(true);
  });

  it('rejects instances of missing copies, duplicates and non-unit rotations', () => {
    const p = load();
    const bad = (instances: unknown[]) =>
      projectSchema.safeParse({ ...p, assembly: { instances, updatedAt: at } }).success;
    expect(bad([inst('door-left', 0)])).toBe(true);
    expect(bad([inst('door-left', 2)])).toBe(false);
    expect(bad([inst('nope', 0)])).toBe(false);
    expect(bad([inst('door-left', 0), inst('door-left', 0)])).toBe(false);
    expect(bad([{ ...inst('door-left', 0), rotation: [0, 0, 0, 2] }])).toBe(false);
  });
});

describe('setAssemblyInstances', () => {
  it('stores and replaces instances by id, one undo step each', () => {
    const stack = new CommandStack(load());
    expect(
      stack.execute(
        'setAssemblyInstances',
        { instances: [inst('door-left', 1, 5)], updatedAt: at },
        user,
      ).ok,
    ).toBe(true);
    stack.execute(
      'setAssemblyInstances',
      {
        instances: [inst('door-left', 1, 9), inst('door-right', 0)],
        updatedAt: '2026-11-28T11:00:00Z',
      },
      user,
    );
    expect(stack.project.assembly?.instances.map((i) => [i.id, i.position[0]])).toEqual([
      ['door-left#1', 9],
      ['door-right#0', 0],
    ]);
    expect(stack.project.assembly?.updatedAt).toBe('2026-11-28T11:00:00Z');
    stack.undo();
    expect(stack.project.assembly?.instances).toEqual([inst('door-left', 1, 5)]);
    stack.undo();
    expect(stack.project).toEqual(load());
  });

  it('the same values again change nothing (no undo step)', () => {
    const stack = new CommandStack(load());
    stack.execute(
      'setAssemblyInstances',
      { instances: [inst('door-left', 0)], updatedAt: at },
      user,
    );
    const r = stack.execute(
      'setAssemblyInstances',
      { instances: [inst('door-left', 0)], updatedAt: '2026-11-29T00:00:00Z' },
      user,
    );
    expect(r.ok && r.changed).toBe(false);
  });

  it('rejects unknown parts, missing copies and odd ids', () => {
    const p = load();
    const err = (i: AssemblyInstance) =>
      applyCommand(p, 'setAssemblyInstances', { instances: [i], updatedAt: at });
    expect(err(inst('nope', 0)).ok).toBe(false);
    expect(err(inst('door-left', 2)).ok).toBe(false);
    expect(err({ ...inst('door-left', 0), id: 'x' }).ok).toBe(false);
  });

  it('never touches parts, nesting or layout', () => {
    const p = load();
    const next = applied(p, 'setAssemblyInstances', {
      instances: [inst('door-left', 0)],
      updatedAt: at,
    });
    const { assembly, ...rest } = next;
    expect(assembly).toBeDefined();
    expect(rest).toEqual(p);
  });
});

describe('resetAssembly', () => {
  it('drops given copies, or the whole assembly', () => {
    let p = applied(load(), 'setAssemblyInstances', {
      instances: [inst('door-left', 0), inst('door-right', 1)],
      updatedAt: at,
    });
    p = applied(p, 'resetAssembly', { ids: ['door-left#0'], updatedAt: at });
    expect(p.assembly?.instances.map((i) => i.id)).toEqual(['door-right#1']);
    p = applied(p, 'resetAssembly', { updatedAt: at });
    expect(p).toEqual(load());
  });
});

describe('part edits keep the assembly valid', () => {
  const placed = () =>
    applied(load(), 'setAssemblyInstances', {
      instances: [inst('door-left', 0), inst('door-left', 1), inst('door-right', 1)],
      updatedAt: at,
    });

  it('a deleted part loses its instances; undo brings them back', () => {
    const stack = new CommandStack(placed());
    expect(stack.execute('removePart', { id: 'door-left' }, user).ok).toBe(true);
    expect(stack.project.assembly?.instances.map((i) => i.id)).toEqual(['door-right#1']);
    stack.undo();
    expect(stack.project).toEqual(placed());
  });

  it('a quantity drop removes the extra copies', () => {
    const next = applied(placed(), 'updatePart', { id: 'door-right', qty: 1 });
    expect(next.assembly?.instances.map((i) => i.id)).toEqual(['door-left#0', 'door-left#1']);
  });

  it('a project without an assembly gets none from part edits', () => {
    const next = applied(load(), 'updatePart', { id: 'door-right', qty: 1 });
    expect('assembly' in next).toBe(false);
  });

  it('property: any qty edit leaves only valid copies', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }), (a, b) => {
        let p = applied(load(), 'updatePart', { id: 'door-left', qty: 6 });
        p = applied(p, 'setAssemblyInstances', {
          instances: Array.from({ length: a }, (_, c) => inst('door-left', c)),
          updatedAt: at,
        });
        p = applied(p, 'updatePart', { id: 'door-left', qty: b });
        const copies = p.assembly?.instances.map((i) => i.copy) ?? [];
        expect(copies).toEqual(Array.from({ length: Math.min(a, b) }, (_, c) => c));
      }),
    );
  });
});

describe('setAssemblySheet (T389)', () => {
  it('on adds the flag (valid project); off with nothing placed restores the project', () => {
    const p0 = load();
    const on = applied(p0, 'setAssemblySheet', { on: true, updatedAt: at });
    expect(on.assembly).toEqual({ instances: [], sheet: true, updatedAt: at });
    expect(projectSchema.safeParse(on).success).toBe(true);
    const off = applied(on, 'setAssemblySheet', { on: false, updatedAt: at });
    expect(off).toEqual(p0);
  });
  it('off keeps placed copies; reset all keeps the flag', () => {
    let p = applied(load(), 'setAssemblyInstances', {
      instances: [inst('door-left', 0)],
      updatedAt: at,
    });
    p = applied(p, 'setAssemblySheet', { on: true, updatedAt: at });
    p = applied(p, 'resetAssembly', { updatedAt: at });
    expect(p.assembly).toEqual({ instances: [], sheet: true, updatedAt: at });
    p = applied(p, 'setAssemblyInstances', { instances: [inst('door-left', 0)], updatedAt: at });
    p = applied(p, 'setAssemblySheet', { on: false, updatedAt: at });
    expect(p.assembly?.sheet).toBeUndefined();
    expect(p.assembly?.instances).toHaveLength(1);
  });
  it('one undo step', () => {
    const stack = new CommandStack(load());
    const before = stack.project;
    expect(stack.execute('setAssemblySheet', { on: true, updatedAt: at }, user).ok).toBe(true);
    stack.undo();
    expect(stack.project).toEqual(before);
  });
});
