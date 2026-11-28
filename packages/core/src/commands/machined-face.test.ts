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
});
