import { defaultMachineProfile, exampleMachineProfile, machineProfileSchema } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import {
  FORM_SECTIONS,
  isDirty,
  newParamSet,
  paramFixHref,
  parseErrorText,
  parseParamFix,
  safeReturnPath,
  withParamSet,
} from './machine-form';

describe('machine form helpers (T107)', () => {
  it('lists the sections of spec §7.1 in order, each with a title and hint', () => {
    expect(FORM_SECTIONS[0]).toBe('identity');
    expect(FORM_SECTIONS.at(-1)).toBe('materials');
    for (const id of FORM_SECTIONS) {
      expect(tr.machines.form.sections[id].length).toBeGreaterThan(0);
      expect(tr.machines.form.sectionHints[id].length).toBeGreaterThan(0);
    }
  });

  it('is clean for an untouched copy and for reordered keys', () => {
    const a = defaultMachineProfile();
    const b = structuredClone(a);
    expect(isDirty(a, b)).toBe(false);
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as typeof b;
    expect(isDirty(a, reordered)).toBe(false);
  });

  it('is dirty after any value change, and clean again when it is undone', () => {
    const a = defaultMachineProfile();
    const b = structuredClone(a);
    b.table.width += 1;
    expect(isDirty(a, b)).toBe(true);
    b.table.width -= 1;
    expect(isDirty(a, b)).toBe(false);
    const c = structuredClone(a);
    c.tools.push({ number: 9, type: 'drill', diameter: 5, fluteLength: 20, flutes: 2 });
    expect(isDirty(a, c)).toBe(true);
  });

  it('maps number parse errors to Turkish text', () => {
    const e = tr.machines.errors;
    expect(parseErrorText('empty', e)).toBe(e.required);
    expect(parseErrorText('invalid', e)).toBe(e.number);
    expect(parseErrorText('max', e)).toBe(e.number);
  });
});

describe('"Kesim ayarı ekle" link (T258, D-045)', () => {
  it('round-trips machine, set and return path through the query', () => {
    const href = paramFixHref({
      machineId: 'm1',
      set: { material: 'melamine', thickness: 18 },
      returnTo: '/projeler/p1?adim=makine&profil=son',
    });
    expect(href.startsWith('/makineler?')).toBe(true);
    const q = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(parseParamFix(q)).toEqual({
      machineId: 'm1',
      set: { material: 'melamine', thickness: 18 },
      returnTo: '/projeler/p1?adim=makine&profil=son',
    });
  });

  it('keeps decimal thicknesses and drops unknown kinds', () => {
    expect(parseParamFix({ duzenle: 'm', ayar: 'acrylic-4.5' })?.set).toEqual({
      material: 'acrylic',
      thickness: 4.5,
    });
    expect(parseParamFix({ duzenle: 'm', ayar: 'granite-20' })?.set).toBeNull();
    expect(parseParamFix({ ayar: 'mdf-18' })).toBeNull();
  });

  it('accepts only same-origin return paths', () => {
    expect(safeReturnPath('/projeler/1?adim=makine')).toBe('/projeler/1?adim=makine');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil', 'projeler', '', null])
      expect(safeReturnPath(bad)).toBeNull();
  });

  it('appends a new set once, or points at the existing one', () => {
    const p = defaultMachineProfile();
    const before = p.materials.length;
    const added = withParamSet(p, { material: 'acrylic', thickness: 7 });
    expect(added.added).toBe(true);
    expect(added.index).toBe(before);
    expect(added.profile.materials[before]).toMatchObject({ material: 'acrylic', thickness: 7 });
    expect(p.materials.length).toBe(before);
    const again = withParamSet(added.profile, { material: 'acrylic', thickness: 7 });
    expect(again).toEqual({ profile: added.profile, index: before, added: false });
  });

  it('T265: the fix flow set is marked as starting values and its step-down fits the sheet', () => {
    const p = exampleMachineProfile();
    const acrylic = withParamSet(p, { material: 'acrylic', thickness: 5 });
    const row = acrylic.profile.materials[acrylic.index];
    expect(row).toMatchObject({ material: 'acrylic', thickness: 5, stepDown: 5, unverified: true });
    expect(machineProfileSchema.safeParse(acrylic.profile).success).toBe(true);
    // thick sheets keep the generic 6 mm start; thin ones never get a pass deeper than the sheet
    expect(newParamSet(p, 'mdf', 18).stepDown).toBe(6);
    expect(newParamSet(p, 'pvc', 3).stepDown).toBe(3);
    // the form's own "Satır ekle" is not the fix flow: no mark
    expect(newParamSet(p).unverified).toBeUndefined();
    // seeded sets (and D-046 copied ones) are untouched
    expect(acrylic.profile.materials.slice(0, acrylic.index)).toEqual(p.materials);
  });
});
