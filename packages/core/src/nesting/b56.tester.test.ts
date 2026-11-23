/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * B56 tester checks (PR #172, T312 + T313). G-code safety of the tight clearance (tool Ø + 0.1)
 * together with the new start-edge choice (`leadRoomStarts`): random tight layouts with narrow,
 * rounded and boxed-in parts through the independent toolpath checker (leads never touch a
 * neighbour or leave the sheet, pass offset = tool radius, climb / conventional travel) and through
 * the independent G-code checker (both posts, 4 corners). Also: T312 determinism with several
 * stock sizes, and the built-in gap is only a default (an explicit project gap is kept).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canDownload, checkGcodeFiles } from '../gcode-check/check';
import { postConfig } from '../gcode-check/check.testing';
import { expectedLayouts } from '../gcode-check/layout';
import { fileList, profileOf, scenarioArb } from '../gcode-check/scenario.testing';
import { generateGcode } from '../post';
import type { Project } from '../schema';
import { buildToolpath } from '../toolpath/build';
import { clone, machineOf, projectOf, toolpathViolations } from '../toolpath/toolpath.testing';
import { nest, nestProject } from './nest';
import { DEFAULT_PART_CLEARANCE } from './tool';
import type { NestingInput } from './types';

/** Narrow strips, regular panels, rounded corners up to a full stadium/circle. */
const tightPartArb = (i: number) =>
  fc
    .record({
      w: fc.constantFrom(40, 60, 120, 300, 600),
      h: fc.constantFrom(40, 80, 250, 400),
      rFrac: fc.oneof(fc.constant(0), fc.constant(1), fc.double({ min: 0, max: 1, noNaN: true })),
      qty: fc.integer({ min: 1, max: 6 }),
    })
    .map(({ w, h, rFrac, qty }) => ({ id: `p${i}`, w, h, r: (rFrac * Math.min(w, h)) / 2, qty }));

const tightCaseArb = fc.record({
  parts: fc
    .integer({ min: 1, max: 5 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => tightPartArb(i)))),
  gap: fc.constantFrom(DEFAULT_PART_CLEARANCE, 0),
  tool: fc.constantFrom(6, 8, 10),
  lead: fc.constantFrom('arc' as const, 'line' as const),
  leadLength: fc.constantFrom(0, 5, 12, 20),
  direction: fc.constantFrom('climb' as const, 'conventional' as const),
  sheet: fc.constantFrom({ width: 1220, height: 900 }, { width: 2440, height: 1220 }),
});

describe('B56 G-code safety: tight clearance + lead-room start edges', () => {
  it('random tight layouts: leads clear of neighbours and the sheet, offset = radius, travel kept', () => {
    let leadsSeen = 0;
    fc.assert(
      fc.property(tightCaseArb, (c) => {
        const base = projectOf({
          parts: c.parts,
          sheet: c.sheet,
          gap: c.gap,
          margin: 10,
          leadIn: c.lead,
          direction: c.direction,
        });
        const nested = nestProject(base, { toolDiameter: c.tool });
        fc.pre(nested.layout.sheets.length > 0);
        const project: Project = { ...base, layout: nested.layout };
        const machine = machineOf({ toolDiameter: c.tool });
        const res = buildToolpath(project, machine, {
          lead: c.lead,
          ...(c.leadLength > 0 ? { leadLength: c.leadLength } : {}),
          direction: c.direction,
        });
        expect(
          res.errors.filter(
            (e) => e.code !== 'SMALL_PART_UNSECURED' && e.code !== 'SMALL_SLUG_UNSECURED',
          ),
        ).toEqual([]);
        // Skin cleanups are extra operations with their own depth; the contour checks below are
        // about the cut contours.
        const ops = res.toolpath.operations.filter((o) => !o.skinCleanup);
        const v = toolpathViolations(
          project,
          { ...res, toolpath: { ...res.toolpath, operations: ops } },
          {
            passDepth: 6.1,
            thickness: 18,
            spoilboard: 0.3,
            toolDiameter: c.tool,
            safeZ: 20,
            plungeFeed: 1500,
            direction: c.direction,
          },
        ).filter((s) => !/passes, want|pass \d+ at|last pass|pass step/.test(s));
        expect(v).toEqual([]);
        leadsSeen += ops.filter((o) => o.segments.some((s) => s.role === 'leadIn')).length;
        // Same input → same toolpath (the start-edge choice is deterministic).
        const again = buildToolpath(clone(project), clone(machine), {
          lead: c.lead,
          ...(c.leadLength > 0 ? { leadLength: c.leadLength } : {}),
          direction: c.direction,
        });
        expect(JSON.stringify(again)).toBe(JSON.stringify(res));
      }),
      { numRuns: 120 },
    );
    expect(leadsSeen).toBeGreaterThan(50);
  });

  it('a strip boxed in on every side at Ø8 + 0.1: lead removed with a warning, never into a neighbour', () => {
    const tool = 8;
    const d = tool + DEFAULT_PART_CLEARANCE;
    const project = projectOf({
      parts: [
        { id: 'a', w: 300, h: 40 },
        { id: 'n', w: 300, h: 100 },
        { id: 's', w: 300, h: 100 },
        { id: 'w', w: 100, h: 40 },
        { id: 'e', w: 100, h: 40 },
      ],
      gap: DEFAULT_PART_CLEARANCE,
      placements: [
        [
          { partId: 'a', index: 0, x: 400, y: 400, rot: 0 },
          { partId: 'n', index: 0, x: 400, y: 440 + d, rot: 0 },
          { partId: 's', index: 0, x: 400, y: 400 - 100 - d, rot: 0 },
          { partId: 'w', index: 0, x: 400 - 100 - d, y: 400, rot: 0 },
          { partId: 'e', index: 0, x: 700 + d, y: 400, rot: 0 },
        ],
      ],
    });
    for (const lead of ['arc', 'line'] as const) {
      for (const direction of ['climb', 'conventional'] as const) {
        const res = buildToolpath(project, machineOf({ toolDiameter: tool }), {
          lead,
          direction,
        });
        const a = res.toolpath.operations.find((o) => o.partId === 'a')!;
        expect(a).toBeDefined();
        expect(
          toolpathViolations(project, res, {
            passDepth: 6.1,
            thickness: 18,
            spoilboard: 0.3,
            toolDiameter: tool,
            safeZ: 20,
            plungeFeed: 1500,
            direction,
          }),
        ).toEqual([]);
        const leadIn = a.segments.find((s) => s.role === 'leadIn');
        const warned = res.warnings.some(
          (w) => w.partId === 'a' && (w.code === 'LEAD_REMOVED' || w.code === 'LEAD_SHORTENED'),
        );
        // Either a lead that fits the 8.1 mm channel (checked above) or a warning.
        if (!leadIn || leadIn.moves.length === 0) expect(warned).toBe(true);
      }
    }
  });

  it('generated programs at Ø + 0.1 pass the independent G-code checker', () => {
    let programs = 0;
    fc.assert(
      fc.property(scenarioArb, fc.boolean(), (s, narrow) => {
        const scenario = narrow
          ? { ...s, parts: s.parts.map((p) => ({ ...p, h: Math.min(p.h, 70), r: 0 })) }
          : s;
        const profile = profileOf(scenario);
        const unplaced = projectOf({
          parts: scenario.parts,
          sheet: scenario.sheet,
          thickness: scenario.thickness,
          gap: DEFAULT_PART_CLEARANCE,
          // T331 (D-122): a margin below the tool Ø now fails the checker (cutter past the edge).
          margin: Math.max(10, scenario.toolDia),
          leadIn: scenario.lead === 'line' ? 'line' : 'arc',
          direction: scenario.direction,
        });
        const nested = nestProject(unplaced, { toolDiameter: scenario.toolDia });
        fc.pre(nested.layout.sheets.length > 0);
        const project: Project = {
          ...unplaced,
          layout: nested.layout,
          cutting: {
            ...unplaced.cutting,
            tabs: { ...unplaced.cutting.tabs, auto: scenario.tabs },
          },
        };
        const tp = buildToolpath(project, profile, {
          lead: scenario.lead,
          plunge: scenario.plunge2,
          direction: scenario.direction,
          clearance: scenario.clearance,
        });
        fc.pre(tp.ok);
        const post = postConfig(scenario.post);
        if (scenario.files === 'split') post.file.maxSizeBytes = 4_000;
        if (scenario.files === 'none') post.toolChange = { ...post.toolChange, mode: 'none' };
        const stock = {
          thickness: scenario.thickness,
          sheetWidth: scenario.sheet.width,
          sheetHeight: scenario.sheet.height,
        };
        const result = generateGcode(
          tp.toolpath,
          { profile, version: 1, verification: 'draft' },
          post,
          {
            projectName: 'B56 tester',
            revision: 1,
            fileStem: 'b56',
            stock: { material: 'mdf', ...stock },
          },
        );
        fc.pre(!result.errors.some((e) => e.code === 'FILE_TOO_LARGE'));
        expect(result.errors).toEqual([]);
        const r = checkGcodeFiles(fileList(result.files), {
          profile,
          verification: 'draft',
          post,
          toolpath: tp.toolpath,
          stock,
          layout: expectedLayouts(project),
        });
        expect(r.violations).toEqual([]);
        expect(canDownload(r)).toBe(true);
        programs++;
      }),
      { numRuns: 120 },
    );
    expect(programs).toBeGreaterThan(40);
  });
});

describe('B56 T312 / T313 extra checks', () => {
  it('several stock sizes: same input → byte-identical result, input not mutated', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            w: fc.integer({ min: 50, max: 1500 }),
            h: fc.integer({ min: 50, max: 1000 }),
            qty: fc.integer({ min: 1, max: 4 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        fc.constantFrom('minWaste' as const, 'fastest' as const),
        (parts, mode) => {
          const input: NestingInput = {
            sheet: { width: 2800, height: 2070 },
            sheets: [
              { width: 2800, height: 2070 },
              { width: 2440, height: 1220 },
            ],
            parts: parts.map((p, i) => ({ id: `p${i}`, ...p, grainLock: false })),
            gap: DEFAULT_PART_CLEARANCE,
            margin: 10,
            toolDiameter: 8,
            mode,
            locked: [],
          } as NestingInput;
          const before = JSON.stringify(input);
          const a = JSON.stringify(nest(input));
          expect(JSON.stringify(input)).toBe(before);
          expect(JSON.stringify(nest(clone(input)))).toBe(a);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('an explicit project gap is kept (only new projects get 0.1)', () => {
    const p = projectOf({ parts: [{ id: 'a', w: 100, h: 100, qty: 4 }], gap: 8 });
    expect(p.nesting.gap).toBe(8);
    const res = nestProject(p, { toolDiameter: 8 });
    const xs = res.layout.sheets[0]!.placements.map((pl) => [pl.x, pl.y] as const);
    let min = Infinity;
    xs.forEach(([x1, y1], i) =>
      xs.forEach(([x2, y2], j) => {
        if (j <= i) return;
        const dx = Math.max(0, Math.abs(x1 - x2) - 100);
        const dy = Math.max(0, Math.abs(y1 - y2) - 100);
        min = Math.min(min, Math.hypot(dx, dy));
      }),
    );
    expect(min).toBeGreaterThanOrEqual(16 - 1e-6);
  });
});
