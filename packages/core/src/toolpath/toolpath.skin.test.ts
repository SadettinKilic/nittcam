/**
 * T143: thin skin for small parts ("son pasoda ince tabaka bırak"). Small parts stop the skin
 * thickness above the material bottom, no tabs; a cleanup pass per skinned part cuts the skin
 * through as the last operations of its sheet. An all-arc small part (a disc, sign letter "O")
 * that cannot hold tabs is refused with tabs and secured with skin.
 */
import fc from 'fast-check';
import { applyPatches, enablePatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { postConfig } from '../gcode-check/check.testing';
import { exportNc } from '../export';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { clone, machineOf, projectOf } from './toolpath.testing';
import type { Operation } from './types';

enablePatches();

const T = 18;
const SPOIL = 0.3;
const machine = machineOf({ thickness: T, spoilboard: SPOIL });

/** A Ø`d` disc (two half-circle arcs). */
const disc = (d: number) => [
  { x: 0, y: d / 2, bulge: 1 },
  { x: d, y: d / 2, bulge: 1 },
];

/**
 * Parts on sheets: `small` 80 × 80 rectangles, one 600 × 400 large part, optional discs; one
 * sheet per entry of `sheets` (counts of small parts on it).
 */
function project(opts: { sheets: number[]; discs?: number; skin?: number }): Project {
  const placements = opts.sheets.map((n, s) => [
    { partId: 'big', index: s, x: 20, y: 20, rot: 0 },
    ...Array.from({ length: n }, (_, i) => ({
      partId: 's',
      index: opts.sheets.slice(0, s).reduce((a, b) => a + b, 0) + i,
      x: 700 + i * 100,
      y: 20,
      rot: 0,
    })),
    ...(s === 0
      ? Array.from({ length: opts.discs ?? 0 }, (_, i) => ({
          partId: 'o',
          index: i,
          x: 700 + i * 100,
          y: 300,
          rot: 0,
        }))
      : []),
  ]);
  const smallCount = opts.sheets.reduce((a, b) => a + b, 0);
  const base = clone(
    projectOf({
      parts: [
        { id: 'big', w: 600, h: 400, qty: opts.sheets.length },
        ...(smallCount > 0 ? [{ id: 's', w: 80, h: 80, qty: smallCount }] : []),
        ...(opts.discs ? [{ id: 'o', w: 60, h: 60, qty: opts.discs }] : []),
      ],
      placements: placements.map((pls) => pls.filter((p) => p.partId !== 's' || smallCount > 0)),
    }),
  ) as unknown as {
    parts: Record<string, unknown>[];
    cutting: Record<string, unknown>;
  };
  const o = base.parts.find((p) => p['id'] === 'o');
  if (o) {
    o['kind'] = 'freeform';
    delete o['params'];
    o['outline'] = disc(60);
  }
  if (opts.skin !== undefined) base.cutting['skin'] = { thickness: opts.skin };
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

const feedZs = (op: Operation) =>
  op.segments.flatMap((s) => s.moves).flatMap((m) => (m.kind === 'rapid' ? [] : [m.z]));

describe('thin skin (T143)', () => {
  it('a small part keeps a skin (no tabs); its cleanup pass is the last cut of the sheet', () => {
    const res = buildToolpath(project({ sheets: [2], skin: 0.5 }), machine);
    expect(res.errors).toEqual([]);
    const ops = res.toolpath.operations;
    const main = ops.filter((o) => o.partId === 's' && !o.skinCleanup);
    const clean = ops.filter((o) => o.skinCleanup);
    expect(main).toHaveLength(2);
    expect(clean.map((o) => o.id).sort()).toEqual(['s#0/skin', 's#1/skin']);
    for (const m of main) {
      expect(m.tabs).toEqual([]);
      expect(m.passDepths.at(-1)).toBeCloseTo(-(T - 0.5), 9);
      expect(Math.min(...feedZs(m))).toBeCloseTo(-(T - 0.5), 9);
    }
    for (const c of clean) {
      expect(c.passDepths.at(-1)).toBeCloseTo(-(T + SPOIL), 9);
      expect(Math.min(...feedZs(c))).toBeCloseTo(-(T + SPOIL), 9);
      expect(Math.max(...feedZs(c))).toBeLessThanOrEqual(-(T - 0.5) + 1e-9);
      expect(c.tabs).toEqual([]);
      // Goes down in its own kerf: rapid at safe Z, then plunge at plunge feed, no lead.
      const [first, ...rest] = c.segments[0]?.moves ?? [];
      expect(first).toMatchObject({ kind: 'rapid', z: machine.safeZ });
      expect(rest.at(-1)).toMatchObject({ kind: 'plunge', feed: c.plungeFeed });
      expect(c.segments.some((s) => s.role === 'leadIn' || s.role === 'leadOut')).toBe(false);
    }
    // The large part is cut through normally, before the cleanups.
    const big = ops.find((o) => o.partId === 'big') as Operation;
    expect(big.passDepths.at(-1)).toBeCloseTo(-(T + SPOIL), 9);
    expect(ops.slice(-2).every((o) => o.skinCleanup)).toBe(true);
    expect(res.warnings.map((w) => w.code)).toContain('SMALL_PART_SKIN');
    expect(res.warnings.map((w) => w.code)).not.toContain('SMALL_PART_AUTO_TABS');
  });

  it('all-arc small part (disc): refused with tabs, pointing at the skin option; secured with skin and exported', () => {
    const tabs = buildToolpath(project({ sheets: [0], discs: 2 }), machine);
    const err = tabs.errors.find((e) => e.code === 'SMALL_PART_UNSECURED');
    expect(err?.message).toMatch(/ince tabaka/);
    expect(tabs.ok).toBe(false);

    const p = project({ sheets: [0], discs: 2, skin: 0.4 });
    const skin = buildToolpath(p, machine);
    expect(skin.errors).toEqual([]);
    expect(skin.toolpath.operations.filter((o) => o.skinCleanup)).toHaveLength(2);
    for (const post of ['generic', 'mach3'] as const) {
      const r = exportNc(
        p,
        { profile: goldenProfile(post), version: 1, verification: 'draft' },
        postConfig(post),
      );
      expect(r.check?.violations ?? []).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('property: per sheet, every skinned part has one cleanup and the cleanups come last', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 3 }),
        fc.double({ min: 0.2, max: 2, noNaN: true }),
        (sheets, skinT) => {
          const res = buildToolpath(project({ sheets, skin: skinT }), machine);
          expect(res.errors).toEqual([]);
          const ops = res.toolpath.operations;
          // Sheets in order; within a sheet no normal op after a cleanup.
          for (let i = 1; i < ops.length; i += 1) {
            const a = ops[i - 1] as Operation;
            const b = ops[i] as Operation;
            expect(b.sheet).toBeGreaterThanOrEqual(a.sheet);
            if (a.sheet === b.sheet && a.skinCleanup) expect(b.skinCleanup).toBe(true);
          }
          const mains = ops.filter((o) => o.partId === 's' && !o.skinCleanup);
          const cleans = ops.filter((o) => o.skinCleanup);
          expect(mains.map((o) => `${o.id}/skin`).sort()).toEqual(cleans.map((o) => o.id).sort());
          for (const o of ops) {
            for (const z of feedZs(o)) expect(z).toBeGreaterThanOrEqual(-(T + SPOIL) - 1e-9);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('a skin as thick as the material is refused (INVALID_SKIN)', () => {
    const p = project({ sheets: [1], skin: 0.5 });
    const thin = applyCommand(p, 'setThickness', { thickness: 0.4 });
    if (!thin.ok) throw new Error('setThickness');
    const res = buildToolpath(thin.project, machineOf({ thickness: 0.4, spoilboard: SPOIL }));
    expect(res.errors.map((e) => e.code)).toContain('INVALID_SKIN');
  });
});

describe('setThinSkin (T143)', () => {
  it('on, change, off; checked against the thickness; undo restores byte for byte', () => {
    const p = project({ sheets: [1] });
    const on = applyCommand(p, 'setThinSkin', { thickness: 0.5 });
    if (!on.ok) throw new Error('on');
    expect(on.project.cutting.skin).toEqual({ thickness: 0.5 });
    expect(JSON.stringify(applyPatches(on.project, on.inversePatches))).toBe(JSON.stringify(p));
    const off = applyCommand(on.project, 'setThinSkin', { thickness: null });
    if (!off.ok) throw new Error('off');
    expect(off.project.cutting.skin).toBeUndefined();
    expect(JSON.stringify(off.project)).toBe(JSON.stringify(p));
    expect(applyCommand(p, 'setThinSkin', { thickness: 18 }).ok).toBe(false);
    expect(applyCommand(p, 'setThinSkin', { thickness: 0 }).ok).toBe(false);
  });
});
