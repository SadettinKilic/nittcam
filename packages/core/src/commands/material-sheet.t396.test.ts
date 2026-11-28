import { describe, expect, it } from 'vitest';
import { traitsOf } from '../machine/material-traits';
import { projectOf } from '../toolpath/toolpath.testing';
import { CommandStack, kindSheetDefault, kindThicknessDefault } from './index';

// T396 (CTO #14 P2): a material change takes the new kind's first sheet preset when the kind has
// other presets and the current sheet is not one of them; one undo step with the material.

const at = { actor: 'user' as const, at: '2026-11-28T00:00:00.000Z' };
const stack = () => new CommandStack(projectOf({ parts: [{ id: 'a', w: 100, h: 50, qty: 1 }] }));
const sheet = (s: CommandStack) => ({
  width: s.project.stock.sheet.width,
  height: s.project.stock.sheet.height,
});

describe('setMaterial takes the kind sheet (T396)', () => {
  it('MDF → ACM: the first ACM preset (long side on X); Ctrl+Z restores material and sheet', () => {
    const s = stack();
    s.execute('setSheetSize', { width: 2800, height: 2070 }, at);
    const before = { material: s.project.stock.material, ...sheet(s) };
    const first = traitsOf('acm').sheetPresets[0];
    if (!first) throw new Error('no ACM preset');
    expect(s.execute('setMaterial', { material: 'acm' }, at).ok).toBe(true);
    expect(sheet(s)).toEqual({ width: first.b, height: first.a });
    s.undo();
    expect({ material: s.project.stock.material, ...sheet(s) }).toEqual(before);
  });

  it('keeps a sheet that is already a preset of the new kind, and within one preset family', () => {
    const s = stack();
    s.execute('setMaterial', { material: 'acm' }, at);
    const acm2 = traitsOf('acm').sheetPresets[1];
    if (!acm2) throw new Error('no 2nd ACM preset');
    s.execute('setSheetSize', { width: acm2.b, height: acm2.a }, at);
    expect(kindSheetDefault(s.project, 'acm')).toBeNull();
    // wood → wood (same presets): a custom size stays
    const w = stack();
    w.execute('setSheetSize', { width: 2500, height: 1250 }, at);
    w.execute('setMaterial', { material: 'kontrplak' }, at);
    expect(sheet(w)).toEqual({ width: 2500, height: 1250 });
  });

  it('ACM → MDF goes back to a wood preset; aluminium takes its own', () => {
    const s = stack();
    s.execute('setMaterial', { material: 'acm' }, at);
    s.execute('setMaterial', { material: 'mdf' }, at);
    const wood = traitsOf('mdf').sheetPresets[0];
    expect(sheet(s)).toEqual({ width: wood?.b, height: wood?.a });
    s.execute('setMaterial', { material: 'aluminium' }, at);
    const alu = traitsOf('aluminium').sheetPresets[0];
    expect(sheet(s)).toEqual({ width: alu?.b, height: alu?.a });
  });
});

describe('setMaterial takes the kind thickness (T396, PO)', () => {
  it('MDF 18 → ACM: 4 mm; MDF 18 → aluminium: 1,5 mm; ACM 4 → aluminium keeps 4 (a preset)', () => {
    const s = stack();
    s.execute('setThickness', { thickness: 18 }, at);
    s.execute('setMaterial', { material: 'acm' }, at);
    expect(s.project.stock.thickness).toBe(4);
    s.execute('setMaterial', { material: 'aluminium' }, at);
    expect(s.project.stock.thickness).toBe(4);
    // one undo step each, sheet and thickness with the material
    s.undo();
    s.undo();
    expect(s.project.stock.thickness).toBe(18);
    expect(s.project.stock.material).not.toBe('acm');
    s.execute('setMaterial', { material: 'aluminium' }, at);
    expect(s.project.stock.thickness).toBe(1.5);
  });

  it('keeps a thickness that is a preset of the new kind, within a family, and for wood', () => {
    const s = stack();
    s.execute('setThickness', { thickness: 6 }, at);
    expect(kindThicknessDefault(s.project, 'acm')).toBeNull();
    s.execute('setMaterial', { material: 'acm' }, at);
    expect(s.project.stock.thickness).toBe(6);
    // ACM → MDF: wood has no thickness presets, the thickness is kept
    s.execute('setMaterial', { material: 'mdf' }, at);
    expect(s.project.stock.thickness).toBe(6);
    // wood → wood
    s.execute('setThickness', { thickness: 18 }, at);
    s.execute('setMaterial', { material: 'kontrplak' }, at);
    expect(s.project.stock.thickness).toBe(18);
  });
});
