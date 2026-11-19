import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCommand, CommandStack } from '../commands';
import { parseProject } from '../schema';
import fixture from '../schema/__fixtures__/shelf-set.json';
import {
  cabinetFrontView,
  cabinetParamsSchema,
  cabinetParts,
  cabinetPartsForStock,
  DEFAULT_CABINET,
  type CabinetParams,
  type CabinetPart,
} from './cabinet';

const CTX = { actor: 'user', at: '2026-11-19T10:00:00.000Z' } as const;
const byRole = (parts: CabinetPart[], role: CabinetPart['role']) =>
  parts.find((p) => p.role === role);

function parts(params: CabinetParams): CabinetPart[] {
  const r = cabinetParts(params);
  if (!r.ok) throw new Error(r.error);
  return r.parts;
}

describe('cabinetParts (T122): hand-calculated cabinets', () => {
  it('base unit 600 × 720 × 560, 18 mm, inset back 8, 1 shelf, 1 door gap 3', () => {
    const p = parts(DEFAULT_CABINET);
    expect(p.map((x) => [x.role, x.qty, x.w, x.h])).toEqual([
      ['side', 2, 560, 720],
      ['top', 1, 564, 552],
      ['bottom', 1, 564, 552],
      ['shelf', 1, 564, 552],
      ['back', 1, 564, 720],
      ['door', 1, 594, 714],
    ]);
  });

  it('tall unit 800 × 2000 × 600, overlay back 4, 4 shelves, 2 doors gap 2, plinth 100', () => {
    const p = parts({
      ...DEFAULT_CABINET,
      width: 800,
      height: 2000,
      depth: 600,
      back: { mode: 'overlay', thickness: 4 },
      shelves: 4,
      doors: 2,
      doorGap: 2,
      plinth: 100,
    });
    expect(p.map((x) => [x.role, x.qty, x.w, x.h])).toEqual([
      ['side', 2, 596, 2000],
      ['top', 1, 764, 596],
      ['bottom', 1, 764, 596],
      ['shelf', 4, 764, 596],
      ['back', 1, 800, 2000],
      ['door', 2, 397, 1896],
      ['plinth', 1, 764, 100],
    ]);
  });

  it('open shelf 450 × 900 × 300, 16 mm, no back, no doors, no band', () => {
    const p = parts({
      ...DEFAULT_CABINET,
      width: 450,
      height: 900,
      depth: 300,
      thickness: 16,
      back: { mode: 'none', thickness: 8 },
      shelves: 2,
      doors: 0,
      band: 0,
    });
    expect(p.map((x) => [x.role, x.qty, x.w, x.h])).toEqual([
      ['side', 2, 300, 900],
      ['top', 1, 418, 300],
      ['bottom', 1, 418, 300],
      ['shelf', 2, 418, 300],
    ]);
    for (const x of p) expect(x.edgeBand).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('grain: sides and doors vertical, the rest along the width, back free; band defaults', () => {
    const p = parts(DEFAULT_CABINET);
    expect(byRole(p, 'side')?.grain).toEqual({ mode: 'fixed', angle: 90 });
    expect(byRole(p, 'door')?.grain).toEqual({ mode: 'fixed', angle: 90 });
    expect(byRole(p, 'top')?.grain).toEqual({ mode: 'fixed', angle: 0 });
    expect(byRole(p, 'back')?.grain.mode).toBe('free');
    expect(byRole(p, 'door')?.edgeBand).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
    expect(byRole(p, 'side')?.edgeBand).toEqual({ top: 0, right: 0, bottom: 0, left: 1 });
    expect(byRole(p, 'back')?.edgeBand).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('reports impossible boxes instead of negative parts', () => {
    expect(cabinetParts({ ...DEFAULT_CABINET, width: 30 })).toEqual({
      ok: false,
      error: 'tooNarrow',
    });
    expect(cabinetParts({ ...DEFAULT_CABINET, height: 120, plinth: 100 })).toEqual({
      ok: false,
      error: 'tooLow',
    });
    expect(
      cabinetParts({ ...DEFAULT_CABINET, depth: 8, back: { mode: 'inset', thickness: 8 } }),
    ).toEqual({ ok: false, error: 'tooShallow' });
    expect(
      cabinetParts({ ...DEFAULT_CABINET, width: 40, thickness: 5, doors: 2, doorGap: 20 }),
    ).toEqual({ ok: false, error: 'doorsTooSmall' });
  });
});

const arbParams = fc.record({
  width: fc.integer({ min: 100, max: 2400 }),
  height: fc.integer({ min: 200, max: 2400 }),
  depth: fc.integer({ min: 100, max: 900 }),
  thickness: fc.constantFrom(8, 12, 16, 18, 25),
  back: fc.record({
    mode: fc.constantFrom('none' as const, 'inset' as const, 'overlay' as const),
    thickness: fc.constantFrom(3, 4, 8),
  }),
  shelves: fc.integer({ min: 0, max: 6 }),
  doors: fc.constantFrom(0 as const, 1 as const, 2 as const),
  doorGap: fc.integer({ min: 0, max: 5 }),
  plinth: fc.constantFrom(0, 80, 100),
  band: fc.constantFrom(0, 0.4, 1, 2),
});

describe('cabinetParts properties', () => {
  it('every part is positive; dimensions add up across the width, height and doors', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        cabinetParamsSchema.parse(params);
        const r = cabinetParts(params);
        if (!r.ok) return;
        const { width: W, height: H, thickness: t, doorGap: g, plinth: p } = params;
        for (const x of r.parts) {
          expect(x.w).toBeGreaterThan(0);
          expect(x.h).toBeGreaterThan(0);
          expect(x.qty).toBeGreaterThanOrEqual(1);
        }
        const top = byRole(r.parts, 'top');
        // Two sides + the top between them = the outside width.
        expect((top?.w ?? 0) + 2 * t).toBeCloseTo(W, 6);
        const door = byRole(r.parts, 'door');
        if (door) {
          // Doors + gaps = the outside width; door height + 2 gaps = the height above the plinth.
          expect(door.qty * door.w + (door.qty + 1) * g).toBeCloseTo(W, 1);
          expect(door.h + 2 * g).toBeCloseTo(H - p, 6);
        }
        const shelf = byRole(r.parts, 'shelf');
        expect(shelf?.qty ?? 0).toBe(params.shelves);
        expect(cabinetFrontView(params).length).toBeGreaterThan(0);
      }),
    );
  });
});

describe('generated rows in a project (D-041)', () => {
  it('one importCutList = one undo step; rows are independent afterwards', () => {
    const parsed = parseProject(fixture);
    if (!parsed.ok) throw new Error('fixture');
    const before = parsed.project;
    const rows = parts(DEFAULT_CABINET).map((x, i) => ({
      id: `cab-${i}`,
      name: x.role,
      qty: x.qty,
      group: 'Dolap 1',
      grain: x.grain,
      params: { w: x.w, h: x.h, r: 0 },
      edgeBand: x.edgeBand,
    }));
    const stack = new CommandStack(before);
    const r = stack.execute('importCutList', { parts: rows }, CTX);
    if (!r.ok) throw new Error(r.error.message);
    const after = stack.project;
    expect(after.parts.filter((p) => p.group === 'Dolap 1')).toHaveLength(rows.length);
    // Edit one, delete one: the others do not change.
    const edited = applyCommand(after, 'updatePart', {
      id: 'cab-1',
      params: { w: 500 },
      group: '',
    });
    if (!edited.ok) throw new Error(edited.error.message);
    const removed = applyCommand(edited.project, 'removePart', { id: 'cab-2' });
    if (!removed.ok) throw new Error(removed.error.message);
    const untouched = (id: string) => [
      after.parts.find((p) => p.id === id),
      removed.project.parts.find((p) => p.id === id),
    ];
    for (const id of ['cab-0', 'cab-3', 'cab-4', 'cab-5']) {
      const [a, b] = untouched(id);
      expect(b).toEqual(a);
    }
    expect(removed.project.parts.find((p) => p.id === 'cab-1')?.group).toBeUndefined();
    stack.undo();
    expect(stack.project).toEqual(before);
  });
});

describe('cabinetPartsForStock (T260, D-045)', () => {
  const two = { ...DEFAULT_CABINET, shelves: 2 };
  const parts = (() => {
    const r = cabinetParts(two);
    if (!r.ok) throw new Error('cabinet');
    return r.parts;
  })();
  const count = (ps: readonly { qty: number }[]) => ps.reduce((s, p) => s + p.qty, 0);

  it('gives every part its board thickness (the back its own)', () => {
    for (const p of parts) expect(p.thickness).toBe(p.role === 'back' ? 8 : 18);
  });

  it('leaves the 8 mm back out of an 18 mm list unless asked for', () => {
    const split = cabinetPartsForStock(parts, { thickness: 18, hasGrain: true });
    expect(count(split.rows)).toBe(7);
    expect(split.rows.some((p) => p.role === 'back')).toBe(false);
    expect(split.other.map((p) => p.role)).toEqual(['back']);
    const all = cabinetPartsForStock(parts, { thickness: 18, hasGrain: true }, true);
    expect(count(all.rows)).toBe(8);
  });

  it('keeps the back when it is the stock thickness', () => {
    const same = cabinetParts({ ...two, back: { mode: 'inset', thickness: 18 } });
    if (!same.ok) throw new Error('cabinet');
    const split = cabinetPartsForStock(same.parts, { thickness: 18, hasGrain: true });
    expect(split.other).toEqual([]);
    expect(count(split.rows)).toBe(8);
  });

  it('frees the grain on a stock without grain, keeps it otherwise', () => {
    const free = cabinetPartsForStock(parts, { thickness: 18, hasGrain: false }, true);
    for (const p of free.rows) expect(p.grain.mode).toBe('free');
    const fixed = cabinetPartsForStock(parts, { thickness: 18, hasGrain: true });
    expect(fixed.rows.find((p) => p.role === 'side')?.grain).toEqual({ mode: 'fixed', angle: 90 });
  });

  it('is pure: the input parts are not changed', () => {
    const before = structuredClone(parts);
    cabinetPartsForStock(parts, { thickness: 18, hasGrain: false }, true);
    expect(parts).toEqual(before);
  });
});
