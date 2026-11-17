/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester's independent safety review of the toolpath (T014, spec §7.2 at toolpath level).
 *
 * The checker below imports NO toolpath helper: it only walks the move list. Part outlines are an
 * analytic rounded-rectangle signed distance (not the builder's offset/outline code).
 * Run count: env NITTCAM_RUNS (default 60).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultMachineProfile } from '../machine';
import { nestProject } from '../nesting';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import type { Toolpath, ToolpathOptions, ToolpathResult } from './types';

const EPS = 1e-6;
const RUNS = Number(
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .NITTCAM_RUNS ?? 60,
);

// ---------- builders (own copies) ----------
interface RectSpec {
  id: string;
  w: number;
  h: number;
  r?: number;
  qty?: number;
}
interface PlSpec {
  partId: string;
  index: number;
  x: number;
  y: number;
  rot: 0 | 90 | 180 | 270;
}
function mkProject(o: {
  parts: RectSpec[];
  sheet?: { width: number; height: number };
  thickness?: number;
  gap?: number;
  margin?: number;
  placements?: PlSpec[][];
  direction?: 'climb' | 'conventional';
}): Project {
  const r = parseProject({
    schemaVersion: 1,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: o.thickness ?? 18,
      sheet: { ...(o.sheet ?? { width: 2440, height: 1220 }), grain: 0 },
      useOffcuts: false,
    },
    parts: o.parts.map((p) => ({
      id: p.id,
      name: p.id,
      qty: p.qty ?? 1,
      grainLock: false,
      kind: 'rect',
      params: { w: p.w, h: p.h, r: p.r ?? 0 },
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    })),
    nesting: { mode: 'minWaste', gap: o.gap ?? 4, margin: o.margin ?? 10 },
    layout: {
      sheets: (o.placements ?? []).map((pls) => ({
        placements: pls.map((p) => ({ ...p, locked: false })),
      })),
    },
    cutting: { tabs: { auto: false }, leadIn: 'arc', direction: o.direction ?? 'climb' },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}
function mkMachine(o: {
  tool?: number;
  flute?: number;
  spoil?: number;
  pass?: number;
  thickness?: number;
  safeZ?: number;
  materials?: boolean;
}) {
  const m = defaultMachineProfile();
  return {
    ...m,
    safeZ: o.safeZ ?? 20,
    zZero: { ...m.zZero, spoilboardAllowance: o.spoil ?? 0.3 },
    tools: [
      {
        number: 1,
        type: 'flatEndMill' as const,
        diameter: o.tool ?? 6,
        fluteLength: o.flute ?? 50,
        flutes: 2,
      },
    ],
    materials:
      o.materials === false
        ? []
        : [
            {
              material: 'mdf' as const,
              thickness: o.thickness ?? 18,
              feed: 6000,
              plungeFeed: 1500,
              rpm: 18000,
              stepDown: o.pass ?? 6.1,
              tool: 1,
            },
          ],
  };
}

// ---------- independent geometry ----------
interface Box {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  r: number;
}
/** Placed rect parts as analytic rounded boxes (rot 90/270 swap w/h; bbox min at (x, y)). */
function boxes(project: Project, sheet: number): { id: string; copy: number; b: Box }[] {
  return project.layout.sheets[sheet]!.placements.map((pl) => {
    const part = project.parts.find((p) => p.id === pl.partId)!;
    if (part.kind !== 'rect') throw new Error('rect only');
    const turned = pl.rot === 90 || pl.rot === 270;
    const w = turned ? part.params.h : part.params.w;
    const h = turned ? part.params.w : part.params.h;
    return {
      id: pl.partId,
      copy: pl.index,
      b: { cx: pl.x + w / 2, cy: pl.y + h / 2, hw: w / 2, hh: h / 2, r: part.params.r },
    };
  });
}
/** Signed distance to the outline: > 0 outside, < 0 inside. */
function sdf(b: Box, x: number, y: number): number {
  const qx = Math.abs(x - b.cx) - (b.hw - b.r);
  const qy = Math.abs(y - b.cy) - (b.hh - b.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - b.r;
}

interface Pt {
  x: number;
  y: number;
  z: number;
}
type AnyMove = Toolpath['operations'][number]['segments'][number]['moves'][number];
/** Sample a move from `from`: lines and arcs (centre/direction), z linear along the path. */
function sample(from: Pt, m: AnyMove): Pt[] {
  const out: Pt[] = [];
  if (m.kind === 'arc') {
    const r = Math.hypot(from.x - m.cx, from.y - m.cy);
    const a0 = Math.atan2(from.y - m.cy, from.x - m.cx);
    const a1 = Math.atan2(m.y - m.cy, m.x - m.cx);
    let d = a1 - a0;
    if (m.direction === 'ccw') while (d < -1e-9) d += 2 * Math.PI;
    else while (d > 1e-9) d -= 2 * Math.PI;
    const n = Math.max(2, Math.ceil((Math.abs(d) * r) / 0.25));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push({
        x: m.cx + r * Math.cos(a0 + d * t),
        y: m.cy + r * Math.sin(a0 + d * t),
        z: from.z + (m.z - from.z) * t,
      });
    }
    return out;
  }
  const len = Math.hypot(m.x - from.x, m.y - from.y);
  const n = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      x: from.x + (m.x - from.x) * t,
      y: from.y + (m.y - from.y) * t,
      z: from.z + (m.z - from.z) * t,
    });
  }
  return out;
}

interface Params {
  tool: number;
  thickness: number;
  spoil: number;
  pass: number;
  plungeFeed: number;
  safeZ: number;
  direction: 'climb' | 'conventional';
  margin: number;
  sheetW: number;
  sheetH: number;
}

/** The independent §7.2 walker. Returns violation strings (empty = safe). */
function review(project: Project, res: ToolpathResult, p: Params): string[] {
  const v: string[] = [];
  const tp = res.toolpath;
  const tr = p.tool / 2;
  const target = -(p.thickness + p.spoil);
  const fail = (m: string) => v.length < 40 && v.push(m);

  // no NaN/Infinity/undefined anywhere in the toolpath
  const walk = (o: unknown, path: string) => {
    if (typeof o === 'number' && !Number.isFinite(o)) fail(`non-finite at ${path}`);
    else if (o === undefined) fail(`undefined at ${path}`);
    else if (o && typeof o === 'object')
      for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`);
  };
  walk(tp, 'tp');
  if (tp.safeZ !== p.safeZ) fail(`safeZ ${tp.safeZ}`);
  if (Math.abs(tp.targetDepth - target) > EPS) fail(`targetDepth ${tp.targetDepth} != ${target}`);
  if (!(tp.clearanceZ >= 0 && tp.clearanceZ <= tp.safeZ)) fail(`clearanceZ ${tp.clearanceZ}`);

  let pos: Pt | null = null;
  for (const op of tp.operations) {
    const label = op.id;
    const all = boxes(project, op.sheet);
    const own = all.find((b) => b.id === op.partId && b.copy === op.copy)!;
    const others = all.filter((b) => b !== own);
    const moves = op.segments.flatMap((s) => s.moves.map((m) => ({ m, role: s.role, seg: s })));
    if (moves.length === 0) {
      fail(`${label}: no moves`);
      continue;
    }
    // first move: goes to safe Z, or already at safe Z
    const first = moves[0]!.m;
    const alreadySafe = pos !== null && Math.abs(pos.z - tp.safeZ) <= EPS;
    if (!alreadySafe && !(first.kind === 'rapid' && Math.abs(first.z - tp.safeZ) <= EPS))
      fail(`${label}: first move is not to safe Z (${first.kind} z=${first.z})`);

    let minZ = 0;
    const windings = new Map<number, number>();
    let lastZ = Number.NaN;
    for (const { m, role, seg } of moves) {
      const prev: Pt | null = pos;
      if (m.kind === 'rapid') {
        if (prev) {
          const xyChange = Math.hypot(m.x - prev.x, m.y - prev.y) > EPS;
          if (xyChange && !(Math.abs(prev.z - tp.safeZ) <= EPS && Math.abs(m.z - tp.safeZ) <= EPS))
            fail(`${label}: XY rapid not at safe Z (z ${prev.z} -> ${m.z})`);
          if (m.z < tp.clearanceZ - EPS && m.z < prev.z - EPS)
            fail(`${label}: rapid descends below clearance (z ${prev.z} -> ${m.z})`);
        } else if (Math.abs(m.z - tp.safeZ) > EPS) fail(`${label}: first rapid not at safe Z`);
      } else {
        if (!(Number.isFinite(m.feed) && m.feed > 0)) fail(`${label}: bad feed ${m.feed}`);
        if (prev && m.z < prev.z - EPS && Math.abs(m.feed - p.plungeFeed) > EPS)
          fail(`${label}: descending ${m.kind} at feed ${m.feed} != plunge ${p.plungeFeed}`);
        if (prev) {
          const pts = sample(prev, m);
          for (const q of pts) {
            const d = sdf(own.b, q.x, q.y);
            if (role === 'pass') {
              if (Math.abs(d - tr) > 1e-3)
                fail(
                  `${label}: pass point ${q.x.toFixed(3)},${q.y.toFixed(3)} z=${q.z.toFixed(2)} is ${d.toFixed(5)} from part (want ${tr})`,
                );
            } else if (role === 'leadIn' || role === 'leadOut' || role === 'approach') {
              if (d < tr - 1e-3)
                fail(`${label}: ${role} point ${d.toFixed(4)} from part < tool radius`);
            }
            for (const o of others) {
              const dn = sdf(o.b, q.x, q.y);
              if (dn < tr - 1e-3 && q.z < tp.clearanceZ)
                fail(
                  `${label}: ${role} point ${dn.toFixed(4)} from neighbour ${o.id}#${o.copy} < tool radius`,
                );
            }
            if (role === 'leadIn' || role === 'leadOut') {
              const lo = Math.min(0, p.margin - tr) - 1e-3;
              if (q.x < lo || q.y < lo || q.x > p.sheetW - lo || q.y > p.sheetH - lo)
                fail(`${label}: ${role} leaves the sheet (${q.x.toFixed(2)},${q.y.toFixed(2)})`);
            }
          }
          if (role === 'pass') {
            const sg = seg.pass ?? -1;
            let w = windings.get(sg) ?? 0;
            for (let i = 1; i < pts.length; i++) {
              let dA =
                Math.atan2(pts[i]!.y - own.b.cy, pts[i]!.x - own.b.cx) -
                Math.atan2(pts[i - 1]!.y - own.b.cy, pts[i - 1]!.x - own.b.cx);
              while (dA > Math.PI) dA -= 2 * Math.PI;
              while (dA < -Math.PI) dA += 2 * Math.PI;
              w += dA;
            }
            windings.set(sg, w);
          }
        }
        if (m.z > EPS) fail(`${label}: feed move above material top z=${m.z}`);
      }
      if (m.z < minZ) minZ = m.z;
      pos = { x: m.x, y: m.y, z: m.z };
      lastZ = m.z;
    }
    if (minZ < target - EPS) fail(`${label}: below target (${minZ} < ${target})`);
    if (minZ !== target) fail(`${label}: deepest z ${minZ} is not exactly the target ${target}`);
    if (Math.abs(lastZ - tp.safeZ) > EPS) fail(`${label}: does not end at safe Z`);
    const depths = op.passDepths;
    if (depths[depths.length - 1] !== tp.targetDepth) fail(`${label}: last passDepth != target`);
    for (let i = 0; i < depths.length; i++) {
      const prevD = i === 0 ? 0 : depths[i - 1]!;
      if (!(depths[i]! < prevD) || prevD - depths[i]! > p.pass + 0.0011)
        fail(`${label}: pass step ${prevD} -> ${depths[i]} vs pass depth ${p.pass}`);
    }
    // climb = CW (negative winding), conventional = CCW; the last pass is a full loop
    const finalW = windings.get(depths.length - 1);
    if (finalW === undefined || Math.abs(Math.abs(finalW) - 2 * Math.PI) > 0.05)
      fail(`${label}: final pass winding ${finalW}`);
    else if (finalW < 0 !== (p.direction === 'climb'))
      fail(`${label}: ${p.direction} travelled with winding ${finalW}`);
  }
  return v;
}

// ---------- random cases ----------
const partArb = (i: number) =>
  fc
    .record({
      w: fc.double({ min: 20, max: 500, noNaN: true }),
      h: fc.double({ min: 20, max: 300, noNaN: true }),
      rFrac: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 1, noNaN: true })),
      qty: fc.integer({ min: 1, max: 3 }),
    })
    .map(({ w, h, rFrac, qty }) => ({ id: `p${i}`, w, h, r: (rFrac * Math.min(w, h)) / 2, qty }));
const caseArb = fc.record({
  parts: fc
    .integer({ min: 1, max: 5 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i)))),
  gap: fc.double({ min: 0, max: 10, noNaN: true }),
  margin: fc.double({ min: 0, max: 20, noNaN: true }),
  tool: fc.double({ min: 3, max: 12, noNaN: true }),
  thickness: fc.double({ min: 3, max: 30, noNaN: true }),
  spoil: fc.double({ min: 0, max: 1, noNaN: true }),
  pass: fc.double({ min: 1, max: 10, noNaN: true }),
  lead: fc.constantFrom('arc' as const, 'line' as const, 'none' as const),
  leadLength: fc.option(fc.double({ min: 0.5, max: 20, noNaN: true }), { nil: undefined }),
  ramp: fc.option(fc.double({ min: 1, max: 30, noNaN: true }), { nil: undefined }),
  clearance: fc.option(fc.double({ min: 0.1, max: 30, noNaN: true }), { nil: undefined }),
  direction: fc.constantFrom('climb' as const, 'conventional' as const),
});
type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

function run(c: Case) {
  const base = mkProject({ parts: c.parts, gap: c.gap, margin: c.margin, thickness: c.thickness });
  const nested = nestProject(base, { toolDiameter: c.tool });
  const project: Project = { ...base, layout: nested.layout };
  const machine = mkMachine({ tool: c.tool, spoil: c.spoil, pass: c.pass, thickness: c.thickness });
  const options: ToolpathOptions = {
    lead: c.lead,
    direction: c.direction,
    ...(c.leadLength !== undefined ? { leadLength: c.leadLength } : {}),
    ...(c.ramp !== undefined ? { plunge: { type: 'ramp' as const, angleDeg: c.ramp } } : {}),
    ...(c.clearance !== undefined ? { clearance: c.clearance } : {}),
  };
  const res = buildToolpath(project, machine, options);
  const params: Params = {
    tool: c.tool,
    thickness: c.thickness,
    spoil: c.spoil,
    pass: c.pass,
    plungeFeed: 1500,
    safeZ: 20,
    direction: c.direction,
    margin: c.margin,
    sheetW: 2440,
    sheetH: 1220,
  };
  return { project, machine, options, res, params, placed: nested.layout.sheets.length > 0 };
}

describe('independent §7.2 review: random projects', () => {
  it('no violations on any random project (walk of the move list)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, res, params, placed } = run(c);
        fc.pre(placed);
        // T015 (D-022): SMALL_PART_UNSECURED (a small part with no room for 2 tabs) is the only
        // legitimate error on random projects; its operation is still walked below
        expect(res.errors.map((e) => e.code).filter((c) => c !== 'SMALL_PART_UNSECURED')).toEqual(
          [],
        );
        expect(review(project, res, params)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('deterministic: deep-equal toolpath for the same input', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const a = run(c);
        const b = run(JSON.parse(JSON.stringify(c)) as Case);
        expect(b.res).toEqual(a.res);
        expect(buildToolpath(a.project, a.machine, a.options)).toEqual(a.res);
      }),
      { numRuns: Math.max(10, Math.floor(RUNS / 2)) },
    );
  }, 600_000);
});

// ---------- hand-computed ----------
const P = (
  partId: string,
  index: number,
  x: number,
  y: number,
  rot: 0 | 90 | 180 | 270 = 0,
): PlSpec => ({ partId, index, x, y, rot });
function paramsOf(o: Partial<Params>): Params {
  return {
    tool: 6,
    thickness: 18,
    spoil: 0.3,
    pass: 6.1,
    plungeFeed: 1500,
    safeZ: 20,
    direction: 'climb',
    margin: 10,
    sheetW: 2440,
    sheetH: 1220,
    ...o,
  };
}
const codes = (r: ToolpathResult, k: 'errors' | 'warnings') => r[k].map((i) => i.code);
const one = (w: number, h: number, extra: Partial<Parameters<typeof mkProject>[0]> = {}) =>
  mkProject({
    parts: [{ id: 'a', w, h }],
    placements: [[P('a', 0, 100, 100)]],
    ...extra,
  });

describe('hand-computed cases', () => {
  it('dev example 100x50: passes -6.1/-12.2/-18.3, loop 97..203 x 97..153, length 300 + 6 pi', () => {
    const project = one(100, 50);
    const res = buildToolpath(project, mkMachine({}));
    expect(res.ok).toBe(true);
    const op = res.toolpath.operations[0]!;
    expect(op.passDepths).toHaveLength(3);
    expect(op.passDepths[0]).toBeCloseTo(-6.1, 9);
    expect(op.passDepths[1]).toBeCloseTo(-12.2, 9);
    expect(op.passDepths[2]).toBe(-18.3);
    let prev: Pt | null = null;
    let len = 0;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const s of op.segments)
      for (const m of s.moves) {
        if (s.role === 'pass' && s.pass === 2 && prev) {
          const pts = sample(prev, m);
          for (let i = 0; i < pts.length; i++) {
            xs.push(pts[i]!.x);
            ys.push(pts[i]!.y);
            if (i) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
          }
        }
        prev = { x: m.x, y: m.y, z: m.z };
      }
    expect(Math.min(...xs)).toBeCloseTo(97, 3);
    expect(Math.max(...xs)).toBeCloseTo(203, 3);
    expect(Math.min(...ys)).toBeCloseTo(97, 3);
    expect(Math.max(...ys)).toBeCloseTo(153, 3);
    expect(len).toBeGreaterThan(300 + 6 * Math.PI - 0.2);
    expect(len).toBeLessThan(300 + 6 * Math.PI + 1);
    expect(review(project, res, paramsOf({}))).toEqual([]);
  });

  it('thin 600x20 strip: loop 606x26, starts mid long edge, safe both directions', () => {
    const project = mkProject({
      parts: [{ id: 's', w: 600, h: 20 }],
      placements: [[P('s', 0, 50, 50)]],
    });
    for (const direction of ['climb', 'conventional'] as const) {
      const res = buildToolpath(project, mkMachine({}), { direction });
      expect(res.ok).toBe(true);
      expect(review(project, res, paramsOf({ direction }))).toEqual([]);
      const op = res.toolpath.operations[0]!;
      const lead = op.segments.find((s) => s.role === 'leadIn')!;
      const end = lead.moves[lead.moves.length - 1]!;
      expect(end.x).toBeCloseTo(350, 3);
      expect([47, 73].some((y) => Math.abs(end.y - y) < 1e-3)).toBe(true);
    }
  });

  it('flush with a 0-margin sheet edge: leaving lead is shortened or removed, with a warning', () => {
    const project = mkProject({
      parts: [{ id: 'a', w: 100, h: 50 }],
      sheet: { width: 100, height: 50 },
      margin: 0,
      placements: [[P('a', 0, 0, 0)]],
    });
    for (const lead of ['arc', 'line'] as const) {
      const res = buildToolpath(project, mkMachine({}), { lead, leadLength: 10 });
      expect(res.ok).toBe(true);
      expect(
        codes(res, 'warnings').some((c) => c === 'LEAD_SHORTENED' || c === 'LEAD_REMOVED'),
      ).toBe(true);
      expect(review(project, res, paramsOf({ margin: 0, sheetW: 100, sheetH: 50 }))).toEqual([]);
    }
  });

  it('two parts at minimum spacing (tool + gap): leads and passes keep clear of the neighbour', () => {
    for (const direction of ['climb', 'conventional'] as const) {
      for (const lead of ['arc', 'line'] as const) {
        for (const rot of [0, 90] as const) {
          const project = mkProject({
            parts: [
              { id: 'a', w: 50, h: 100 },
              { id: 'b', w: 50, h: 100 },
            ],
            gap: 4,
            placements: [
              rot === 0
                ? [P('a', 0, 10, 10), P('b', 0, 70, 10)]
                : [P('a', 0, 10, 10, 90), P('b', 0, 10, 80, 90)],
            ],
          });
          const res = buildToolpath(project, mkMachine({}), { lead, direction, leadLength: 6 });
          expect(res.ok).toBe(true);
          expect(review(project, res, paramsOf({ direction }))).toEqual([]);
        }
      }
    }
    const base = mkProject({ parts: [{ id: 'a', w: 80, h: 80, qty: 6 }], gap: 0 });
    const nested = nestProject(base, { toolDiameter: 6 });
    const project: Project = { ...base, layout: nested.layout };
    for (const lead of ['arc', 'line'] as const) {
      const res = buildToolpath(project, mkMachine({}), { lead, leadLength: 12 });
      expect(res.ok).toBe(true);
      expect(review(project, res, paramsOf({}))).toEqual([]);
    }
  });

  it('thickness an exact multiple of the pass depth: 18 / 6 = exactly 3 passes, last at -18', () => {
    const project = one(100, 50);
    const res = buildToolpath(project, mkMachine({ spoil: 0, pass: 6 }));
    expect(res.toolpath.operations[0]!.passDepths).toEqual([-6, -12, -18]);
    const r2 = buildToolpath(project, mkMachine({ spoil: 0.3, pass: 6 }));
    expect(r2.toolpath.operations[0]!.passDepths).toHaveLength(4);
    expect(r2.toolpath.operations[0]!.passDepths.at(-1)).toBe(-18.3);
    for (const [t, d] of [
      [19.8, 6.6],
      [9, 0.9],
      [13.5, 4.5],
      [27, 9],
      [22.5, 7.5],
      [3.3, 1.1],
    ] as const) {
      const pr = one(100, 50, { thickness: t });
      const rr = buildToolpath(pr, mkMachine({ spoil: 0, pass: d, thickness: t }));
      expect(rr.toolpath.operations[0]!.passDepths.length, `${t}/${d}`).toBe(Math.round(t / d));
    }
  });

  it('pass depth > total depth: 1 pass at the target', () => {
    const res = buildToolpath(one(100, 50), mkMachine({ pass: 40 }));
    expect(res.toolpath.operations[0]!.passDepths).toEqual([-18.3]);
    expect(review(one(100, 50), res, paramsOf({ pass: 40 }))).toEqual([]);
  });

  it('missing cutting params: NO_CUTTING_PARAMS, ok=false, no throw', () => {
    const project = one(100, 50);
    let res!: ToolpathResult;
    expect(() => (res = buildToolpath(project, mkMachine({ materials: false })))).not.toThrow();
    expect(res.ok).toBe(false);
    expect(codes(res, 'errors')).toContain('NO_CUTTING_PARAMS');
    const r2 = buildToolpath(project, mkMachine({ thickness: 12 }));
    expect(r2.ok).toBe(false);
    expect(codes(r2, 'errors')).toContain('NO_CUTTING_PARAMS');
    const r3 = buildToolpath(project, mkMachine({ materials: false }), { cutting: { feed: 5000 } });
    expect(r3.ok).toBe(false);
  });

  it('depth > flute length: DEPTH_EXCEEDS_FLUTE_LENGTH (exactly at the limit is fine)', () => {
    const project = one(100, 50);
    const res = buildToolpath(project, mkMachine({ flute: 18 }));
    expect(res.ok).toBe(false);
    expect(codes(res, 'errors')).toContain('DEPTH_EXCEEDS_FLUTE_LENGTH');
    const ok = buildToolpath(project, mkMachine({ flute: 18.3 }));
    expect(codes(ok, 'errors')).not.toContain('DEPTH_EXCEEDS_FLUTE_LENGTH');
  });

  it('invalid numeric options never produce an ok toolpath with NaN/Infinity/non-positive feeds', () => {
    const project = one(100, 50);
    const cuttings = [
      { feed: NaN },
      { feed: Infinity },
      { feed: 0 },
      { feed: -5 },
      { plungeFeed: 0 },
      { passDepth: 0 },
      { passDepth: NaN },
      { rpm: -1 },
    ];
    for (const cutting of cuttings) {
      const res = buildToolpath(project, mkMachine({}), { cutting });
      if (res.ok) expect(review(project, res, paramsOf({})), JSON.stringify(cutting)).toEqual([]);
    }
    const optionSets: ToolpathOptions[] = [
      { leadLength: NaN },
      { leadLength: -3 },
      { clearance: NaN },
      { clearance: -1 },
      { plunge: { type: 'ramp', angleDeg: 0 } },
      { plunge: { type: 'ramp', angleDeg: 90 } },
      { plunge: { type: 'ramp', length: 0 } },
    ];
    for (const options of optionSets) {
      let res!: ToolpathResult;
      expect(() => (res = buildToolpath(project, mkMachine({}), options))).not.toThrow();
      if (res.ok) expect(review(project, res, paramsOf({})), JSON.stringify(options)).toEqual([]);
    }
  });
});

describe('the independent checker is sensitive (tampered toolpaths are flagged)', () => {
  const base = () => {
    const project = one(100, 50);
    const res = buildToolpath(project, mkMachine({}));
    return { project, res: JSON.parse(JSON.stringify(res)) as ToolpathResult };
  };
  const first = (res: ToolpathResult) => res.toolpath.operations[0]!;
  const cases: [string, (r: ToolpathResult) => void, RegExp][] = [
    [
      'XY rapid below safe Z',
      (r) => {
        const m = first(r).segments[0]!.moves[0]!;
        m.z = 5;
      },
      /not to safe Z|safe Z/,
    ],
    [
      'plunge at cutting feed',
      (r) => {
        for (const s of first(r).segments)
          for (const m of s.moves) if (m.kind === 'plunge') m.feed = 6000;
      },
      /descending/,
    ],
    [
      'move below target',
      (r) => {
        const s = first(r).segments.find((x) => x.role === 'pass')!;
        s.moves[0]!.z = -25;
      },
      /below target/,
    ],
    [
      'NaN feed',
      (r) => {
        const s = first(r).segments.find((x) => x.role === 'pass')!;
        const m = s.moves.find((x) => x.kind === 'linear')!;
        if (m.kind === 'linear') m.feed = Number.NaN;
      },
      /non-finite|bad feed/,
    ],
    [
      'does not end at safe Z',
      (r) => {
        const segs = first(r).segments;
        segs[segs.length - 1]!.moves.pop();
      },
      /safe Z/,
    ],
    [
      'last pass not at target',
      (r) => {
        first(r).passDepths[2] = -18;
      },
      /last passDepth|target/,
    ],
    [
      'cutting point off the offset',
      (r) => {
        const s = first(r).segments.find((x) => x.role === 'pass')!;
        const m = s.moves.find((x) => x.kind === 'linear')!;
        m.x += 0.01;
        m.y += 0.01;
      },
      /from part/,
    ],
  ];
  for (const [name, tamper, re] of cases)
    it(name, () => {
      const { project, res } = base();
      expect(review(project, res, paramsOf({}))).toEqual([]);
      tamper(res);
      expect(review(project, res, paramsOf({})).join('\n')).toMatch(re);
    });
});
