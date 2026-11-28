import { describe, expect, it } from 'vitest';
import { parseProject } from '../schema';
import { projectOf } from '../toolpath/toolpath.testing';
import { CommandStack } from './index';

// T348 (§3.6 "İşlenen yüz"): optional stock.machinedFace, undoable command, ACM defaults to back.

const at = { actor: 'user' as const, at: '2026-11-28T00:00:00.000Z' };

function stack() {
  return new CommandStack(projectOf({ parts: [{ id: 'a', w: 100, h: 50, qty: 1 }] }));
}

describe('machined face (T348)', () => {
  it('setMachinedFace back / front, one undo step each; front is stored as absent', () => {
    const s = stack();
    expect(s.execute('setMachinedFace', { face: 'back' }, at).ok).toBe(true);
    expect(s.project.stock.machinedFace).toBe('back');
    expect(s.execute('setMachinedFace', { face: 'front' }, at).ok).toBe(true);
    expect('machinedFace' in s.project.stock).toBe(false);
    s.undo();
    expect(s.project.stock.machinedFace).toBe('back');
  });

  it('picking ACM sets back; going back to MDF drops it; wood never gains the field', () => {
    const s = stack();
    s.execute('setMaterial', { material: 'kontrplak' }, at);
    expect('machinedFace' in s.project.stock).toBe(false);
    s.execute('setMaterial', { material: 'acm' }, at);
    expect(s.project.stock.machinedFace).toBe('back');
    s.execute('setMaterial', { material: 'mdf' }, at);
    expect('machinedFace' in s.project.stock).toBe(false);
    s.undo();
    expect(s.project.stock.machinedFace).toBe('back');
  });

  it('schema accepts front/back, refuses others; old projects parse without it', () => {
    const p = projectOf({ parts: [{ id: 'a', w: 100, h: 50, qty: 1 }] });
    expect(parseProject(p).ok).toBe(true);
    expect(parseProject({ ...p, stock: { ...p.stock, machinedFace: 'back' } }).ok).toBe(true);
    expect(parseProject({ ...p, stock: { ...p.stock, machinedFace: 'top' } }).ok).toBe(false);
  });

  it('a face change turns the stored layout over with the sheet; undo restores it', () => {
    const s = new CommandStack(
      projectOf({
        parts: [{ id: 'a', w: 100, h: 50, qty: 1 }],
        placements: [[{ partId: 'a', index: 0, x: 20, y: 30, rot: 90 }]],
      }),
    );
    const before = s.project.layout;
    expect(s.execute('setMachinedFace', { face: 'back' }, at).ok).toBe(true);
    // 90° turned, the part is 50 wide: x = 2440 − 20 − 50.
    expect(s.project.layout.sheets[0]?.placements[0]).toMatchObject({ x: 2370, y: 30, rot: 270 });
    // Same face again: nothing changes.
    expect(s.execute('setMachinedFace', { face: 'back' }, at).ok).toBe(true);
    expect(s.project.layout.sheets[0]?.placements[0]).toMatchObject({ x: 2370, rot: 270 });
    s.undo();
    s.undo();
    expect(s.project.layout).toEqual(before);
  });
});
