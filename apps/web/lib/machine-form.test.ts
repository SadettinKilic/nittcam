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
  refreshStartingValues,
  startingNote,
  suitingTool,
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
      field: null,
    });
  });

  it('T302: carries "land on the tab fields" (alan=kopru)', () => {
    const href = paramFixHref({
      machineId: 'm1',
      set: { material: 'mdf', thickness: 18 },
      returnTo: null,
      field: 'tabs',
    });
    expect(href).toContain('alan=kopru');
    const q = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(parseParamFix(q)?.field).toBe('tabs');
    expect(parseParamFix({ duzenle: 'm', alan: 'x' })?.field).toBeNull();
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
    // T328: acrylic with the first tool (Ø6 two-flute): the table's 0,5 × D = 3 mm start.
    expect(row).toMatchObject({ material: 'acrylic', thickness: 5, stepDown: 3, unverified: true });
    expect(machineProfileSchema.safeParse(acrylic.profile).success).toBe(true);
    // never a pass deeper than the sheet
    expect(newParamSet(p, 'mdf', 18).stepDown).toBe(6);
    expect(newParamSet(p, 'mdf', 3).stepDown).toBe(3);
    // T328: the form's own "Ekle" starts from the table too, and is marked the same way
    expect(newParamSet(p).unverified).toBe(true);
    // seeded sets (and D-046 copied ones) are untouched
    expect(acrylic.profile.materials.slice(0, acrylic.index)).toEqual(p.materials);
  });
});

describe('T328: new cutting sets start from the built-in table (D-120)', () => {
  const p = defaultMachineProfile(); // tools: 1 = Ø6 two-flute, 2 = Ø8 two-flute
  const values = (m: { feed: number; plungeFeed: number; rpm: number; stepDown: number }) => [
    m.feed,
    m.plungeFeed,
    m.rpm,
    m.stepDown,
  ];

  it('every kind × Ø6 / Ø8: table values or empty fields, always unverified', () => {
    const expected: Record<string, [number[] | null, number[] | null]> = {
      mdf: [
        [5400, 1300, 18000, 6],
        [6000, 1500, 18000, 6],
      ],
      plywood: [
        [4700, 1100, 18000, 6],
        [5000, 1200, 18000, 6],
      ],
      // no two-flute Ø6 spiral row for melamine in the research; Ø8 = "no compression" row
      melamine: [null, [5000, 1200, 18000, 6]],
      solidWood: [
        [3600, 900, 18000, 3],
        [4300, 1000, 18000, 4],
      ],
      // PO B61: plastics plunge 0,25 × feed (down to the 100).
      acrylic: [
        [4300, 1000, 18000, 3],
        [5000, 1200, 18000, 4],
      ],
      pvc: [
        [4300, 1000, 18000, 3],
        [5000, 1200, 18000, 4],
      ],
    };
    for (const [kind, [six, eight]] of Object.entries(expected)) {
      for (const [tool, want] of [
        [1, six],
        [2, eight],
      ] as const) {
        const prof = { ...p, tools: p.tools.filter((t) => t.number === tool) };
        const set = newParamSet(prof, kind as never, 18);
        expect(set.unverified).toBe(true);
        expect(set.tool).toBe(tool);
        if (want) expect(values(set)).toEqual(want);
        else expect(values(set).every((v) => Number.isNaN(v))).toBe(true);
        const note = startingNote(prof, set);
        expect(note.kind).toBe(want ? 'table' : 'none');
      }
    }
  });

  it('MDF 18 with the Ø8 tool equals the frozen default set', () => {
    const set = newParamSet({ ...p, tools: [p.tools[1] as never] }, 'mdf', 18);
    expect(values(set)).toEqual(values(p.materials[0] as never));
  });

  it('kind, thickness or tool changes refresh an untouched row; an edited row keeps its numbers', () => {
    const set = newParamSet(p, 'mdf', 18);
    set.material = 'solidWood';
    refreshStartingValues(p, set);
    expect(values(set)).toEqual([3600, 900, 18000, 3]);
    set.tool = 2;
    refreshStartingValues(p, set);
    expect(values(set)).toEqual([4300, 1000, 18000, 4]);
    set.thickness = 2;
    refreshStartingValues(p, set);
    expect(set.stepDown).toBe(2);
    expect(set.unverified).toBe(true);
    // a manual edit drops the mark (the form does that); later choices do not overwrite
    set.feed = 3333;
    delete set.unverified;
    set.material = 'mdf';
    refreshStartingValues(p, set);
    expect(set.feed).toBe(3333);
  });

  it('no table row: empty fields that the schema rejects until filled, never old fixed numbers', () => {
    const odd = {
      ...p,
      tools: [{ number: 1, type: 'vBit', diameter: 8, fluteLength: 10, flutes: 2 }],
    };
    const set = newParamSet(odd as never, 'mdf', 18);
    expect(values(set).every((v) => Number.isNaN(v))).toBe(true);
    expect(startingNote(odd as never, set)).toEqual({ kind: 'none', hint: null });
    const prof = { ...p, materials: [...p.materials, set] };
    expect(machineProfileSchema.safeParse(prof).success).toBe(false);
  });

  it('notes and tool hints: a hint, never a block; source names come from the row', () => {
    const mel = newParamSet({ ...p, tools: [p.tools[1] as never] }, 'melamine', 18);
    const n = startingNote({ ...p, tools: [p.tools[1] as never] }, mel);
    expect(n).toEqual({
      kind: 'table',
      sources: 'Freud, Rennie Tool',
      note: 'melamineNoCompression',
      hint: 'melamineCompression',
    });
    const acr = newParamSet(p, 'acrylic', 10);
    expect(startingNote(p, acr)).toMatchObject({
      note: 'acrylicPlastic',
      hint: 'plasticSingleFlute',
    });
    expect(machineProfileSchema.safeParse({ ...p, materials: [...p.materials, acr] }).success).toBe(
      true,
    );
    // edited numbers: the note no longer claims the table as the source
    acr.feed = 4000;
    expect(startingNote(p, acr).kind).toBe('other');
    for (const key of ['startingValue', 'startingNone'] as const) {
      expect(tr.machines.form[key].length).toBeGreaterThan(0);
    }
    expect(tr.machines.form.startingValue).toContain('doğrulanmadı, önce deneme kesimi');
    expect(tr.machines.form.startingNone).toContain('Bu malzeme için hazır değer yok');
  });
});

describe('PO B61: a new set takes the first tool that suits the material', () => {
  const p = defaultMachineProfile();
  const tools = [
    { number: 1, type: 'flatEndMill', diameter: 8, fluteLength: 25, flutes: 2 },
    { number: 2, type: 'flatEndMill', diameter: 6, fluteLength: 22, flutes: 1 },
    { number: 3, type: 'compression', diameter: 8, fluteLength: 25, flutes: 2 },
  ] as const;
  const prof = { ...p, tools: tools.map((t) => ({ ...t })) };

  it('single-flute for plastics, compression for melamine, first tool for wood', () => {
    expect(suitingTool(prof, 'acrylic', 10)).toBe(2);
    expect(suitingTool(prof, 'pvc', 10)).toBe(2);
    expect(suitingTool(prof, 'melamine', 18)).toBe(3);
    expect(suitingTool(prof, 'mdf', 18)).toBe(1);
    const acr = newParamSet(prof, 'acrylic', 10);
    expect(acr.tool).toBe(2);
    expect(startingNote(prof, acr)).toMatchObject({ kind: 'table', hint: null });
    expect(
      withParamSet(prof as never, { material: 'melamine', thickness: 16 }).profile.materials.at(-1)
        ?.tool,
    ).toBe(3);
  });

  it('none suits: the first tool with a table row (filled, with the hint)', () => {
    // The example machine (T1 Ø6, T2 Ø8 two-flute spirals): melamine has a row only for Ø8.
    expect(p.tools.map((t) => [t.number, t.diameter, t.flutes])).toEqual([
      [1, 6, 2],
      [2, 8, 2],
    ]);
    expect(suitingTool(p, 'melamine', 18)).toBe(2);
    const mel = newParamSet(p, 'melamine', 18);
    expect(mel).toMatchObject({ tool: 2, feed: 5000, plungeFeed: 1200, rpm: 18000, stepDown: 6 });
    expect(startingNote(p, mel)).toMatchObject({ kind: 'table', hint: 'melamineCompression' });
    // A ballEndMill first, a spiral later: the spiral with the row comes first.
    const ball = {
      ...p,
      tools: [
        { number: 5, type: 'ballEndMill', diameter: 6, fluteLength: 20, flutes: 2 },
        ...p.tools,
      ],
    };
    expect(suitingTool(ball as never, 'mdf', 18)).toBe(1);
  });

  it('no tool has a row: the first tool, empty fields', () => {
    const only = {
      ...p,
      tools: [{ number: 4, type: 'vBit', diameter: 6, fluteLength: 10, flutes: 2 }],
    };
    expect(suitingTool(only as never, 'mdf', 18)).toBe(4);
    const set = newParamSet(only as never, 'mdf', 18);
    expect(set.tool).toBe(4);
    expect(Number.isNaN(set.feed)).toBe(true);
  });

  it('none suits: the first tool, with the hint', () => {
    // the default profile has only two-flute spirals
    const acr = newParamSet(p, 'acrylic', 10);
    expect(acr.tool).toBe(1);
    expect(startingNote(p, acr)).toMatchObject({ hint: 'plasticSingleFlute' });
  });
});
