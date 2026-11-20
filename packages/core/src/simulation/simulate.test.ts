/**
 * Simulation pipeline (T020, D-028): exportNc → reader → sheet-frame steps. Golden fixtures on
 * both posts, the frame conversion (a mirrored machine draws the same sheet path), the time
 * estimate against the toolpath model, failures (no simulation) and a 300-part project.
 */
import { describe, expect, it } from 'vitest';
import { golden, postConfig, type PostId } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { defaultMachineProfile, exampleMachineProfile } from '../machine';
import { nestProject } from '../nesting';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath, summarizeToolpath } from '../toolpath';
import { simPlayheadAt, timeForLine } from './playback';
import { simulateProject } from './simulate';

const pv = (post: PostId, edit?: (p: ReturnType<typeof goldenProfile>) => void) => {
  const profile = goldenProfile(post);
  edit?.(profile);
  return { profile, version: 1, verification: 'draft' as const };
};

describe.each(['generic', 'mach3'] as const)('%s', (post) => {
  it.each(['cabinet-doors', 'shelf-set', 'mixed'])('%s simulates from the read program', (fx) => {
    const g = golden(post, fx);
    const r = simulateProject(g.project, pv(post), postConfig(post));
    expect(r.ok).toBe(true);
    expect(r.export.check?.ok).toBe(true);
    const sheet = r.sheets[0];
    if (!sheet || !r.summary) throw new Error('no sheet');
    // One step per read move, in order, on the move's line; lines match the file text.
    const read = readGcode(g.text, { strict: true, dwellUnit: 's', extraMCodes: [] });
    expect(sheet.steps.map((s) => s.line)).toEqual(read.moves.map((m) => m.line));
    expect(sheet.files[0]?.lines.length).toBe(g.text.split('\r\n').length - 1);
    // Steps chain point to point and time never runs backwards.
    sheet.steps.forEach((s, i) => {
      if (i > 0) expect(s.p0).toBe(sheet.steps[i - 1]?.p1);
      expect(s.t1).toBeGreaterThanOrEqual(s.t0);
      if (i > 0) expect(s.t0).toBeGreaterThanOrEqual(sheet.steps[i - 1]?.t1 ?? 0);
    });
    // Stepping visits every move: each step ends strictly after the previous one.
    sheet.steps.forEach((s, i) => {
      if (i > 0) expect(s.t1).toBeGreaterThan(sheet.steps[i - 1]?.t1 ?? 0);
    });
    // One contour per cut part; the final depth is the toolpath target depth.
    expect(sheet.contours.length).toBe(g.toolpath.operations.length);
    expect(sheet.zBottom).toBeCloseTo(g.toolpath.targetDepth, 3);
    expect(sheet.toolDiameters).toEqual({ 2: 8 });
    // Every cut step knows its tool (M6 or the manual prompt comment).
    expect(sheet.steps.filter((s) => s.kind === 'cut').every((s) => s.tool === 2)).toBe(true);
    // Lengths agree with the toolpath model; time = model estimate + warm-up dwell (± rounding).
    const model = summarizeToolpath(g.toolpath, r.summary.rapidFeed);
    expect(r.summary.cutLength).toBeCloseTo(model.cutLength, 0);
    // one tool: the first tool is set-up, not an in-program change (T274)
    expect(r.summary.toolChanges).toBe(0);
    expect(r.export.tools?.manualChanges).toBe(0);
    expect(r.export.tools?.rezeroZ).toBe(false);
    expect(r.summary.dwellSeconds).toBe(5);
    expect(Math.abs(r.summary.seconds - 5 - model.estimatedSeconds)).toBeLessThan(
      model.estimatedSeconds * 0.05,
    );
    expect(r.summary.passes).toBe(
      g.toolpath.operations.reduce((n, op) => n + op.passDepths.length, 0),
    );
    expect(r.summary.tabs).toBe(g.toolpath.operations.reduce((n, op) => n + op.tabs.length, 0));
    // Tab steps: every model tab shows up as at least one level cut above the final depth.
    const tabSteps = sheet.steps.filter((s) => s.tab);
    expect(tabSteps.length).toBeGreaterThanOrEqual(r.summary.tabs);
    if (r.summary.tabs === 0) expect(tabSteps).toHaveLength(0);
    for (const s of tabSteps) {
      expect(s.kind).toBe('cut');
      expect(s.zMin).toBeGreaterThan(sheet.zBottom + 1e-3);
      expect(s.zMin).toBeLessThan(0);
    }
    // Seeking to the last move line shows every step done.
    const last = sheet.steps[sheet.steps.length - 1];
    if (!last) throw new Error('no steps');
    const t = timeForLine(sheet.steps, 0, last.line, sheet.duration);
    expect(simPlayheadAt(sheet.steps, t).done).toBe(sheet.steps.length);
  });

  it('holes-through (T1 → T2, B51 fewest changes): one in-program change, tools in order of use (T274)', () => {
    const g = golden(post, 'holes-through');
    const r = simulateProject(g.project, pv(post), postConfig(post));
    expect(r.ok).toBe(true);
    expect(r.summary?.toolChanges).toBe(1);
    const tools = r.export.tools;
    expect(tools?.sheets[0]?.tools.map((t) => `T${t.number} D${t.diameter}`)).toEqual([
      'T1 D6',
      'T2 D8',
    ]);
    expect(tools?.mode).toBe(post === 'mach3' ? 'manual' : 'auto');
    expect(tools?.manualChanges).toBe(post === 'mach3' ? 1 : 0);
    expect(tools?.rezeroZ).toBe(post === 'mach3');
  });
});

it('cut points lie in the sheet frame: the first contour starts at the first operation lead-in', () => {
  const g = golden('generic', 'mixed');
  const r = simulateProject(g.project, pv('generic'), postConfig('generic'));
  const sheet = r.sheets[0];
  const c = sheet?.contours[0];
  const op = g.toolpath.operations[0];
  if (!sheet || !c || !op) throw new Error('missing');
  // The approach rapid ends above the lead-in start: the contour starts at that XY.
  const approach = op.segments[0]?.moves.find((m) => m.kind === 'rapid' && m.z > 0);
  expect(approach).toBeDefined();
  expect(c.x).toBeCloseTo(approach?.x ?? NaN, 3);
  expect(c.y).toBeCloseTo(approach?.y ?? NaN, 3);
});

it('a mirrored machine (zero back-right, X+ left, Y+ front, Z zero = table) draws the same sheet path', () => {
  const g = golden('generic', 'mixed');
  const a = simulateProject(g.project, pv('generic'), postConfig('generic'));
  const b = simulateProject(
    g.project,
    pv('generic', (p) => {
      p.origin = {
        corner: 'backRight',
        xPositive: 'left',
        yPositive: 'front',
        sheetOffset: { x: 15, y: 25 },
      };
      p.zZero = { reference: 'table', spoilboardAllowance: 0.5 };
    }),
    postConfig('generic'),
  );
  expect(a.ok && b.ok).toBe(true);
  const pa = a.sheets[0]?.points ?? [];
  const pb = b.sheets[0]?.points ?? [];
  expect(pb.length).toBe(pa.length);
  const cutsA = a.sheets[0]?.steps.filter((s) => s.kind === 'cut' && s.known) ?? [];
  const cutsB = b.sheets[0]?.steps.filter((s) => s.kind === 'cut' && s.known) ?? [];
  expect(cutsB.length).toBe(cutsA.length);
  for (let i = 0; i < cutsA.length; i += 1) {
    const sa = cutsA[i];
    const sb = cutsB[i];
    if (!sa || !sb) continue;
    for (const k of [sa.p1 * 3, sa.p1 * 3 + 1, sa.p1 * 3 + 2]) {
      expect(Math.abs((pb[k - sa.p1 * 3 + sb.p1 * 3] ?? NaN) - (pa[k] ?? NaN))).toBeLessThan(0.002);
    }
  }
  // Program zero, table and travel in the sheet frame.
  expect(b.machine?.zero).toEqual({ x: 2440 + 15, y: 1220 + 25 });
  expect(b.machine?.xSign).toBe(-1);
  expect(b.machine?.table).toEqual({
    x: 2455 - 3050,
    y: 1245 - 2150,
    width: 3050,
    height: 2150,
  });
});

it('a project outside a tiny machine is not simulated; the export errors come back', () => {
  const g = golden('generic', 'mixed');
  const r = simulateProject(
    g.project,
    pv('generic', (p) => {
      p.workEnvelope = { x: 600, y: 400, z: 150 };
      p.table = { width: 600, depth: 400 };
    }),
    postConfig('generic'),
  );
  expect(r.ok).toBe(false);
  expect(r.sheets).toEqual([]);
  expect(r.summary).toBeNull();
  expect(r.export.fileNames).toEqual([]);
  const codes = [
    ...r.export.postErrors.map((e) => e.code),
    ...(r.export.check?.violations ?? []).map((v) => v.code),
  ];
  expect(codes).toContain('OUT_OF_ENVELOPE');
});

it('the seeded example profile (generic post, manual changer) is refused, not simulated', () => {
  const g = golden('generic', 'mixed');
  const r = simulateProject(
    g.project,
    { profile: defaultMachineProfile(), version: 1, verification: 'draft' },
    postConfig('generic'),
  );
  expect(r.ok).toBe(false);
  expect(r.export.stage).toBe('post');
  expect(r.export.postErrors.map((e) => e.code)).toContain('TOOL_CHANGE_UNSUPPORTED');
});

it('deterministic', () => {
  const g = golden('mach3', 'shelf-set');
  const a = simulateProject(g.project, pv('mach3'), postConfig('mach3'));
  const b = simulateProject(g.project, pv('mach3'), postConfig('mach3'));
  expect(JSON.stringify(b)).toBe(JSON.stringify(a));
});

it('300 parts simulate in reasonable time', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ w: 120 + 7 * i, h: 90 + 5 * i }));
  const src = {
    schemaVersion: 1,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: rows.map((r, i) => ({
      id: `p${i}`,
      name: `P${i + 1}`,
      qty: 10,
      grainLock: false,
      kind: 'rect',
      params: { w: r.w, h: r.h, r: 0 },
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    })),
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  };
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const project: Project = {
    ...parsed.project,
    layout: nestProject(parsed.project, { toolDiameter: 8 }).layout,
  };
  const profile = pv('generic');
  expect(buildToolpath(project, profile.profile).ok).toBe(true);
  const t0 = performance.now();
  const r = simulateProject(project, profile, postConfig('generic'));
  const ms = performance.now() - t0;
  expect(r.ok).toBe(true);
  expect(r.sheets.reduce((n, s) => n + s.contours.length, 0)).toBe(300);
  expect(ms).toBeLessThan(15_000);
  // The budget is the 15 s above; the default 5 s test timeout also counts nesting and is hit on
  // a busy machine when the whole suite runs in parallel.
}, 30_000);

it('the seeded example profile (Mach3) simulates the kitchen sample on the draft sheet', () => {
  const rows = [
    ['Yan', 560, 720, 8, true],
    ['Taban', 564, 560, 4, false],
    ['Kapak', 596, 716, 6, true],
    ['Raf', 564, 520, 8, false],
    ['Çekmece önü', 596, 176, 4, true],
  ] as const;
  const parsed = parseProject({
    schemaVersion: 1,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: rows.map((r, i) => ({
      id: `k${i}`,
      name: r[0],
      qty: r[3],
      grainLock: r[4],
      kind: 'rect',
      params: { w: r[1], h: r[2], r: 0 },
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    })),
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const project: Project = {
    ...parsed.project,
    layout: nestProject(parsed.project, { toolDiameter: 8 }).layout,
  };
  const r = simulateProject(
    project,
    { profile: exampleMachineProfile(), version: 1, verification: 'draft' },
    postConfig('mach3'),
  );
  expect(r.ok).toBe(true);
  expect(r.sheets).toHaveLength(3);
  expect(r.sheets.reduce((n, sh) => n + sh.contours.length, 0)).toBe(30);
});
