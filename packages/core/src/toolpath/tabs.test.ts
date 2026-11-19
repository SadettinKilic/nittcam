/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tabs and small-part auto tabs (spec §6.3, §2.4; T015, D-022). Properties over random nested
 * rectangular parts and random tab settings, checked against an independent description of the
 * rounded-rectangle tool loop (straight edges at tool radius from the part's bounding box), plus
 * hand-computed cases.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EPS } from '../geometry/constants';
import { distanceTo } from '../geometry/offset.testing';
import { parseMachineProfile, defaultMachineProfile } from '../machine';
import { nestProject } from '../nesting';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { evenTabCentres } from './tabs';
import {
  clone,
  machineOf,
  projectOf,
  sheetOutline,
  toolpathViolations,
  type CheckOptions,
} from './toolpath.testing';
import type {
  Move,
  Operation,
  PlungeOption,
  TabOptions,
  ToolpathOptions,
  ToolpathResult,
} from './types';

/** Property run count: env NITTCAM_RUNS (default 80). */
const RUNS = Number(
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .NITTCAM_RUNS ?? 80,
);

// ---------------------------------------------------------------------------
// Independent helpers
// ---------------------------------------------------------------------------

interface Edge {
  /** 'h' = horizontal edge at y = at, x in [lo, hi]; 'v' = vertical at x = at, y in [lo, hi]. */
  dir: 'h' | 'v';
  at: number;
  lo: number;
  hi: number;
}

/** Straight edges of the tool-centre loop of a placed rounded rectangle. */
function loopEdges(
  project: Project,
  op: Operation,
): { edges: Edge[]; total: number; corners: Corner[] } {
  const outline = sheetOutline(project, op);
  const xs = outline.vertices.map((v) => v.x);
  const ys = outline.vertices.map((v) => v.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const part = project.parts.find((p) => p.id === op.partId)!;
  // A corner radius below EPS cannot be machined: the part has sharp corners (D-012, spec §6.1).
  // T273: using the raw radius here shortened every straight edge by r ∈ (0, EPS), so a tab that
  // legitimately ends at the tangent point of the tool's corner arc was reported as off the edge.
  const rawR = part.kind === 'rect' ? part.params.r : 0;
  const r = rawR < EPS ? 0 : rawR;
  const tr = op.toolDiameter / 2;
  const edges: Edge[] = [
    { dir: 'h', at: y0 - tr, lo: x0 + r, hi: x1 - r },
    { dir: 'h', at: y1 + tr, lo: x0 + r, hi: x1 - r },
    { dir: 'v', at: x0 - tr, lo: y0 + r, hi: y1 - r },
    { dir: 'v', at: x1 + tr, lo: y0 + r, hi: y1 - r },
  ];
  const total = 2 * (x1 - x0 - 2 * r) + 2 * (y1 - y0 - 2 * r) + 2 * Math.PI * (r + tr);
  // T272: rounded corners (r ≥ EPS) are outline arcs; the tool-centre arc has radius r + tr
  const corners: Corner[] =
    r > 0
      ? [
          { cx: x0 + r, cy: y0 + r, sx: -1, sy: -1, R: r + tr },
          { cx: x1 - r, cy: y0 + r, sx: 1, sy: -1, R: r + tr },
          { cx: x1 - r, cy: y1 - r, sx: 1, sy: 1, R: r + tr },
          { cx: x0 + r, cy: y1 - r, sx: -1, sy: 1, R: r + tr },
        ]
      : [];
  return { edges, total, corners };
}

interface Corner {
  cx: number;
  cy: number;
  /** Outward quadrant signs. */
  sx: number;
  sy: number;
  /** Tool-centre arc radius. */
  R: number;
}

/** On the tool-centre arc of one rounded corner (inside its quadrant). */
function onCorner(k: Corner, x: number, y: number, tol = 1e-6): boolean {
  return (
    Math.abs(Math.hypot(x - k.cx, y - k.cy) - k.R) <= tol &&
    (x - k.cx) * k.sx >= -tol &&
    (y - k.cy) * k.sy >= -tol
  );
}

function onEdge(e: Edge, x: number, y: number, tol = 1e-6): boolean {
  const [u, v] = e.dir === 'h' ? [x, y] : [y, x];
  return Math.abs(v - e.at) <= tol && u >= e.lo - tol && u <= e.hi + tol;
}

interface Raised {
  from: { x: number; y: number };
  to: { x: number; y: number };
  z: number;
  /** Feeds of the rise and of the descent. */
  riseFeed: number;
  downKind: Move['kind'];
  downFeed: number;
  /** XY end points of the moves flown at the tab top. */
  topPoints: { x: number; y: number }[];
}

/** Raised spans of one pass segment: vertical rise, moves at a constant higher Z, vertical drop. */
function raisedSpans(op: Operation, passIndex: number): Raised[] {
  const out: Raised[] = [];
  let prev: { x: number; y: number; z: number } | null = null;
  let cur: Raised | null = null;
  for (const seg of op.segments) {
    for (const m of seg.moves) {
      if (seg.role === 'pass' && seg.pass === passIndex && prev) {
        const vertical = Math.hypot(m.x - prev.x, m.y - prev.y) <= 1e-9;
        if (!cur && vertical && m.z > prev.z && m.kind !== 'rapid') {
          cur = {
            from: { x: m.x, y: m.y },
            to: { x: m.x, y: m.y },
            z: m.z,
            riseFeed: m.feed,
            downKind: 'rapid',
            downFeed: 0,
            topPoints: [],
          };
        } else if (cur && vertical && m.z < prev.z && m.kind !== 'rapid') {
          cur.to = { x: m.x, y: m.y };
          cur.downKind = m.kind;
          cur.downFeed = m.feed;
          out.push(cur);
          cur = null;
        } else if (cur) {
          if (m.z !== cur.z) throw new Error(`tab top move at ${m.z}, want ${cur.z}`);
          cur.topPoints.push({ x: m.x, y: m.y });
        }
      }
      prev = { x: m.x, y: m.y, z: m.z };
    }
  }
  if (cur) throw new Error('tab without a descent');
  return out;
}

const partArb = (i: number) =>
  fc
    .record({
      w: fc.double({ min: 20, max: 800, noNaN: true }),
      h: fc.double({ min: 20, max: 600, noNaN: true }),
      rFrac: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.5, noNaN: true })),
      qty: fc.integer({ min: 1, max: 3 }),
    })
    .map(({ w, h, rFrac, qty }) => ({ id: `p${i}`, w, h, r: (rFrac * Math.min(w, h)) / 2, qty }));

const plungeArb: fc.Arbitrary<PlungeOption> = fc.oneof(
  fc.constant({ type: 'straight' as const }),
  fc
    .double({ min: 2, max: 30, noNaN: true })
    .map((angleDeg) => ({ type: 'ramp' as const, angleDeg })),
);

const caseArb = fc.record({
  parts: fc
    .integer({ min: 1, max: 5 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i)))),
  gap: fc.double({ min: 0, max: 10, noNaN: true }),
  margin: fc.double({ min: 0, max: 20, noNaN: true }),
  toolDiameter: fc.constantFrom(3, 6, 8, 12),
  thickness: fc.double({ min: 3, max: 30, noNaN: true }),
  spoilboard: fc.double({ min: 0, max: 1, noNaN: true }),
  passDepth: fc.double({ min: 1, max: 35, noNaN: true }),
  lead: fc.constantFrom('arc' as const, 'line' as const, 'none' as const),
  leadLength: fc.option(fc.double({ min: 0.5, max: 15, noNaN: true }), { nil: undefined }),
  plunge: plungeArb,
  direction: fc.constantFrom('climb' as const, 'conventional' as const),
  auto: fc.boolean(),
  count: fc.integer({ min: 1, max: 8 }),
  width: fc.double({ min: 1, max: 40, noNaN: true }),
  /** height (material left) = frac · thickness, strictly inside (0, thickness). */
  heightFrac: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
});
type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

function setUp(c: Case) {
  const unplaced = projectOf({
    parts: c.parts,
    thickness: c.thickness,
    gap: c.gap,
    margin: c.margin,
  });
  const nested = nestProject(unplaced, { toolDiameter: c.toolDiameter });
  const project: Project = { ...unplaced, layout: nested.layout };
  const machine = machineOf({
    toolDiameter: c.toolDiameter,
    spoilboard: c.spoilboard,
    passDepth: c.passDepth,
    thickness: c.thickness,
  });
  const height = c.heightFrac * c.thickness;
  const options: ToolpathOptions = {
    lead: c.lead,
    plunge: c.plunge,
    direction: c.direction,
    ...(c.leadLength !== undefined ? { leadLength: c.leadLength } : {}),
    tabs: { auto: c.auto, count: c.count, width: c.width, height },
  };
  const check: CheckOptions = {
    passDepth: c.passDepth,
    thickness: c.thickness,
    spoilboard: c.spoilboard,
    toolDiameter: c.toolDiameter,
    safeZ: 20,
    plungeFeed: 1500,
    direction: c.direction,
  };
  return { project, machine, options, check, height, placed: nested.layout.sheets.length > 0 };
}

/** Small part by the default thresholds, computed independently. */
function small(project: Project, op: Operation): boolean {
  const part = project.parts.find((p) => p.id === op.partId)!;
  if (part.kind !== 'rect') return false;
  const { w, h, r } = part.params;
  const area = w * h - (4 - Math.PI) * r * r;
  return area < 50_000 || Math.min(w, h) < 100;
}

/** Every tab invariant of one result as a list of violations (empty = fine). */
function tabViolations(project: Project, res: ToolpathResult, c: Case, height: number): string[] {
  const out: string[] = [];
  const target = -(c.thickness + c.spoilboard);
  const tabTop = -(c.thickness - height);
  for (const op of res.toolpath.operations) {
    const tr = op.toolDiameter / 2;
    const { edges, total, corners } = loopEdges(project, op);
    const isSmall = small(project, op);
    const want = isSmall ? Math.max(c.count, 2) : c.auto ? c.count : 0;
    const n = op.tabs.length;
    const warned = res.warnings.some(
      (w) =>
        w.partId === op.partId &&
        w.copy === op.copy &&
        w.sheet === op.sheet &&
        (w.code === 'TABS_REDUCED' || w.code === 'TABS_NOT_PLACED'),
    );
    // count: as requested, or reduced with a warning (auto small parts never below 2)
    if (n > want) out.push(`${op.id}: ${n} tabs > ${want}`);
    const unsecured = res.errors.some(
      (e) =>
        e.code === 'SMALL_PART_UNSECURED' &&
        e.partId === op.partId &&
        e.copy === op.copy &&
        e.sheet === op.sheet,
    );
    // a small part without tabs is an export-blocking error; a normal one only a warning
    if (isSmall && n === 0 && !unsecured) out.push(`${op.id}: small part without tabs, no error`);
    if (unsecured && !(isSmall && n === 0)) out.push(`${op.id}: SMALL_PART_UNSECURED wrongly`);
    if (n > 0 && n < want && !warned) out.push(`${op.id}: ${n} of ${want} tabs without a warning`);
    if (!isSmall && n === 0 && want > 0 && !warned) out.push(`${op.id}: no tabs, no warning`);
    if (isSmall && n === 1) out.push(`${op.id}: small part with one tab`);
    if (want === 0 && n === 0) continue;
    // evenly spaced by arc length
    for (let k = 1; k < n; k++) {
      const d = op.tabs[k]!.centre - op.tabs[k - 1]!.centre;
      if (Math.abs(d - total / n) > EPS) out.push(`${op.id}: tab spacing ${d}, want ${total / n}`);
    }
    for (const t of op.tabs) {
      // exact Z
      if (t.z !== tabTop) out.push(`${op.id}: tab z ${t.z}, want ${tabTop}`);
      // on one straight edge entirely (not within w/2 + tr of a corner), or (T272, only when no
      // tab fits on a straight edge) wholly on the arc of one rounded corner
      const straight = edges.some((e) => onEdge(e, t.x0, t.y0) && onEdge(e, t.x1, t.y1));
      const arc = corners.find((k) => onCorner(k, t.x0, t.y0) && onCorner(k, t.x1, t.y1));
      if (!straight && !arc) out.push(`${op.id}: tab not on a straight edge clear of the corners`);
      const L = c.width + op.toolDiameter;
      const span = Math.hypot(t.x1 - t.x0, t.y1 - t.y0);
      const wantSpan = arc ? 2 * arc.R * Math.sin(L / (2 * arc.R)) : L;
      if (Math.abs(span - wantSpan) > 1e-6)
        out.push(`${op.id}: raised span ${span}, want width + D`);
      if (Math.abs(t.end - t.start - L) > EPS) out.push(`${op.id}: tab length ${t.end - t.start}`);
      // not over the start point (lead-in/out, plunge)
      if (!(t.start > tr - EPS && t.end < total - tr + EPS))
        out.push(`${op.id}: tab over the start point`);
    }
    // every pass deeper than the tab top flies the tabs; the others do not
    op.passDepths.forEach((depth, i) => {
      const spans = raisedSpans(op, i);
      const expected = depth < tabTop - EPS ? n : 0;
      if (spans.length !== expected)
        out.push(
          `${op.id}: pass ${i} (${depth}) has ${spans.length} raised spans, want ${expected}`,
        );
      spans.forEach((s, k) => {
        const t = op.tabs[k]!;
        if (s.z !== tabTop) out.push(`${op.id}: raised z ${s.z}`);
        if (Math.hypot(s.from.x - t.x0, s.from.y - t.y0) > 1e-9) out.push(`${op.id}: rise off`);
        if (Math.hypot(s.to.x - t.x1, s.to.y - t.y1) > 1e-9) out.push(`${op.id}: drop off`);
        if (s.downKind !== 'plunge' || s.downFeed !== 1500)
          out.push(`${op.id}: drop is ${s.downKind} at ${s.downFeed}`);
        if (s.riseFeed !== 1500) out.push(`${op.id}: rise at ${s.riseFeed}`);
        const outline = sheetOutline(project, op);
        for (const q of [s.from, ...s.topPoints, s.to]) {
          if (Math.abs(distanceTo(q, outline) - tr) > EPS) out.push(`${op.id}: tab off the path`);
        }
      });
    });
    // final pass: outside the tabs at the target (after the initial plunge/ramp)
    const fin = op.segments.find((s) => s.final)!;
    let reached = false;
    let inTab = false;
    let prevZ = Number.NaN;
    for (const m of fin.moves) {
      if (m.z === target) reached = true;
      if (reached) {
        if (m.z === tabTop && prevZ === target) inTab = true;
        else if (m.z === target) inTab = false;
        if (!inTab && m.z !== target) out.push(`${op.id}: final pass move at ${m.z}`);
      }
      prevZ = m.z;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('tabs (fast-check)', () => {
  it('on the path, clear of corners, exact Z, target elsewhere, count, even spacing, plunge feed', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine, options, check, height, placed } = setUp(c);
        fc.pre(placed);
        const res = buildToolpath(project, machine, options);
        // the only possible error: a small part with no room for 2 tabs (checked per op below)
        expect(res.errors.filter((e) => e.code !== 'SMALL_PART_UNSECURED')).toEqual([]);
        expect(res.ok).toBe(res.errors.length === 0);
        expect(tabViolations(project, res, c, height)).toEqual([]);
        // the T014 invariants still hold with tabs (incl. descending moves at the plunge feed)
        expect(toolpathViolations(project, res, check)).toEqual([]);
      }),
      {
        numRuns: RUNS,
        examples: [
          [
            {
              parts: [
                { id: 'p0', w: 20, h: 20, r: 0.0000011649480891051669, qty: 1 },
                { id: 'p1', w: 20, h: 20, r: 0, qty: 1 },
                { id: 'p2', w: 20, h: 20, r: 0, qty: 1 },
              ],
              gap: 0,
              margin: 0,
              toolDiameter: 12,
              thickness: 3,
              spoilboard: 0,
              passDepth: 1,
              lead: 'arc',
              leadLength: undefined,
              plunge: { type: 'ramp', angleDeg: 2 },
              direction: 'climb',
              auto: false,
              count: 1,
              width: 1,
              heightFrac: 0.05,
            },
          ],
          // T273, seed 858170589: two 20 × 20 parts, p1 a hair taller with a 1e-6 corner radius
          [
            {
              parts: [
                { id: 'p0', w: 20, h: 20, r: 0, qty: 1 },
                { id: 'p1', w: 20, h: 20.00000000000001, r: 0.0000010000000000000002, qty: 1 },
              ],
              gap: 0,
              margin: 0,
              toolDiameter: 6,
              thickness: 3,
              spoilboard: 0,
              passDepth: 1,
              lead: 'arc',
              leadLength: undefined,
              plunge: { type: 'ramp', angleDeg: 2.4444633761218317 },
              direction: 'climb',
              auto: false,
              count: 4,
              width: 1,
              heightFrac: 0.05,
            },
          ],
          // T273, seed 1440540300 (integration/2): four 20 × 20 parts, p3 with a 1e-6 corner radius
          [
            {
              parts: [
                { id: 'p0', w: 20, h: 20, r: 0, qty: 1 },
                { id: 'p1', w: 20, h: 20, r: 0, qty: 1 },
                { id: 'p2', w: 20, h: 20, r: 0, qty: 1 },
                { id: 'p3', w: 20, h: 20, r: 0.0000010000000000000002, qty: 1 },
              ],
              gap: 0,
              margin: 0,
              toolDiameter: 6,
              thickness: 3,
              spoilboard: 0,
              passDepth: 1,
              lead: 'arc',
              leadLength: undefined,
              plunge: { type: 'straight' },
              direction: 'climb',
              auto: false,
              count: 4,
              width: 1,
              heightFrac: 0.05,
            },
          ],
        ],
      },
    );
  });

  it('deterministic', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine, options } = setUp(c);
        const a = JSON.stringify(buildToolpath(project, machine, options));
        const b = JSON.stringify(buildToolpath(clone(project), clone(machine), clone(options)));
        expect(a).toBe(b);
      }),
      { numRuns: 25 },
    );
  });

  it('evenTabCentres: exactly total / n apart, all inside the allowed set, or null', () => {
    const ivArb = fc
      .array(
        fc.tuple(
          fc.double({ min: 0, max: 1000, noNaN: true }),
          fc.double({ min: 0, max: 200, noNaN: true }),
        ),
        {
          maxLength: 8,
        },
      )
      .map((xs) =>
        xs
          .map(([lo, len]) => ({ lo, hi: lo + len }))
          .sort((a, b) => a.lo - b.lo)
          .reduce<{ lo: number; hi: number }[]>((acc, iv) => {
            const last = acc[acc.length - 1];
            if (last && iv.lo <= last.hi) last.hi = Math.max(last.hi, iv.hi);
            else acc.push({ ...iv });
            return acc;
          }, [])
          .filter((iv) => iv.hi <= 1200),
      );
    fc.assert(
      fc.property(ivArb, fc.integer({ min: 1, max: 8 }), (allowed, n) => {
        const cs = evenTabCentres(allowed, 1200, n);
        if (!cs) return;
        expect(cs).toHaveLength(n);
        cs.forEach((c, k) => {
          expect(allowed.some((iv) => c >= iv.lo - 1e-9 && c <= iv.hi + 1e-9)).toBe(true);
          if (k) expect(c - cs[k - 1]!).toBeCloseTo(1200 / n, 9);
        });
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Hand-computed cases
// ---------------------------------------------------------------------------

const at = (partId: string, x = 100, y = 100) => [[{ partId, index: 0, x, y, rot: 0 as const }]];

describe('hand-computed', () => {
  /*
   * 600 × 400 at (100, 100), tool 6 (r 3), 18 + 0.3, arc lead L = 3, climb (CW), 4 tabs w 10 h 3.
   * Loop: bottom y 97, top y 503, left x 97, right x 703; corners r 3 (quarter arcs 1.5π).
   * Start P = middle of the first long edge = (400, 97); CW from P runs −x along the bottom.
   * total = 2·600 + 2·400 + 6π = 2018.850; spacing = total / 4 = 504.712.
   * Raised span = w + D = 16 (half 8). Lead reach = chord 3√2 = 4.243; keep-out = 4.243 + 3.
   * Feasible phases (centre of tab 0 from P): [3√2 + 11, 192] ∪ [312.71, 490.71], equally long
   * up to rounding → the first; phase = (3√2 + 203) / 2 = 103.621.
   * Tab 0: bottom edge, x = 400 − 103.621 = 296.379, y = 97.
   * Tab 1: centre 608.333 − (300 + 1.5π) = 303.621 up the left edge from y 100: (97, 403.621).
   * Tab 2: centre 1113.046 − (300 + 400 + 3π) = 403.621 along the top edge from x 100: (503.621, 503).
   * Tab 3: right edge going down, y = 500 − 303.621 = 196.379.
   * Height = material left (D-022): Z = −(18 − 3) = −15.0 on every tab (spoilboard plays no part).
   * Passes −6.1 / −12.2 are above −15.0 and get none; only −18.3 flies the tabs.
   */
  it('600 × 400, 4 tabs w 10 h 3: one tab per side at the computed positions, Z −15.0', () => {
    const project = projectOf({ parts: [{ id: 'a', w: 600, h: 400 }], placements: at('a') });
    const res = buildToolpath(project, machineOf(), {
      tabs: { auto: true, count: 4, width: 10, height: 3 },
    });
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([]);
    const op = res.toolpath.operations[0]!;
    const phase = (3 * Math.SQRT2 + 203) / 2;
    const centres = op.tabs.map((t) => ({ x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2, z: t.z }));
    const want = [
      { x: 400 - phase, y: 97 },
      { x: 97, y: 100 + phase + 200 },
      { x: 100 + phase + 300, y: 503 },
      { x: 703, y: 500 - phase - 200 },
    ];
    expect(centres).toHaveLength(4);
    centres.forEach((c, i) => {
      expect(c.x).toBeCloseTo(want[i]!.x, 9);
      expect(c.y).toBeCloseTo(want[i]!.y, 9);
      expect(c.z).toBe(-(18 - 3));
      expect(c.z).toBe(-15);
    });
    expect(want[0]!.x).toBeCloseTo(296.379, 3);
    expect(want[1]!.y).toBeCloseTo(403.621, 3);
    expect(want[2]!.x).toBeCloseTo(503.621, 3);
    expect(want[3]!.y).toBeCloseTo(196.379, 3);
    expect(op.tabs[1]!.centre - op.tabs[0]!.centre).toBeCloseTo((2000 + 6 * Math.PI) / 4, 9);
    // raised span of 16 mm on the bottom edge (CW: from x 304.379 to 288.379)
    expect(op.tabs[0]!.x0).toBeCloseTo(400 - phase + 8, 9);
    expect(op.tabs[0]!.x1).toBeCloseTo(400 - phase - 8, 9);
    // only the last pass (−18.3) is below the tab top −15.0; −12.2 is above it
    expect(raisedSpans(op, 0)).toHaveLength(0);
    expect(raisedSpans(op, 1)).toHaveLength(0);
    expect(raisedSpans(op, 2)).toHaveLength(4);
  });

  it('80 × 80 with tabs off: auto tabs (default count 4, height min(3, 18/2) → z −15) and a warning', () => {
    const project = projectOf({ parts: [{ id: 's', w: 80, h: 80 }], placements: at('s') });
    expect(project.cutting.tabs.auto).toBe(false);
    const res = buildToolpath(project, machineOf());
    expect(res.ok).toBe(true);
    expect(res.warnings.map((w) => [w.code, w.partId])).toEqual([['SMALL_PART_AUTO_TABS', 's']]);
    const op = res.toolpath.operations[0]!;
    expect(op.tabs).toHaveLength(4);
    for (const t of op.tabs) expect(t.z).toBe(-15);
  });

  it('a large part with tabs off gets none; the threshold is configurable', () => {
    const project = projectOf({ parts: [{ id: 'a', w: 600, h: 400 }], placements: at('a') });
    const res = buildToolpath(project, machineOf());
    expect(res.toolpath.operations[0]!.tabs).toEqual([]);
    expect(res.warnings).toEqual([]);
    const big = buildToolpath(project, machineOf(), { tabs: { smallPartArea: 250_000 } });
    expect(big.toolpath.operations[0]!.tabs.length).toBeGreaterThanOrEqual(2);
    expect(big.warnings.map((w) => w.code)).toEqual(['SMALL_PART_AUTO_TABS']);
    // smallest side 99 < 100 but area 59 400 > 50 000: still small
    const thin = projectOf({ parts: [{ id: 't', w: 600, h: 99 }], placements: at('t') });
    expect(buildToolpath(thin, machineOf()).warnings.map((w) => w.code)).toEqual([
      'SMALL_PART_AUTO_TABS',
    ]);
    // a warning per part, not per copy
    const many = projectOf({
      parts: [{ id: 's', w: 80, h: 80, qty: 3 }],
      placements: [
        [0, 1, 2].map((i) => ({
          partId: 's',
          index: i,
          x: 100 + i * 120,
          y: 100,
          rot: 0 as const,
        })),
      ],
    });
    expect(buildToolpath(many, machineOf()).warnings.map((w) => w.code)).toEqual([
      'SMALL_PART_AUTO_TABS',
    ]);
  });

  it('project cutting.tabs overrides the material set, which overrides the built-in defaults', () => {
    const project = projectOf({ parts: [{ id: 'a', w: 600, h: 400 }], placements: at('a') });
    const machine = machineOf();
    machine.materials[0]!.tabs = { count: 2, width: 20, height: 5 };
    project.cutting.tabs = { auto: true };
    let op = buildToolpath(project, machine).toolpath.operations[0]!;
    expect(op.tabs).toHaveLength(2);
    expect(op.tabs[0]!.z).toBe(-13);
    expect(
      Math.hypot(op.tabs[0]!.x1 - op.tabs[0]!.x0, op.tabs[0]!.y1 - op.tabs[0]!.y0),
    ).toBeCloseTo(26, 9);
    project.cutting.tabs = { auto: true, count: 3, width: 12, height: 4 };
    op = buildToolpath(project, machine).toolpath.operations[0]!;
    expect(op.tabs).toHaveLength(3);
    expect(op.tabs[0]!.z).toBe(-14);
    // options win over the project
    op = buildToolpath(project, machine, { tabs: { count: 5 } }).toolpath.operations[0]!;
    expect(op.tabs).toHaveLength(5);
  });

  it('a tab taller than the deeper passes: every pass below the tab top flies the tabs', () => {
    // 18 + 0.3, passes −6.1 / −12.2 / −18.3, height 10 → tab top −8: passes 1 and 2 get tabs
    const project = projectOf({ parts: [{ id: 'a', w: 600, h: 400 }], placements: at('a') });
    const res = buildToolpath(project, machineOf(), { tabs: { auto: true, height: 10 } });
    expect(res.ok).toBe(true);
    const op = res.toolpath.operations[0]!;
    expect(op.tabs[0]!.z).toBe(-8);
    expect(raisedSpans(op, 0)).toHaveLength(0);
    expect(raisedSpans(op, 1)).toHaveLength(4);
    expect(raisedSpans(op, 2)).toHaveLength(4);
    // tab top exactly at a pass depth: that pass is not below it and gets no tabs
    const eq = buildToolpath(project, machineOf({ spoilboard: 0 }), {
      tabs: { auto: true, height: 6 },
    });
    // 18 / 6.1 → 3 passes of 6: −6, −12, −18; tab top −12: only the last pass
    const op2 = eq.toolpath.operations[0]!;
    expect(op2.passDepths).toEqual([-6, -12, -18]);
    expect(raisedSpans(op2, 1)).toHaveLength(0);
    expect(raisedSpans(op2, 2)).toHaveLength(4);
  });

  it('ramp plunge: tabs stay out of the ramp zone and the result is safe', () => {
    const project = projectOf({ parts: [{ id: 'a', w: 600, h: 400 }], placements: at('a') });
    const res = buildToolpath(project, machineOf(), {
      tabs: { auto: true, count: 6 },
      plunge: { type: 'ramp', length: 250 },
    });
    expect(res.ok).toBe(true);
    for (const t of res.toolpath.operations[0]!.tabs) expect(t.start).toBeGreaterThan(250 + 3);
  });

  it('too small: TABS_REDUCED / TABS_NOT_PLACED warnings, SMALL_PART_UNSECURED error', () => {
    const project = projectOf({ parts: [{ id: 'a', w: 200, h: 120 }], placements: at('a') });
    const reduced = buildToolpath(project, machineOf(), {
      tabs: { auto: true, count: 20, width: 30 },
    });
    expect(reduced.ok).toBe(true);
    const n = reduced.toolpath.operations[0]!.tabs.length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
    expect(reduced.warnings.map((w) => w.code)).toEqual(['TABS_REDUCED']);
    // 40 × 40 with 40 mm bridges: the 34-mm-free edges cannot hold a 46 mm raised span
    const tiny = projectOf({ parts: [{ id: 't', w: 40, h: 40 }], placements: at('t') });
    for (const auto of [false, true]) {
      const none = buildToolpath(tiny, machineOf(), { tabs: { auto, width: 40 } });
      expect(none.ok).toBe(false);
      expect(none.errors.map((e) => [e.code, e.partId, e.copy, e.sheet])).toEqual([
        ['SMALL_PART_UNSECURED', 't', 0, 0],
      ]);
      expect(none.toolpath.operations[0]!.tabs).toEqual([]);
      expect(none.warnings.map((w) => w.code)).toEqual(auto ? [] : ['SMALL_PART_AUTO_TABS']);
    }
    // a normal part where no tab fits: only a warning
    const long = projectOf({ parts: [{ id: 'l', w: 600, h: 400 }], placements: at('l') });
    const nf = buildToolpath(long, machineOf(), { tabs: { auto: true, count: 1, width: 700 } });
    expect(nf.ok).toBe(true);
    expect(nf.warnings.map((w) => w.code)).toEqual(['TABS_NOT_PLACED']);
    // small parts never get a single tab: count 1 is raised to 2
    const one = buildToolpath(tiny, machineOf(), { tabs: { count: 1 } });
    expect(one.toolpath.operations[0]!.tabs).toHaveLength(2);
  });

  it('INVALID_TAB: height ≥ thickness, height ≤ spoilboard, bad count / width / thresholds', () => {
    const project = projectOf({ parts: [{ id: 'a', w: 600, h: 400 }], placements: at('a') });
    const bad: TabOptions[] = [
      { height: 18 },
      { height: 25 },
      { height: 0 },
      { height: -1 },
      { height: Number.NaN },
      { count: 0 },
      { count: 2.5 },
      { width: 0 },
      { width: Number.POSITIVE_INFINITY },
      { smallPartArea: -1 },
      { smallPartMinSide: Number.NaN },
    ];
    for (const tabs of bad) {
      const res = buildToolpath(project, machineOf(), { tabs });
      expect(res.ok, JSON.stringify(tabs)).toBe(false);
      expect(res.errors.map((e) => e.code)).toEqual(['INVALID_TAB']);
      expect(res.toolpath.operations).toEqual([]);
    }
    expect(buildToolpath(project, machineOf(), { tabs: { height: 17.9 } }).ok).toBe(true);
    // below the spoilboard allowance is fine now: height is material left (top −17.8)
    const thin = buildToolpath(project, machineOf(), { tabs: { auto: true, height: 0.2 } });
    expect(thin.ok).toBe(true);
    expect(thin.toolpath.operations[0]!.tabs[0]!.z).toBeCloseTo(-17.8, 12);
  });
});

describe('safety checker with tabs', () => {
  const base = () => {
    const project = projectOf({ parts: [{ id: 'a', w: 600, h: 400 }], placements: at('a') });
    const res = buildToolpath(project, machineOf(), { tabs: { auto: true } });
    expect(res.ok).toBe(true);
    return clone(res);
  };
  const final = (r: ToolpathResult) => r.toolpath.operations[0]!.segments.find((s) => s.final)!;

  it('flags a tab exit at the cutting feed', async () => {
    const { toolpathSafetyViolations } = await import('./safety');
    const r = base();
    const drop = final(r).moves.find((m) => m.kind === 'plunge' && m.z === -18.3)!;
    if (drop.kind === 'plunge') drop.feed = 6000;
    expect(toolpathSafetyViolations(r.toolpath).join('\n')).toMatch(/plunge feed/);
  });

  it('flags a vertical descent that is not a plunge', async () => {
    const { toolpathSafetyViolations } = await import('./safety');
    const r = base();
    const moves = final(r).moves;
    const i = moves.findIndex((m, k) => k > 0 && m.kind === 'plunge');
    const m = moves[i]!;
    moves[i] = { kind: 'linear', x: m.x, y: m.y, z: m.z, feed: 1500 };
    expect(toolpathSafetyViolations(r.toolpath).join('\n')).toMatch(/not a plunge/);
  });

  it('flags a tab top below the target or above Z 0, and a move below the target', async () => {
    const { toolpathSafetyViolations } = await import('./safety');
    const r = base();
    r.toolpath.operations[0]!.tabs[0]!.z = 1;
    expect(toolpathSafetyViolations(r.toolpath).join('\n')).toMatch(/tab top/);
    const r2 = base();
    const top = final(r2).moves.find((m) => m.z > -18.3 && m.kind === 'linear')!;
    top.z = -19;
    expect(toolpathSafetyViolations(r2.toolpath).join('\n')).toMatch(/below the target/);
  });
});

describe('schemas (backward compatible)', () => {
  it('machine profile: tabs optional; height checked against the thickness', () => {
    const m = defaultMachineProfile();
    expect(parseMachineProfile(m).ok).toBe(true);
    const withTabs = clone(m);
    withTabs.materials[0]!.tabs = { count: 4, width: 10, height: 3 };
    const ok = parseMachineProfile(withTabs);
    expect(ok.ok && ok.profile.materials[0]!.tabs).toEqual({ count: 4, width: 10, height: 3 });
    const tall = clone(withTabs);
    tall.materials[0]!.tabs!.height = 18;
    const r1 = parseMachineProfile(tall);
    expect(!r1.ok && r1.issues.map((i) => i.key)).toContain('tabHeightAboveThickness');
    const low = clone(withTabs);
    low.materials[0]!.tabs!.height = 0.1;
    expect(parseMachineProfile(low).ok).toBe(true);
    const zero = clone(withTabs);
    zero.materials[0]!.tabs!.count = 0;
    expect(parseMachineProfile(zero).ok).toBe(false);
  });

  it('project: cutting.tabs count/width/height optional; old projects stay valid', () => {
    const project = projectOf({ parts: [{ id: 'a', w: 100, h: 50 }] });
    const json = clone(project) as unknown as { cutting: { tabs: Record<string, unknown> } };
    expect(parseProject(json).ok).toBe(true);
    json.cutting.tabs = { auto: true, count: 3, width: 8, height: 2 };
    const r = parseProject(json);
    expect(r.ok && r.project.cutting.tabs).toEqual({ auto: true, count: 3, width: 8, height: 2 });
    for (const tabs of [
      { auto: true, count: 0 },
      { auto: true, width: -1 },
      { auto: true, x: 1 },
    ]) {
      json.cutting.tabs = tabs;
      expect(parseProject(json).ok).toBe(false);
    }
  });
});
