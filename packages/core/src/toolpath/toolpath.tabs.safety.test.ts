/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester review of the tabs (T015, spec 6.3 / 2.4, D-021, D-022), independent of the builder.
 *
 * Imports NO tab helper (no tabs.ts, no toolpath.testing.ts): it walks the move list of every
 * pass, finds the raised spans itself and checks them against an analytic rounded rectangle.
 * PO rules: tab height = material LEFT (top Z = -(thickness - h)), only passes deeper than the top
 * get tabs, raised span = width + tool diameter, none on corners/arcs, small part = area < 0.05 m2
 * or short side < 100 mm, small part with < 2 tabs = SMALL_PART_UNSECURED error.
 * Run count: env NITTCAM_RUNS (default 60).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultMachineProfile } from '../machine';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import type { Operation, ToolpathOptions, ToolpathResult } from './types';

const RUNS = Number(
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .NITTCAM_RUNS ?? 60,
);
const EPS = 1e-6;
const PLUNGE = 1500;
const FEED = 6000;

function mkProject(w: number, h: number, r: number, thickness: number, autoTabs: boolean): Project {
  const res = parseProject({
    schemaVersion: 1,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness,
      sheet: { width: 2440, height: 1220, grain: 0 },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'a',
        name: 'a',
        qty: 1,
        grainLock: false,
        kind: 'rect',
        params: { w, h, r },
        inners: [],
        holes: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 4, margin: 10 },
    layout: {
      sheets: [{ placements: [{ partId: 'a', index: 0, x: 100, y: 100, rot: 0, locked: false }] }],
    },
    cutting: { tabs: { auto: autoTabs }, leadIn: 'arc', direction: 'climb' },
  });
  if (!res.ok) throw new Error(JSON.stringify(res.issues));
  return res.project;
}
function mkMachine(o: { tool?: number; spoil?: number; pass?: number; thickness?: number }) {
  const m = defaultMachineProfile();
  return {
    ...m,
    safeZ: 20,
    zZero: { ...m.zZero, spoilboardAllowance: o.spoil ?? 0.3 },
    tools: [
      {
        number: 1,
        type: 'flatEndMill' as const,
        diameter: o.tool ?? 6,
        fluteLength: 50,
        flutes: 2,
      },
    ],
    materials: [
      {
        material: 'mdf' as const,
        thickness: o.thickness ?? 18,
        feed: FEED,
        plungeFeed: PLUNGE,
        rpm: 18000,
        stepDown: o.pass ?? 6.1,
        tool: 1,
      },
    ],
  };
}

interface Pt {
  x: number;
  y: number;
  z: number;
}
type AnyMove = Operation['segments'][number]['moves'][number];

/** Exact XY length of a move from `from`. */
function xyLen(from: Pt, m: AnyMove): number {
  if (m.kind === 'arc') {
    const r = Math.hypot(from.x - m.cx, from.y - m.cy);
    const a0 = Math.atan2(from.y - m.cy, from.x - m.cx);
    const a1 = Math.atan2(m.y - m.cy, m.x - m.cx);
    let d = a1 - a0;
    if (m.direction === 'ccw') while (d < -1e-9) d += 2 * Math.PI;
    else while (d > 1e-9) d -= 2 * Math.PI;
    return Math.abs(d) * r;
  }
  return Math.hypot(m.x - from.x, m.y - from.y);
}

/** Analytic rounded box of the part at (100,100), rot 0. */
interface Box {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  r: number;
}
const boxOf = (w: number, h: number, r: number): Box => ({
  cx: 100 + w / 2,
  cy: 100 + h / 2,
  hw: w / 2,
  hh: h / 2,
  r,
});
/** A tool-centre point on the straight (non-corner) part of the loop. */
function onStraight(b: Box, x: number, y: number, tol = 1e-6): boolean {
  const qx = Math.abs(x - b.cx) - (b.hw - b.r);
  const qy = Math.abs(y - b.cy) - (b.hh - b.r);
  return qx <= tol || qy <= tol;
}
/** On the corner arc of a rounded (r > EPS) outline corner, in the same quadrant as `ref`. */
function inCornerArc(b: Box, p: Pt, ref: Pt): boolean {
  const qx = Math.abs(p.x - b.cx) - (b.hw - b.r);
  const qy = Math.abs(p.y - b.cy) - (b.hh - b.r);
  const same =
    Math.sign(p.x - b.cx) === Math.sign(ref.x - b.cx) &&
    Math.sign(p.y - b.cy) === Math.sign(ref.y - b.cy);
  return b.r > 1e-3 && qx >= -1e-6 && qy >= -1e-6 && same;
}
function sdf(b: Box, x: number, y: number): number {
  const qx = Math.abs(x - b.cx) - (b.hw - b.r);
  const qy = Math.abs(y - b.cy) - (b.hh - b.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - b.r;
}

interface Span {
  s0: number; // arc length (XY) at the rise
  s1: number; // arc length at the descent
  from: Pt;
  to: Pt;
  z: number;
  topPts: Pt[];
}
interface PassInfo {
  total: number;
  spans: Span[];
}

interface Ctx {
  tool: number;
  thickness: number;
  spoil: number;
  box: Box;
  /** ramp mode: only generic checks. */
  ramp: boolean;
}

/** Walk the whole op, return violations and per-pass info. */
function walkOp(op: Operation, ctx: Ctx): { v: string[]; passes: PassInfo[] } {
  const v: string[] = [];
  const fail = (m: string) => v.length < 30 && v.push(`${op.id}: ${m}`);
  const target = -(ctx.thickness + ctx.spoil);
  const passes: PassInfo[] = [];
  let prev: Pt | null = null;
  for (const seg of op.segments) {
    const isPass = seg.role === 'pass';
    const k = seg.pass ?? -1;
    const d = isPass ? op.passDepths[k]! : 0;
    let s = 0;
    let state: 'flat' | 'top' = 'flat';
    let cur: Span | null = null;
    const info: PassInfo = { total: 0, spans: [] };
    for (const m of seg.moves) {
      if (m.z < target - EPS) fail(`move below target ${m.z} < ${target}`);
      if (prev && m.kind !== 'rapid' && m.z < prev.z - EPS && Math.abs(m.feed - PLUNGE) > EPS)
        fail(`descent at feed ${m.feed}`);
      if (isPass && !ctx.ramp && prev && m.kind !== 'rapid') {
        const vertical = Math.hypot(m.x - prev.x, m.y - prev.y) <= 1e-9;
        if (vertical && m.z > prev.z + EPS) {
          if (state !== 'flat') fail('rise while raised');
          if (Math.abs(m.feed - PLUNGE) > EPS) fail(`rise feed ${m.feed} != plunge`);
          if (Math.abs(prev.z - d) > EPS) fail(`rise from z ${prev.z}, pass depth ${d}`);
          state = 'top';
          cur = { s0: s, s1: s, from: { ...m }, to: { ...m }, z: m.z, topPts: [] };
        } else if (vertical && m.z < prev.z - EPS) {
          if (state === 'flat' && s === 0 && Math.abs(m.z - d) <= EPS) {
            // step-down plunge at the start of the pass: fine
          } else if (state !== 'top' || !cur) fail('vertical descent without a tab');
          else {
            if (m.kind !== 'plunge') fail(`tab descent kind ${m.kind}`);
            if (Math.abs(m.z - d) > EPS) fail(`tab descent ends at ${m.z}, pass ${d}`);
            cur.s1 = s;
            cur.to = { x: m.x, y: m.y, z: m.z };
            info.spans.push(cur);
            cur = null;
            state = 'flat';
          }
        } else if (state === 'top') {
          if (m.z !== prev.z) fail(`top move z ${m.z} != ${prev.z}`);
          if (m.kind !== 'linear') fail(`tab top move kind ${m.kind} (arc/corner?)`);
          if (Math.abs(m.feed - FEED) > EPS) fail(`tab crossed at feed ${m.feed} != cut feed`);
          cur?.topPts.push({ x: m.x, y: m.y, z: m.z });
        } else if (Math.abs(m.z - d) > EPS) fail(`flat move z ${m.z} != pass depth ${d}`);
      }
      if (prev && m.kind !== 'rapid') s += xyLen(prev, m);
      prev = { x: m.x, y: m.y, z: m.z };
    }
    if (isPass) {
      if (state !== 'flat') fail('pass ends raised');
      info.total = s;
      passes[k] = info;
    }
  }
  return { v, passes };
}

function smallPart(w: number, h: number, r: number): boolean {
  const area = w * h - (4 - Math.PI) * r * r;
  return area < 50_000 || Math.min(w, h) < 100;
}

function review(c: Case, res: ToolpathResult, ramp: boolean): string[] {
  const out: string[] = [];
  const op = res.toolpath.operations[0];
  if (!op) return ['no operation'];
  const ctx: Ctx = {
    tool: c.tool,
    thickness: c.thickness,
    spoil: c.spoil,
    box: boxOf(c.w, c.h, c.r),
    ramp,
  };
  const tabTop = -(c.thickness - c.height);
  const { v, passes } = walkOp(op, ctx);
  out.push(...v);
  const small = smallPart(c.w, c.h, c.r);
  const wanted = c.auto || small;
  const requested = small ? Math.max(c.count, 2) : c.count;
  const placed = op.tabs.length;

  // count / explanation
  const codes = [...res.warnings, ...res.errors].map((i) => i.code);
  if (!wanted) {
    if (placed !== 0) out.push(`tabs on a non-wanted part (${placed})`);
  } else if (placed < requested) {
    if (small && placed < 2) {
      if (!res.errors.some((e) => e.code === 'SMALL_PART_UNSECURED'))
        out.push('unsecured small part without error');
      if (res.ok) out.push('ok true with an unsecured small part');
    } else if (!codes.includes(placed === 0 ? 'TABS_NOT_PLACED' : 'TABS_REDUCED'))
      out.push(`placed ${placed}/${requested} without TABS_REDUCED/NOT_PLACED (${codes})`);
  } else if (placed > requested) out.push(`placed ${placed} > requested ${requested}`);
  if (small && placed >= 2 && res.errors.some((e) => e.code === 'SMALL_PART_UNSECURED'))
    out.push('SMALL_PART_UNSECURED although >= 2 tabs');
  if (small && !c.auto && !codes.includes('SMALL_PART_AUTO_TABS') && placed > 0)
    out.push('auto tabs on small part without SMALL_PART_AUTO_TABS');
  if (!small && res.errors.some((e) => e.code === 'SMALL_PART_UNSECURED'))
    out.push('SMALL_PART_UNSECURED on a normal part');

  if (ramp) return out;

  // per pass
  let ref: Span[] | null = null;
  op.passDepths.forEach((d, k) => {
    const info = passes[k]!;
    // builder treats a pass within EPS (1e-3, D-022) of the tab top as not deeper: skip that band
    if (Math.abs(d - tabTop) < 1.5e-3) return;
    const shouldHave = d < tabTop && placed > 0;
    if (!shouldHave) {
      if (info.spans.length !== 0) out.push(`pass ${k} (z ${d}) above tab top ${tabTop} has tabs`);
      return;
    }
    if (info.spans.length !== placed)
      out.push(`pass ${k}: ${info.spans.length} spans, ${placed} tabs`);
    const first = ref;
    if (first) {
      info.spans.forEach((sp, i) => {
        const q = first[i];
        if (!q || Math.hypot(sp.from.x - q.from.x, sp.from.y - q.from.y) > 1e-9)
          out.push(`pass ${k}: tab ${i} not at the same XY as on the first tabbed pass`);
      });
    }
    ref ??= info.spans;
    const centres: number[] = [];
    for (const sp of info.spans) {
      // bridge left in the material
      if (Math.abs(c.thickness - Math.abs(sp.z) - c.height) > 1e-9)
        out.push(`bridge ${c.thickness - Math.abs(sp.z)} != h ${c.height}`);
      if (Math.abs(sp.z - tabTop) > 1e-9) out.push(`tab z ${sp.z} != ${tabTop}`);
      // raised length along the path = w + D
      const len = sp.s1 - sp.s0;
      if (Math.abs(len - (c.width + c.tool)) > 1e-5) out.push(`raised length ${len}`);
      // straight, away from corners, on the tool path
      const pts = [sp.from, ...sp.topPts, sp.to];
      // T272: a span may instead lie wholly on one rounded corner arc of the outline (radius > EPS;
      // a sharp corner is never used), when no tab fits on the straight sides.
      const arcSpan = pts.every((p) => inCornerArc(ctx.box, p, pts[0]!));
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        if (!arcSpan && !onStraight(ctx.box, p.x, p.y))
          out.push(`tab point ${p.x},${p.y} in a corner zone`);
        if (Math.abs(sdf(ctx.box, p.x, p.y) - c.tool / 2) > 1e-3)
          out.push(`tab point not on the tool path (${sdf(ctx.box, p.x, p.y)})`);
        if (i > 0) {
          const a = pts[i - 1]!;
          for (let t = 0.1; t < 1; t += 0.2) {
            const mx = a.x + (p.x - a.x) * t;
            const my = a.y + (p.y - a.y) * t;
            if (!onStraight(ctx.box, mx, my)) out.push('tab chord crosses a corner zone');
          }
        }
      }
      centres.push((sp.s0 + sp.s1) / 2);
    }
    // even spacing by arc length (incl. wrap-around)
    if (centres.length > 1) {
      const sp = info.total / centres.length;
      for (let i = 1; i < centres.length; i++)
        if (Math.abs(centres[i]! - centres[i - 1]! - sp) > 1e-3)
          out.push(`spacing ${centres[i]! - centres[i - 1]!} != ${sp}`);
      const wrap = info.total - (centres[centres.length - 1]! - centres[0]!);
      if (Math.abs(wrap - sp) > 1e-3) out.push(`wrap spacing ${wrap} != ${sp}`);
    }
  });
  return out;
}

const caseArb = fc
  .record({
    w: fc.double({ min: 20, max: 700, noNaN: true }),
    h: fc.double({ min: 20, max: 500, noNaN: true }),
    rFrac: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 1, noNaN: true })),
    tool: fc.double({ min: 3, max: 12, noNaN: true }),
    thickness: fc.double({ min: 3, max: 30, noNaN: true }),
    hFrac: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
    spoil: fc.double({ min: 0, max: 1, noNaN: true }),
    pass: fc.double({ min: 1, max: 10, noNaN: true }),
    count: fc.integer({ min: 1, max: 8 }),
    width: fc.double({ min: 2, max: 40, noNaN: true }),
    auto: fc.boolean(),
    leadIn: fc.constantFrom('arc' as const, 'line' as const, 'none' as const),
    ramp: fc.option(fc.double({ min: 1, max: 30, noNaN: true }), { nil: undefined }),
    direction: fc.constantFrom('climb' as const, 'conventional' as const),
  })
  .map((x) => ({
    ...x,
    r: (x.rFrac * Math.min(x.w, x.h)) / 2,
    height: x.hFrac * x.thickness,
  }));
type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

function run(c: Case) {
  const project = mkProject(c.w, c.h, c.r, c.thickness, c.auto);
  const machine = mkMachine({ tool: c.tool, spoil: c.spoil, pass: c.pass, thickness: c.thickness });
  const options: ToolpathOptions = {
    lead: c.leadIn,
    direction: c.direction,
    tabs: { auto: c.auto, count: c.count, width: c.width, height: c.height },
    ...(c.ramp !== undefined ? { plunge: { type: 'ramp' as const, angleDeg: c.ramp } } : {}),
  };
  return { project, machine, options, res: buildToolpath(project, machine, options) };
}

describe('independent tab review: random single parts', () => {
  it('tabs: depth, bridge, width, straight, spacing, feeds, count, passes (walk of the move list)', () => {
    let withTabs = 0;
    fc.assert(
      fc.property(caseArb, (c) => {
        const { res } = run(c);
        expect(res.errors.map((e) => e.code).filter((x) => x !== 'SMALL_PART_UNSECURED')).toEqual(
          [],
        );
        if ((res.toolpath.operations[0]?.tabs.length ?? 0) > 0) withTabs++;
        expect(review(c, res, c.ramp !== undefined)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
    expect(withTabs).toBeGreaterThan(0);
  }, 600_000);

  it('deterministic', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const a = run(c);
        const b = run(JSON.parse(JSON.stringify(c)) as Case);
        expect(b.res).toEqual(a.res);
      }),
      { numRuns: Math.max(10, Math.floor(RUNS / 2)) },
    );
  }, 600_000);
});

describe('tab hand cases', () => {
  const build = (
    w: number,
    h: number,
    o: { tool?: number; tabs?: ToolpathOptions['tabs']; thickness?: number; pass?: number } = {},
  ) => {
    const thickness = o.thickness ?? 18;
    const project = mkProject(w, h, 0, thickness, false);
    const machine = mkMachine({
      thickness,
      ...(o.tool !== undefined ? { tool: o.tool } : {}),
      ...(o.pass !== undefined ? { pass: o.pass } : {}),
    });
    return { project, res: buildToolpath(project, machine, o.tabs ? { tabs: o.tabs } : {}) };
  };
  const ctxOf = (w: number, h: number, thickness = 18, tool = 6): Ctx => ({
    tool,
    thickness,
    spoil: 0.3,
    box: boxOf(w, h, 0),
    ramp: false,
  });

  it('D-022 600x400: tab top -15.0, only the -18.3 pass has tabs, 4 listed centres', () => {
    const { res } = build(600, 400, { tabs: { auto: true, count: 4, width: 10, height: 3 } });
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([]);
    const op = res.toolpath.operations[0]!;
    expect(op.passDepths).toHaveLength(3);
    expect(op.passDepths[2]).toBe(-18.3);
    const { v, passes } = walkOp(op, ctxOf(600, 400));
    expect(v).toEqual([]);
    expect(passes[0]!.spans).toHaveLength(0);
    expect(passes[1]!.spans).toHaveLength(0);
    const spans = passes[2]!.spans;
    expect(spans).toHaveLength(4);
    const phase = (3 * Math.SQRT2 + 203) / 2;
    const want = [
      [400 - phase, 97],
      [97, 100 + phase + 200],
      [100 + phase + 300, 503],
      [703, 500 - phase - 200],
    ];
    spans.forEach((sp, i) => {
      expect(sp.z).toBe(-15);
      expect((sp.from.x + sp.to.x) / 2).toBeCloseTo(want[i]![0]!, 6);
      expect((sp.from.y + sp.to.y) / 2).toBeCloseTo(want[i]![1]!, 6);
      expect(sp.s1 - sp.s0).toBeCloseTo(16, 9);
    });
    expect(want[0]![0]).toBeCloseTo(296.379, 3);
    expect(want[1]![1]).toBeCloseTo(403.621, 3);
    expect(want[2]![0]).toBeCloseTo(503.621, 3);
    expect(want[3]![1]).toBeCloseTo(196.379, 3);
  });

  it('80x80 with tabs off: auto tabs and a SMALL_PART_AUTO_TABS warning', () => {
    const { res } = build(80, 80);
    expect(res.ok).toBe(true);
    expect(res.warnings.map((w) => w.code)).toContain('SMALL_PART_AUTO_TABS');
    const op = res.toolpath.operations[0]!;
    expect(op.tabs.length).toBeGreaterThanOrEqual(2);
    const { v, passes } = walkOp(op, ctxOf(80, 80));
    expect(v).toEqual([]);
    expect(passes[2]!.spans.length).toBe(op.tabs.length);
  });

  it('30x30 with tool 6: default width 10 fits 2 tabs (TABS_REDUCED); width 25 -> SMALL_PART_UNSECURED', () => {
    const fits = build(30, 30);
    expect(fits.res.ok).toBe(true);
    expect(fits.res.toolpath.operations[0]!.tabs).toHaveLength(2);
    expect(fits.res.warnings.map((w) => w.code)).toEqual(['SMALL_PART_AUTO_TABS', 'TABS_REDUCED']);
    const { res } = build(30, 30, { tabs: { width: 25 } });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('SMALL_PART_UNSECURED');
    expect(res.toolpath.operations[0]!.tabs).toEqual([]);
  });

  it('INVALID_TAB: h >= thickness, h = 0, negative', () => {
    for (const height of [18, 18.0001, 25, 0, -1, 17.9999]) {
      const { res } = build(600, 400, { tabs: { auto: true, height } });
      expect(res.ok, `h=${height}`).toBe(false);
      expect(res.errors.map((e) => e.code)).toContain('INVALID_TAB');
    }
    const ok = build(600, 400, { tabs: { auto: true, height: 17.99 } });
    expect(ok.res.errors).toEqual([]);
  });

  it('thickness 6, pass 6.3, h 3: a single pass with tabs at -3.0', () => {
    const { res } = build(300, 200, {
      thickness: 6,
      pass: 6.3,
      tabs: { auto: true, count: 4, width: 10, height: 3 },
    });
    expect(res.ok).toBe(true);
    const op = res.toolpath.operations[0]!;
    expect(op.passDepths).toHaveLength(1);
    expect(op.passDepths[0]).toBe(-6.3);
    const { v, passes } = walkOp(op, ctxOf(300, 200, 6));
    expect(v).toEqual([]);
    expect(passes[0]!.spans).toHaveLength(4);
    for (const sp of passes[0]!.spans) expect(sp.z).toBe(-3);
  });

  it('small-part boundary: short side 99.9 small, 100.0 not; area 50000 not small', () => {
    const codesOf = (w: number, h: number) => build(w, h).res.warnings.map((x) => x.code);
    expect(codesOf(99.9, 600)).toContain('SMALL_PART_AUTO_TABS');
    expect(codesOf(100, 600)).not.toContain('SMALL_PART_AUTO_TABS');
    expect(build(100, 600).res.toolpath.operations[0]!.tabs).toEqual([]);
    expect(build(99.9, 600).res.toolpath.operations[0]!.tabs.length).toBeGreaterThanOrEqual(2);
    // area boundary (short side 200 >= 100): 250x200 = 50000 not small, 249.9x200 small
    expect(codesOf(250, 200)).not.toContain('SMALL_PART_AUTO_TABS');
    expect(codesOf(249.9, 200)).toContain('SMALL_PART_AUTO_TABS');
  });

  it('determinism of a hand case', () => {
    const a = build(600, 400, { tabs: { auto: true } }).res;
    const b = build(600, 400, { tabs: { auto: true } }).res;
    expect(b).toEqual(a);
  });
});
