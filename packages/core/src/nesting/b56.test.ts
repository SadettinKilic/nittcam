/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index results whose length is known */
/**
 * B56 (T312, T313): a cabinet's doors stay on the sheet that has room (several stock sizes no
 * longer split a cabinet over two small sheets), open sheets are filled before a new one is opened,
 * and the clear distance between neighbours is the tool diameter plus the clearance (default 0.1).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROJECT_DEFAULTS } from '../commands/project-defaults';
import { cabinetParts, DEFAULT_CABINET, type CabinetParams } from '../cutlist/cabinet';
import type { Project } from '../schema';
import { buildToolpath } from '../toolpath/build';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import { MaxRectsBin } from './bins';
import {
  nest,
  nestingInputFromProject,
  nestPartRotations,
  nestProject,
  partSpacing,
  placementRect,
  sizePolicies,
} from './nest';
import { invariantViolations } from './nest.testing';
import { DEFAULT_PART_CLEARANCE, partClearDistance } from './tool';
import type { NestingInput, NestingResult, NestPart, Rect } from './types';

/** The sample project's cabinet (800 × 720 × 560, 2 doors, 1 shelf, no back) as a project. */
function cabinetProject(over: Partial<CabinetParams> = {}, gap = 8, grain = true): Project {
  const r = cabinetParts({
    ...DEFAULT_CABINET,
    width: 800,
    doors: 2,
    shelves: 1,
    back: { mode: 'none', thickness: 8 },
    ...over,
  });
  if (!r.ok) throw new Error(r.error);
  const p = projectOf({
    parts: r.parts.map((x, i) => ({ id: `${i}-${x.role}`, w: x.w, h: x.h, qty: x.qty })),
    sheet: { width: 2800, height: 2070 },
    gap,
    margin: 10,
  });
  p.parts.forEach((part, i) => {
    part.grain = grain ? r.parts[i]!.grain : { mode: 'free', angle: 0 };
  });
  return p;
}

const doorSheets = (res: NestingResult) =>
  res.layout.sheets.flatMap((sh, i) =>
    sh.placements.filter((pl) => pl.partId.endsWith('door')).map(() => i),
  );

describe('T312 cabinet doors', () => {
  it('one stock size: the whole cabinet, both doors included, is on one sheet', () => {
    for (const mode of ['minWaste', 'fastest', 'minToolChanges'] as const) {
      const p = cabinetProject();
      p.nesting.mode = mode;
      const res = nestProject(p, { toolDiameter: 8 });
      expect(res.sheetCount, mode).toBe(1);
      expect(doorSheets(res), mode).toEqual([0, 0]);
    }
  });

  it('two stock sizes (library seed): one 2800 × 2070 sheet, not a door alone on a second small one', () => {
    for (const grain of [true, false]) {
      for (const mode of ['minWaste', 'fastest'] as const) {
        const p = cabinetProject({}, 8, grain);
        p.nesting.mode = mode;
        p.stock.sheets = [
          { width: 2800, height: 2070 },
          { width: 2440, height: 1220 },
        ];
        const res = nestProject(p, { toolDiameter: 8 });
        // Before T312: two 2440 × 1220 sheets (5.95 m²), one door alone on the second (91 % waste).
        expect(res.sheetCount, `${mode} ${grain}`).toBe(1);
        expect(res.layout.sheets[0]!.size, `${mode} ${grain}`).toEqual({
          width: 2800,
          height: 2070,
        });
        expect(doorSheets(res)).toEqual([0, 0]);
        expect(invariantViolations(nestingInputFromProject(p, { toolDiameter: 8 }), res)).toEqual(
          [],
        );
      }
    }
  });

  it('a small cabinet that fits the small sheet still takes the small sheet', () => {
    const p = cabinetProject({ width: 600 });
    p.stock.sheets = [
      { width: 2800, height: 2070 },
      { width: 2440, height: 1220 },
    ];
    const res = nestProject(p, { toolDiameter: 8 });
    expect(res.sheetCount).toBe(1);
    expect(res.layout.sheets[0]!.size).toEqual({ width: 2440, height: 1220 });
  });

  it('size policies: greedy only for one size; greedy, fitAll, then each stock size (no offcuts)', () => {
    expect(sizePolicies([{}])).toEqual([{ kind: 'greedy' }]);
    expect(sizePolicies([{ offcutId: 'o1' }, {}, {}])).toEqual([
      { kind: 'greedy' },
      { kind: 'fitAll' },
      { kind: 'prefer', k: 1 },
      { kind: 'prefer', k: 2 },
    ]);
  });

  it('deterministic with several sizes', () => {
    const p = cabinetProject({ width: 1000 });
    p.stock.sheets = [
      { width: 2800, height: 2070 },
      { width: 2440, height: 1220 },
    ];
    const a = JSON.stringify(nestProject(p, { toolDiameter: 8 }));
    const b = JSON.stringify(
      nestProject(JSON.parse(JSON.stringify(p)) as Project, { toolDiameter: 8 }),
    );
    expect(a).toBe(b);
  });
});

/**
 * Copies on a later sheet that would fit the free space of an earlier sheet (exact MaxRects free
 * space of the final layout, every allowed rotation): must be none.
 */
function missedFits(input: NestingInput, res: NestingResult): string[] {
  const s = partSpacing(input.toolDiameter, input.gap);
  const parts = new Map(input.parts.map((p) => [p.id, p]));
  const sizes = new Map(input.parts.map((p) => [p.id, { w: p.w, h: p.h }]));
  const area: Rect = {
    x: input.margin - s,
    y: input.margin - s,
    w: input.sheet.width - 2 * input.margin + 2 * s,
    h: input.sheet.height - 2 * input.margin + 2 * s,
  };
  const bins = res.layout.sheets.map((sh) => {
    const bin = new MaxRectsBin(area, 'bl');
    for (const pl of sh.placements) {
      const r = placementRect(pl, sizes)!;
      bin.occupy({ x: r.x - s, y: r.y - s, w: r.w + 2 * s, h: r.h + 2 * s });
    }
    return bin;
  });
  const out: string[] = [];
  res.layout.sheets.forEach((sh, j) => {
    for (const pl of sh.placements) {
      const part = parts.get(pl.partId) as NestPart;
      for (let i = 0; i < j; i++) {
        for (const rot of nestPartRotations(part)) {
          const [w, h] = rot % 180 === 0 ? [part.w, part.h] : [part.h, part.w];
          // A tiny margin so a fit exactly at the EPS edge does not count.
          if (bins[i]!.find(w + 2 * s + 0.01, h + 2 * s + 0.01)) {
            out.push(`${pl.partId}#${pl.index} on ${j} fits ${i} at ${rot}`);
          }
        }
      }
    }
  });
  return out;
}

describe('T312 property: no new sheet while an open sheet has room', () => {
  const partArb = (i: number): fc.Arbitrary<NestPart> =>
    fc.record({
      id: fc.constant(`p${i}`),
      w: fc.integer({ min: 20, max: 1400 }),
      h: fc.integer({ min: 20, max: 1000 }),
      qty: fc.integer({ min: 1, max: 5 }),
      grainLock: fc.boolean(),
    });
  const inputArb: fc.Arbitrary<NestingInput> = fc.integer({ min: 1, max: 10 }).chain((n) =>
    fc.record({
      sheet: fc.constant({ width: 2800, height: 2070 }),
      parts: fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i))),
      gap: fc.constantFrom(0, 0.1, 2, 8),
      margin: fc.constant(10),
      toolDiameter: fc.constantFrom(6, 8, 10),
      mode: fc.constantFrom('minWaste' as const, 'fastest' as const),
      locked: fc.constant([]),
    }),
  );

  it('holds for random jobs (every heuristic can win, guillotine included)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const res = nest(input);
        expect(invariantViolations(input, res)).toEqual([]);
        expect(missedFits(input, res)).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });
});

/** Euclidean clear distance between two rectangles (0 when they touch or overlap). */
function clearDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

describe('T313 clearance between parts', () => {
  it('new projects start with 0.1 mm on top of the tool diameter (Ø8 → 8.1 mm)', () => {
    expect(DEFAULT_PART_CLEARANCE).toBe(0.1);
    expect(BUILT_IN_PROJECT_DEFAULTS.gap).toBe(DEFAULT_PART_CLEARANCE);
    expect(partClearDistance(8, DEFAULT_PART_CLEARANCE)).toBeCloseTo(8.1, 9);
    expect(2 * partSpacing(8, DEFAULT_PART_CLEARANCE)).toBeCloseTo(8.1, 9);
  });

  for (const engine of ['maxrects', 'trueShape'] as const) {
    it(`${engine}: measured clear distance between neighbours ≥ Ø + clearance, and tight`, () => {
      const tool = 8;
      const gap = DEFAULT_PART_CLEARANCE;
      const p = cabinetProject({ width: 1200, shelves: 3 }, gap);
      const res = nestProject(p, { toolDiameter: tool, engine });
      const sizes = new Map(
        nestingInputFromProject(p, { toolDiameter: tool }).parts.map((x) => [
          x.id,
          { w: x.w, h: x.h },
        ]),
      );
      let min = Infinity;
      for (const sh of res.layout.sheets) {
        const rects = sh.placements.map((pl) => placementRect(pl, sizes)!);
        rects.forEach((a, i) =>
          rects.forEach((b, j) => {
            if (j <= i) return;
            min = Math.min(min, clearDistance(a, b));
          }),
        );
      }
      expect(min).toBeGreaterThanOrEqual(tool + gap - 1e-3);
      // The parts are packed at that distance, not at the old 16 mm.
      expect(min).toBeLessThan(tool + gap + 0.01);
    });
  }

  it('a smaller clearance never needs more sheets (Ø8 + 8 vs Ø8 + 0.1)', () => {
    for (const W of [600, 800, 1000, 1200]) {
      const wide = nestProject(cabinetProject({ width: W }, 8), { toolDiameter: 8 });
      const tight = nestProject(cabinetProject({ width: W }, DEFAULT_PART_CLEARANCE), {
        toolDiameter: 8,
      });
      expect(tight.sheetCount).toBeLessThanOrEqual(wide.sheetCount);
    }
  });
});

describe('T313 leads with a tight clearance', () => {
  it('the cut starts on an edge with room: no shortened or removed leads, toolpath ok', () => {
    const p = cabinetProject({}, DEFAULT_PART_CLEARANCE);
    p.layout = nestProject(p, { toolDiameter: 8 }).layout as Project['layout'];
    const m = machineOf();
    const tp = buildToolpath(p, m);
    expect(tp.ok).toBe(true);
    const codes = tp.warnings.map((w) => w.code);
    expect(codes).not.toContain('LEAD_SHORTENED');
    expect(codes).not.toContain('LEAD_REMOVED');
  });
});
