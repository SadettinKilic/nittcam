import { describe, expect, it } from 'vitest';
import { CommandStack } from '../commands';
import type { Project } from '../schema';
import { traitsOf } from '../machine/material-traits';
import { backFaceFixtureProject, backFaceProfile } from '../post/golden.testing';
import { buildToolpath } from './build';
import { contourEntryOf, cuttingSettingsOf } from './cutting-settings';
import { projectOf } from './toolpath.testing';
import type { Operation } from './types';

// T422 (analysis §4.2 / §4.5, rule 12): ACM cuts conventional by default and its contours ramp in
// at the traits angle (2°); wood keeps climb and the straight plunge.

const at = { actor: 'user' as const, at: '2026-11-28T00:00:00.000Z' };
const base = () => projectOf({ parts: [{ id: 'a', w: 100, h: 50, qty: 1 }] });

describe('cut direction from the traits (T422)', () => {
  it('ACM defaults to conventional; wood, plastic, aluminium and unknown stay climb', () => {
    expect(traitsOf('acm').cutDirection).toBe('conventional');
    for (const k of ['mdf', 'plywood', 'pvc', 'aluminium', null] as const) {
      expect(traitsOf(k).cutDirection).toBe('climb');
    }
  });

  it('setMaterial follows the kind default, one undo step', () => {
    const s = new CommandStack(base());
    expect(s.project.cutting.direction).toBe('climb');
    s.execute('setMaterial', { material: 'acm' }, at);
    expect(s.project.cutting.direction).toBe('conventional');
    s.execute('setMaterial', { material: 'mdf' }, at);
    expect(s.project.cutting.direction).toBe('climb');
    s.undo();
    expect(s.project.cutting.direction).toBe('conventional');
  });

  it('a hand-picked direction is kept across a kind change', () => {
    const s = new CommandStack(base());
    s.execute('setCutDirection', { direction: 'conventional' }, at);
    s.execute('setMaterial', { material: 'acm' }, at);
    expect(s.project.cutting.direction).toBe('conventional');
    s.execute('setCutDirection', { direction: 'climb' }, at);
    s.execute('setMaterial', { material: 'mdf' }, at);
    expect(s.project.cutting.direction).toBe('climb');
    // Wood ↔ plastic share the default: nothing moves.
    s.execute('setCutDirection', { direction: 'conventional' }, at);
    s.execute('setMaterial', { material: 'pvc' }, at);
    expect(s.project.cutting.direction).toBe('conventional');
  });

  it('a library pick to ACM also follows', () => {
    const s = new CommandStack(base());
    s.execute(
      'applyLibraryMaterial',
      { libraryId: 'l1', material: 'acm', thickness: 4, width: 2440, height: 1250, grain: null },
      at,
    );
    expect(s.project.cutting.direction).toBe('conventional');
  });
});

describe('contour entry from the traits (T422)', () => {
  it('wood: straight plunge; ACM: ramp at the traits default; an own ramp wins', () => {
    const wood = base();
    expect(contourEntryOf(wood)).toBeNull();
    const acm = { ...wood, stock: { ...wood.stock, material: 'acm', thickness: 4 } };
    expect(contourEntryOf(acm)).toEqual({ angleDeg: traitsOf('acm').entry.rampDeg?.default });
    expect(contourEntryOf(acm)).toEqual({ angleDeg: 2 });
    const own = {
      ...acm,
      cutting: { ...acm.cutting, entry: { type: 'ramp' as const, angleDeg: 4, length: 20 } },
    };
    expect(contourEntryOf(own)).toEqual({ angleDeg: 4, length: 20 });
  });

  it('the ACM fixture ramps into every contour pass (no plunge below the top) and runs CCW', () => {
    const profile = backFaceProfile('generic');
    const set = profile.materials.find((m) => m.material === 'acm');
    const d = profile.tools.find((t) => t.number === set?.tool)?.diameter ?? 8;
    const project = backFaceFixtureProject(d);
    expect(cuttingSettingsOf(project, profile).direction).toBe('conventional');
    const tp = buildToolpath(project, profile);
    if (!tp.ok) throw new Error(JSON.stringify(tp.errors));
    const contours = tp.toolpath.operations.filter((op: Operation) => op.kind === 'outerContour');
    expect(contours.length).toBeGreaterThan(0);
    for (const op of contours) {
      expect(op.travel).toBe('ccw');
      // Down to the top only before the contour; every pass starts with a ramp leg (a move along
      // the contour that descends), never a vertical plunge. Descents after a tab stay as today
      // (tabs on metal: T358).
      for (const g of op.segments.filter((x) => x.role !== 'pass')) {
        expect(g.moves.filter((m) => m.kind === 'plunge' && m.z < -1e-9)).toEqual([]);
      }
      for (const g of op.segments.filter((x) => x.role === 'pass')) {
        expect(g.moves[0]?.kind).not.toBe('plunge');
      }
    }
  });

  it('wood keeps the straight plunge (today)', () => {
    const profile = backFaceProfile('generic');
    const d = profile.tools[0]?.diameter ?? 8;
    const acm = backFaceFixtureProject(d);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- wood has no back face
    const { machinedFace: _face, ...stock } = acm.stock;
    const wood: Project = {
      ...acm,
      stock: { ...stock, material: 'mdf', thickness: 18 },
      cutting: { ...acm.cutting, direction: 'climb' },
    };
    expect(contourEntryOf(wood)).toBeNull();
    const tp = buildToolpath(wood, profile);
    if (!tp.ok) throw new Error(JSON.stringify(tp.errors));
    const op = tp.toolpath.operations.find((o) => o.kind === 'outerContour');
    expect(op?.travel).toBe('cw');
    const moves = op?.segments.flatMap((g) => g.moves) ?? [];
    expect(moves.some((m) => m.kind === 'plunge' && m.z < 0)).toBe(true);
  });
});
