import { describe, expect, it } from 'vitest';
import type { Project } from '../schema';
import { projectOf } from '../toolpath/toolpath.testing';
import { validateProject } from '../validate';
import { freeformMix } from './__bench__/datasets';
import { nest, nestingEngineOf, nestingInputFromProject, nestProject } from './nest';

function withGrain(sheetGrain: number | null, mode: 'free' | 'fixed', angle: number): Project {
  const p = projectOf({
    parts: [
      { id: 'a', w: 600, h: 300, qty: 3 },
      { id: 'b', w: 400, h: 200, qty: 2 },
    ],
    sheet: { width: 2800, height: 2070 },
    gap: 8,
    margin: 10,
  });
  return {
    ...p,
    stock: { ...p.stock, sheet: { ...p.stock.sheet, grain: sheetGrain } },
    parts: p.parts.map((part) => ({ ...part, grain: { mode, angle } })),
  };
}

describe('engine selection (T167)', () => {
  it('axis-aligned rectangle jobs stay with MaxRects (output unchanged)', () => {
    const p = withGrain(0, 'fixed', 0);
    expect(nestingEngineOf(p)).toBe('maxrects');
    expect(nestingInputFromProject(p, { toolDiameter: 8 }).engine).toBe('maxrects');
    const res = nestProject(p, { toolDiameter: 8 });
    expect(res.strategy.heuristic).not.toBe('trueshape-bl');
    expect(JSON.stringify(res)).toBe(
      JSON.stringify(
        nest({ ...nestingInputFromProject(p, { toolDiameter: 8 }), engine: undefined }),
      ),
    );
  });

  it('a fixed part at a non-axis grain angle switches the job to true-shape', () => {
    const p = withGrain(30, 'fixed', 0);
    expect(nestingEngineOf(p)).toBe('trueShape');
    const res = nestProject(p, { toolDiameter: 8 });
    expect(res.strategy.heuristic).toBe('trueshape-bl');
    expect(res.info).toEqual([]);
    expect(res.unplaced).toEqual([]);
  });

  it('the 45° / 15° step policy and part-in-hole with an inner select true-shape', () => {
    const p = withGrain(null, 'free', 0);
    expect(nestingEngineOf(p)).toBe('maxrects');
    expect(nestingEngineOf({ ...p, nesting: { ...p.nesting, rotation: 'step45' } })).toBe(
      'trueShape',
    );
    expect(nestingEngineOf({ ...p, nesting: { ...p.nesting, rotation: 'none' } })).toBe('maxrects');
    // partInHole without any inner cutout changes nothing.
    expect(nestingEngineOf({ ...p, nesting: { ...p.nesting, partInHole: true } })).toBe('maxrects');
  });

  it('a true-shape layout locked in place passes validation (footprint check, not bboxes)', () => {
    const p = withGrain(30, 'fixed', 0);
    const nested = nestProject(p, { toolDiameter: 8 });
    const locked: Project = {
      ...p,
      layout: {
        sheets: nested.layout.sheets.map((s) => ({
          ...s,
          placements: s.placements.map((pl) => ({ ...pl, locked: true })),
        })),
      },
    };
    const issues = validateProject(locked).filter((i) => i.code === 'LOCKED_PLACEMENT_INVALID');
    expect(issues).toEqual([]);
  });
});

describe('time budget (T167)', () => {
  it('300 freeform copies nest within 10 s, deterministically', () => {
    const input = { ...freeformMix, engine: 'trueShape' as const };
    const t0 = Date.now();
    const a = nest(input);
    const ms = Date.now() - t0;
    expect(a.unplaced).toEqual([]);
    expect(ms).toBeLessThan(10_000);
    expect(JSON.stringify(nest(input))).toBe(JSON.stringify(a));
  }, 60_000);
});
