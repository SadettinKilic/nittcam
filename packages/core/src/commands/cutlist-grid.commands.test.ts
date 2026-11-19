/** Cut-list grid commands (T118 note, T119 bulk edit and row actions). */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import { parseProject, projectSchema, type Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const ctx: CommandContext = { actor: 'user', at: '2026-11-19T10:00:00Z' };

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

describe('part note (T118)', () => {
  it('updatePart sets and clears the note; the project stays valid', () => {
    const start = load();
    const id = start.parts[0]?.id ?? '';
    const withNote = run(start, 'updatePart', { id, note: 'Beyaz melamin' });
    expect(withNote.parts[0]?.note).toBe('Beyaz melamin');
    expect(projectSchema.safeParse(withNote).success).toBe(true);
    const cleared = run(withNote, 'updatePart', { id, note: '' });
    expect(cleared.parts[0]).not.toHaveProperty('note');
    expect(cleared).toEqual(start);
  });

  it('rejects a note longer than 200 characters', () => {
    const start = load();
    const id = start.parts[0]?.id ?? '';
    expect(applyCommand(start, 'updatePart', { id, note: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('addPart and importCutList keep a note, drop an empty one', () => {
    const start = load();
    const p1 = run(start, 'addPart', {
      id: 'n1',
      note: 'Kapak',
      params: { w: 100, h: 200, r: 0 },
    });
    expect(p1.parts.at(-1)?.note).toBe('Kapak');
    const p2 = run(start, 'importCutList', {
      parts: [{ id: 'n2', note: '', params: { w: 100, h: 200, r: 0 } }],
    });
    expect(p2.parts.at(-1)).not.toHaveProperty('note');
  });

  it('a note edit is one undo step', () => {
    const stack = new CommandStack(load());
    const id = stack.project.parts[0]?.id ?? '';
    const before = stack.project;
    expect(stack.execute('updatePart', { id, note: 'a' }, ctx).ok).toBe(true);
    stack.undo();
    expect(stack.project).toEqual(before);
  });
});

/** n simple rect parts p1..pn. */
function withParts(n: number): Project {
  let p = load();
  p = { ...p, parts: [], layout: { ...p.layout, sheets: [] } };
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `P${i + 1}`,
    qty: 1,
    params: { w: 100 + i, h: 200, r: 0 },
  }));
  return run(p, 'importCutList', { parts: rows });
}

const ids = (p: Project) => p.parts.map((x) => x.id);

describe('updateParts (T119)', () => {
  it('sets qty, grain, chosen edges and a name prefix on the selection only', () => {
    const start = withParts(4);
    const next = run(start, 'updateParts', {
      ids: ['p2', 'p3'],
      qty: 5,
      grain: { mode: 'fixed', angle: 90 },
      edgeBand: { top: 0.8, left: 2 },
      namePrefix: 'Mutfak ',
    });
    for (const id of ['p2', 'p3']) {
      const part = next.parts.find((x) => x.id === id);
      expect(part?.qty).toBe(5);
      expect(part?.grain).toEqual({ mode: 'fixed', angle: 90 });
      expect(part?.edgeBand).toEqual({ top: 0.8, right: 0, bottom: 0, left: 2 });
      expect(part?.name.startsWith('Mutfak P')).toBe(true);
    }
    expect(next.parts[0]).toEqual(start.parts[0]);
    expect(next.parts[3]).toEqual(start.parts[3]);
  });

  it('bulk edit of 50 rows is one undo step', () => {
    const stack = new CommandStack(withParts(60));
    const before = stack.project;
    const sel = before.parts.slice(0, 50).map((x) => x.id);
    expect(stack.execute('updateParts', { ids: sel, qty: 3 }, ctx).ok).toBe(true);
    expect(stack.project.parts.slice(0, 50).every((x) => x.qty === 3)).toBe(true);
    stack.undo();
    expect(stack.project).toEqual(before);
  });

  it('rejects an empty change, unknown and repeated ids', () => {
    const start = withParts(2);
    expect(applyCommand(start, 'updateParts', { ids: ['p1'] }).ok).toBe(false);
    expect(applyCommand(start, 'updateParts', { ids: ['p1'], edgeBand: {} }).ok).toBe(false);
    expect(applyCommand(start, 'updateParts', { ids: ['nope'], qty: 2 }).ok).toBe(false);
    expect(applyCommand(start, 'updateParts', { ids: ['p1', 'p1'], qty: 2 }).ok).toBe(false);
  });
});

describe('duplicateParts and reorderParts (T119)', () => {
  it('each copy goes right after its original', () => {
    const next = run(withParts(4), 'duplicateParts', { ids: ['p1', 'p3'], newIds: ['c1', 'c3'] });
    expect(ids(next)).toEqual(['p1', 'c1', 'p2', 'p3', 'c3', 'p4']);
    expect(next.parts[1]?.name).toBe('P1');
    expect(applyCommand(withParts(2), 'duplicateParts', { ids: ['p1'], newIds: ['p2'] }).ok).toBe(
      false,
    );
  });

  it('moves a selection up or down as a block; edges stay', () => {
    const start = withParts(5);
    expect(ids(run(start, 'reorderParts', { ids: ['p3', 'p4'], direction: 'up' }))).toEqual([
      'p1',
      'p3',
      'p4',
      'p2',
      'p5',
    ]);
    expect(ids(run(start, 'reorderParts', { ids: ['p2', 'p3'], direction: 'down' }))).toEqual([
      'p1',
      'p4',
      'p2',
      'p3',
      'p5',
    ]);
    expect(ids(run(start, 'reorderParts', { ids: ['p1'], direction: 'up' }))).toEqual(ids(start));
    expect(ids(run(start, 'reorderParts', { ids: ['p5'], direction: 'down' }))).toEqual(ids(start));
  });

  it('property: reorder keeps the same parts; up then down restores a single row', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), fc.nat(), (n, k) => {
        const start = withParts(n);
        const id = `p${(k % (n - 2 || 1)) + 2}`;
        const moved = run(start, 'reorderParts', { ids: [id], direction: 'up' });
        expect([...ids(moved)].sort()).toEqual([...ids(start)].sort());
        if (id !== 'p1' && n > 2) {
          expect(run(moved, 'reorderParts', { ids: [id], direction: 'down' })).toEqual(start);
        }
      }),
      { numRuns: 50 },
    );
  });
});
