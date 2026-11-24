/** T169: edge-band deduction (spec §4.8): cut size = finished − band thickness per edge. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CommandStack } from '../commands';
import { nestProject } from '../nesting';
import { checkPlacement } from '../nesting/placement';
import { buildToolpath } from '../toolpath';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import {
  cutPart,
  cutSize,
  enteredSize,
  finishedSize,
  hasBandDeduction,
  MIN_CUT_SIZE,
  toCutSizes,
} from './cut-size';
import { deriveOutline } from './outline';
import type { Part, Project } from './project';

const ctx = { actor: 'user' as const, at: '2026-11-20T10:00:00Z' };
const EDGES = ['top', 'right', 'bottom', 'left'] as const;

function banded(
  band: Part['edgeBand'],
  mode: 'cut' | 'finished' = 'finished',
  w = 600,
  h = 400,
): Project {
  const p = projectOf({ parts: [{ id: 'a', w, h }] });
  const part = p.parts[0] as Part;
  return {
    ...p,
    settings: { dimensionMode: mode },
    parts: [
      {
        ...part,
        edgeBand: band,
        holes: [{ id: 'h1', type: 'through', d: 8, cx: 37, cy: 50, tool: 1 }],
        inners: [
          [
            { x: 100, y: 100, bulge: 0 },
            { x: 100, y: 200, bulge: 0 },
            { x: 200, y: 200, bulge: 0 },
            { x: 200, y: 100, bulge: 0 },
          ],
        ],
      },
    ],
  };
}

describe('cutSize', () => {
  it('cut mode: entered size is the cut size', () => {
    expect(cutSize({ w: 600, h: 400 }, { top: 2, right: 2, bottom: 2, left: 2 }, 'cut')).toEqual({
      w: 600,
      h: 400,
    });
  });

  it('finished mode, every edge combination (16) deducts exactly the banded edges', () => {
    for (let mask = 0; mask < 16; mask++) {
      const band = { top: 0, right: 0, bottom: 0, left: 0 };
      EDGES.forEach((e, i) => {
        if (mask & (1 << i)) band[e] = i + 1; // top 1, right 2, bottom 3, left 4 mm
      });
      const got = cutSize({ w: 600, h: 400 }, band, 'finished');
      expect(got).toEqual({ w: 600 - band.left - band.right, h: 400 - band.top - band.bottom });
    }
  });

  it('never gives a zero or negative side', () => {
    expect(cutSize({ w: 3, h: 3 }, { top: 2, right: 2, bottom: 2, left: 2 }, 'finished')).toEqual({
      w: MIN_CUT_SIZE,
      h: MIN_CUT_SIZE,
    });
  });
});

describe('cutPart / toCutSizes', () => {
  it('returns the same project when nothing is deducted (goldens stay byte-identical)', () => {
    const cut = banded({ top: 2, right: 2, bottom: 2, left: 2 }, 'cut');
    expect(toCutSizes(cut)).toBe(cut);
    const none = banded({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(toCutSizes(none)).toBe(none);
  });

  it('shrinks the outline and shifts holes, inners by the left/bottom band', () => {
    const p = banded({ top: 1, right: 2, bottom: 0.8, left: 0.5 });
    const part = toCutSizes(p).parts[0] as Part;
    expect(part.kind === 'rect' && part.params).toEqual({ w: 597.5, h: 398.2, r: 0 });
    expect(part.holes[0]).toMatchObject({ cx: 36.5, cy: 49.2 });
    expect(part.inners[0]?.[0]).toMatchObject({ x: 99.5, y: 99.2 });
    // The entered project is untouched.
    expect(p.parts[0]?.kind === 'rect' && p.parts[0].params.w).toBe(600);
  });

  it('freeform parts stay as drawn', () => {
    const p = banded({ top: 2, right: 2, bottom: 2, left: 2 });
    const rect = p.parts[0] as Part;
    const free: Part = {
      ...rect,
      kind: 'freeform',
      outline: deriveOutline(rect),
    } as Part;
    expect(hasBandDeduction(free, 'finished')).toBe(false);
    expect(cutPart(free, 'finished')).toBe(free);
  });

  it('property: cut area never exceeds the finished area; features keep their finished place', () => {
    const mm = fc.double({ min: 0, max: 5, noNaN: true });
    fc.assert(
      fc.property(mm, mm, mm, mm, (top, right, bottom, left) => {
        const p = banded({ top, right, bottom, left });
        const part = toCutSizes(p).parts[0] as Part;
        if (part.kind !== 'rect') return false;
        const h0 = (p.parts[0] as Part).holes[0];
        const h1 = part.holes[0];
        return (
          part.params.w <= 600 &&
          part.params.h <= 400 &&
          h0 !== undefined &&
          h1 !== undefined &&
          Math.abs(h1.cx + left - h0.cx) < 1e-9 &&
          Math.abs(h1.cy + bottom - h0.cy) < 1e-9
        );
      }),
    );
  });
});

describe('setDimensionMode command', () => {
  it('toggles in one undo step; same mode records nothing', () => {
    const stack = new CommandStack(banded({ top: 2, right: 2, bottom: 2, left: 2 }, 'cut'));
    const same = stack.execute('setDimensionMode', { mode: 'cut' }, ctx);
    expect(same.ok && same.changed).toBe(false);
    const r = stack.execute('setDimensionMode', { mode: 'finished' }, ctx);
    expect(r.ok && r.changed).toBe(true);
    expect(stack.project.settings.dimensionMode).toBe('finished');
    stack.undo();
    expect(stack.project.settings.dimensionMode).toBe('cut');
  });
});

describe('nesting and toolpath read the cut size', () => {
  const band = { top: 2, right: 2, bottom: 2, left: 2 };

  it('nesting input carries the cut size', () => {
    const p = banded(band);
    const r = nestProject(p, { toolDiameter: 8 });
    const pl = r.layout.sheets[0]?.placements[0];
    expect(pl).toBeDefined();
    // A 596 × 396 cut part fits where the 600 × 400 finished part would touch the margin.
    const tight: Project = {
      ...p,
      stock: { ...p.stock, sheet: { ...p.stock.sheet, width: 616, height: 416 } },
      nesting: { ...p.nesting, margin: 10 },
      // D-129: the stored margin counts with skin (tabs lift it to Ø + 3)
      cutting: { ...p.cutting, skin: { thickness: 0.5 } },
    };
    expect(nestProject(tight, { toolDiameter: 8 }).unplaced).toHaveLength(0);
    expect(
      nestProject({ ...tight, settings: { dimensionMode: 'cut' } }, { toolDiameter: 8 }).unplaced
        .length,
    ).toBeGreaterThan(0);
  });

  it('placement check uses the cut footprint', () => {
    const p = banded(band);
    const r = checkPlacement(
      {
        ...p,
        stock: { ...p.stock, sheet: { ...p.stock.sheet, width: 616, height: 416 } },
        cutting: { ...p.cutting, skin: { thickness: 0.5 } }, // D-129: stored margin with skin
      },
      0,
      { partId: 'a', index: 0, x: 10, y: 10, rot: 0, locked: false },
      { toolDiameter: 8 },
    );
    expect(r.outsideSheet).toBe(false);
    expect(r.inMargin).toBe(false);
  });

  it('toolpath outer contour is the cut outline', () => {
    const base = banded(band);
    const project: Project = {
      ...base,
      layout: {
        sheets: [{ placements: [{ partId: 'a', index: 0, x: 10, y: 10, rot: 0, locked: false }] }],
      },
    };
    const machine = machineOf({ toolDiameter: 8 });
    const fin = buildToolpath(project, machine);
    const cut = buildToolpath({ ...project, settings: { dimensionMode: 'cut' } }, machine);
    expect(fin.ok && cut.ok).toBe(true);
    const span = (r: typeof fin) => {
      const xs = r.toolpath.operations
        .filter((o) => o.kind === 'outerContour')
        .flatMap((o) => o.segments.filter((g) => g.role === 'pass'))
        .flatMap((g) => g.moves.map((m) => m.x));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(cut) - span(fin)).toBeCloseTo(4, 6);
  });
});

describe('enteredSize / finishedSize (T316, D-105)', () => {
  const band = { top: 0.8, right: 0.8, bottom: 0.8, left: 0.8 };

  it('a 395,5 × 714 finished door with 0,8 mm band is entered as 393,9 × 712,4 in cut mode', () => {
    expect(enteredSize({ w: 395.5, h: 714 }, band, 'cut')).toEqual({ w: 393.9, h: 712.4 });
    expect(enteredSize({ w: 395.5, h: 714 }, band, 'finished')).toEqual({ w: 395.5, h: 714 });
  });

  it('finishedSize gives back the generator size in both modes', () => {
    for (const mode of ['cut', 'finished'] as const) {
      const e = enteredSize({ w: 395.5, h: 714 }, band, mode);
      expect(finishedSize(e, band, mode)).toEqual({ w: 395.5, h: 714 });
    }
  });

  it('entered then cut gives the same cut size in both modes (property)', () => {
    const b = fc.double({ min: 0, max: 3, noNaN: true }).map((v) => Math.round(v * 10) / 10);
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 2000 }),
        fc.integer({ min: 50, max: 2000 }),
        fc.record({ top: b, right: b, bottom: b, left: b }),
        (w, h, eb) => {
          const inCut = enteredSize({ w, h }, eb, 'cut');
          const inFinished = cutSize(enteredSize({ w, h }, eb, 'finished'), eb, 'finished');
          expect(inCut.w).toBeCloseTo(inFinished.w, 6);
          expect(inCut.h).toBeCloseTo(inFinished.h, 6);
        },
      ),
    );
  });
});
