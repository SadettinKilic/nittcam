/** Cut-list grid commands (T118 note, T119 bulk edit and row actions). */
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
