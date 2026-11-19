/* eslint-disable @typescript-eslint/no-non-null-assertion -- test lookups on known fixtures */
/**
 * B14a tester (T274, T275, T277): tool order and manual-change re-zero message checked against the
 * written NC text (read as data, independent of `programTools`), the offset/no-offset output
 * differing only in comment lines, one shared hole rule for validation and toolpath, and the
 * engraved-line limit, read-back depth and DXF crossing line.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { goldenProfile, holeFixtureProject } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from '../toolpath/build';
import { validateProject } from '../validate';
import { joinPaths } from '../dxf/join';
import { recognizeParts } from '../dxf/recognize';
import type { DxfPath } from '../dxf/types';
import { exportNc } from './export';

const pv = (post: 'generic' | 'mach3', lengthCompensation = false) => {
  const profile = goldenProfile(post);
  profile.toolChanger.lengthCompensation = lengthCompensation;
  return { profile, version: 1, verification: 'draft' as const };
};

const THROUGH = [
  { id: 'h1', type: 'through', d: 8, cx: 60, cy: 60, tool: 2 },
  { id: 'h2', type: 'through', d: 35, cx: 200, cy: 150, tool: 2 },
  { id: 'h3', type: 'through', d: 20, cx: 340, cy: 240, tool: 1 },
];

/** Tool numbers named by the operator prompts of a manual program, in file order (text only). */
function promptedTools(nc: string): number[] {
  return nc
    .split(/\r?\n/)
    .filter((l) => /^\(TAKIM/.test(l) && !l.startsWith('(TAKIMLAR'))
    .map((l) => Number(/T(\d+)/.exec(l)?.[1]));
}

describe('T274: tools in order of use, manual change re-zero', () => {
  it('mach3 holes-through: checklist order = the order the NC file asks for the tools', () => {
    const r = exportNc(holeFixtureProject(THROUGH), pv('mach3'), postConfig('mach3'));
    expect(r.ok).toBe(true);
    const nc = r.files[0]!.content;
    const order = r.tools!.sheets[0]!.tools.map((t) => t.number);
    expect(order).toEqual(promptedTools(nc));
    expect(order).toEqual([2, 1, 2]);
    expect(r.tools!.manualChanges).toBe(2);
    expect(r.tools!.rezeroZ).toBe(true);
    // every in-program stop asks to re-zero Z, right before M0; the first-tool question does not
    const lines = nc.split(/\r?\n/);
    const stops = lines.flatMap((l, i) => (l === 'M0' ? [i] : []));
    expect(stops).toHaveLength(3);
    expect(lines[stops[0]! - 1]).toMatch(/TAKILI MI/);
    for (const i of stops.slice(1)) {
      expect(lines[i - 1]).toMatch(
        /^\(TAKIM DEGISTIR: T\d D\d+\.\d{3} - Z SIFIRLA - SONRA CYCLE START\)$/,
      );
      expect(lines[i - 2]).toBe('M5');
      // after the stop: safe Z first, then the spindle (rules 2 and 4)
      expect(lines[i + 1]).toMatch(/^G0 Z20\.0000$/);
      expect(lines[i + 2]).toMatch(/^M3 S\d+$/);
    }
    const read = readGcode(nc);
    expect(read.errors).toEqual([]);
  });

  it('three tools (T2 → T1 → T3 …): order, change count and re-zero lines agree', () => {
    const profile = pv('mach3');
    profile.profile.tools.push({
      number: 3,
      type: 'flatEndMill',
      diameter: 5,
      fluteLength: 25,
      flutes: 2,
    } as never);
    const holes = [...THROUGH, { id: 'h4', type: 'through', d: 12, cx: 340, cy: 60, tool: 3 }];
    const r = exportNc(holeFixtureProject(holes), profile, postConfig('mach3'));
    expect(r.ok).toBe(true);
    const nc = r.files[0]!.content;
    const order = r.tools!.sheets[0]!.tools.map((t) => t.number);
    expect(new Set(order)).toEqual(new Set([1, 2, 3]));
    expect(order).toEqual(promptedTools(nc));
    expect(r.tools!.manualChanges).toBe(order.length - 1);
    expect(nc.split(/\r?\n/).filter((l) => l.includes('Z SIFIRLA'))).toHaveLength(order.length - 1);
    expect(r.tools!.sheets[0]!.tools.find((t) => t.number === 3)?.diameter).toBe(5);
  });

  it('one-tool program: no change line, no re-zero, nothing extra to confirm', () => {
    const one = THROUGH.map((h) => ({ ...h, tool: 2, d: Math.max(h.d, 8) }));
    for (const post of ['generic', 'mach3'] as const) {
      const r = exportNc(holeFixtureProject(one), pv(post), postConfig(post));
      expect(r.ok).toBe(true);
      expect(r.tools!.sheets[0]!.tools.map((t) => t.number)).toEqual([2]);
      expect(r.tools!.manualChanges).toBe(0);
      expect(r.tools!.rezeroZ).toBe(false);
      expect(r.files[0]!.content).not.toContain('DEGISTIR');
    }
  });

  it('automatic changer: M6 changes, no re-zero text, no manual confirmation', () => {
    const r = exportNc(holeFixtureProject(THROUGH), pv('generic'), postConfig('generic'));
    expect(r.ok).toBe(true);
    expect(r.tools!.mode).toBe('auto');
    expect(r.tools!.sheets[0]!.tools.map((t) => t.number)).toEqual([2, 1, 2]);
    expect(r.tools!.manualChanges).toBe(0);
    expect(r.tools!.rezeroZ).toBe(false);
    expect(r.files[0]!.content).not.toContain('Z SIFIRLA');
  });

  it('manual with length offset: plain message; the file differs from no-offset only in comments', () => {
    const cfg = postConfig('mach3');
    cfg.toolChange.lengthOffset = true;
    const off = exportNc(holeFixtureProject(THROUGH), pv('mach3', true), cfg);
    const plain = exportNc(holeFixtureProject(THROUGH), pv('mach3'), postConfig('mach3'));
    expect(off.ok && plain.ok).toBe(true);
    expect(off.tools!.manualChanges).toBe(2);
    expect(off.tools!.rezeroZ).toBe(false);
    const a = off.files[0]!.content;
    const b = plain.files[0]!.content;
    expect(a).not.toContain('Z SIFIRLA');
    expect(a).toContain('(TAKIM DEGISTIR: T1 D6.000, sonra cycle start)');
    const code = (s: string) => s.split(/\r?\n/).filter((l) => !l.startsWith('('));
    expect(code(a)).toEqual(code(b));
  });
});

describe('T275: validation and toolpath share one hole rule', () => {
  const TOOL_CODES = new Set([
    'TOOL_NOT_IN_PROFILE',
    'HOLE_SMALLER_THAN_TOOL',
    'GROOVE_NARROWER_THAN_TOOL',
    'HOLE_DEPTH_NOT_BELOW_THICKNESS',
  ]);

  it('groove narrower than the tool is an error on the groove width', () => {
    const p = holeFixtureProject([
      { id: 'g', type: 'groove', d: 60, grooveWidth: 6, depth: 3, cx: 200, cy: 150, tool: 2 },
    ]);
    const v = validateProject(p, { machine: goldenProfile('generic') }).filter(
      (i) => i.code === 'GROOVE_NARROWER_THAN_TOOL',
    );
    expect(v.map((i) => [i.severity, i.path])).toEqual([
      ['error', 'parts[0].holes[0].grooveWidth'],
    ]);
    const tp = buildToolpath(p, goldenProfile('generic'));
    expect(tp.errors.map((e) => [e.code, e.hole])).toContainEqual(['GROOVE_NARROWER_THAN_TOOL', 0]);
  });

  it('property: a hole is a validation error exactly when the toolpath refuses it', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('through', 'pocket', 'groove'),
        fc.constantFrom(1, 2, 9),
        fc.integer({ min: 3, max: 40 }),
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 3, max: 20 }),
        (type, tool, d, width, depth) => {
          const hole =
            type === 'groove'
              ? {
                  id: 'h',
                  type,
                  d: d + 2 * width,
                  grooveWidth: width,
                  depth,
                  cx: 200,
                  cy: 150,
                  tool,
                }
              : type === 'pocket'
                ? { id: 'h', type, d, depth, cx: 200, cy: 150, tool }
                : { id: 'h', type, d, cx: 200, cy: 150, tool };
          const p = holeFixtureProject([hole]);
          const m = goldenProfile('generic');
          const flagged = validateProject(p, { machine: m }).some(
            (i) => i.severity === 'error' && TOOL_CODES.has(i.code),
          );
          const refused = buildToolpath(p, m).errors.some((e) => e.hole === 0);
          expect(refused).toBe(flagged);
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe('T277: engraved line limit, read-back depth, DXF crossing line', () => {
  const withLine = (x1: number, depth = 1, thickness = 18): Project => {
    const p = structuredClone(holeFixtureProject([])) as unknown as {
      stock: { thickness: number };
      parts: Record<string, unknown>[];
    };
    p.stock.thickness = thickness;
    p.parts[0]!['lines'] = [
      {
        vertices: [
          { x: 100, y: 150, bulge: 0 },
          { x: x1, y: 150, bulge: 0 },
        ],
        op: { kind: 'online', depth },
      },
    ];
    const r = parseProject(p);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.project;
  };
  const codes = (p: Project) => ({
    v: validateProject(p, { machine: goldenProfile('generic') })
      .filter((i) => i.code === 'LINE_OUTSIDE_PART')
      .map((i) => i.path),
    t: buildToolpath(p, goldenProfile('generic'))
      .errors.filter((e) => e.code === 'LINE_OUTSIDE_PART')
      .map((e) => e.openLine),
  });

  it('the groove edge decides: Ø8 tool, line end at 400 − 4 ∓ 0.05 mm', () => {
    expect(codes(withLine(395.9))).toEqual({ v: [], t: [] });
    expect(codes(withLine(396.1))).toEqual({ v: ['parts[0].lines[0]'], t: [0] });
    expect(codes(withLine(400.1))).toEqual({ v: ['parts[0].lines[0]'], t: [0] });
    expect(exportNc(withLine(400.1), pv('generic'), postConfig('generic')).files).toEqual([]);
  });

  it.each(['generic', 'mach3'] as const)(
    '%s: the reader reads the engraving back at its depth (1.5 mm), 200 mm per copy',
    (post) => {
      const r = exportNc(withLine(300, 1.5), pv(post), postConfig(post));
      expect(r.ok).toBe(true);
      const read = readGcode(r.files[0]!.content);
      expect(read.errors).toEqual([]);
      const atDepth = read.moves.filter(
        (m) =>
          m.type !== 'rapid' && Math.abs(m.to.z + 1.5) < 1e-6 && Math.abs(m.from.z + 1.5) < 1e-6,
      );
      const length = atDepth.reduce(
        (s, m) => s + Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y),
        0,
      );
      expect(length).toBeCloseTo(400, 3);
      // nothing else cuts shallower than the engraving apart from its plunge/ramp
      const shallow = read.moves.filter(
        (m) =>
          m.type !== 'rapid' &&
          m.to.z < 0 &&
          m.to.z > -1.5 + 1e-6 &&
          Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 1e-6,
      );
      expect(shallow).toEqual([]);
    },
  );

  it('a DXF line crossing the part edge is reported, not attached to the part', () => {
    const piece = (layer: string, vs: [number, number][], closed = false): DxfPath => ({
      layer,
      type: 'LINE',
      poly: { vertices: vs.map(([x, y]) => ({ x, y, bulge: 0 })), closed },
    });
    const j = joinPaths([
      piece(
        '0',
        [
          [100, 100],
          [400, 100],
          [400, 300],
          [100, 300],
        ],
        true,
      ),
      piece('GRAVUR', [
        [350, 150],
        [450, 150],
      ]),
      piece('GRAVUR', [
        [150, 150],
        [250, 150],
      ]),
    ]);
    const r = recognizeParts(j, { GRAVUR: 'online' });
    expect(r.parts[0]!.lines).toHaveLength(1);
    expect(r.lineOrphans).toHaveLength(1);
  });
});
