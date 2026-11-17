import { defaultMachineProfile } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import { FORM_SECTIONS, isDirty, parseErrorText } from './machine-form';

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
