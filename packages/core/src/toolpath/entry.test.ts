import fc from 'fast-check';
import { applyPatches, enablePatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { checkGcode } from '../gcode-check';
import { postConfig } from '../gcode-check/check.testing';
import { goldenProfile } from '../post/golden.testing';
import { entryHeaders } from '../post/generate';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { clone, projectOf } from './toolpath.testing';
import type { Move, Operation } from './types';

// T324: ramp entry for contours (spec §6.3 "Dalma düz veya rampalı"). A project option; the ramp
// runs along the contour (zig-zag) down to each pass depth, never steeper than the angle, never
// shorter than the tool Ø (or the given length), never over a tab and never off the cut line. The
// default stays the straight plunge, so goldens are unchanged. The independent checker accepts a
// ramp only on the kerf of the pass that follows it (R3 RAMP_OUTSIDE_KERF).

enablePatches();

const machine = goldenProfile('generic');
const set = machine.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
if (!set) throw new Error('no MDF 18 set');
const toolD = machine.tools.find((t) => t.number === set.tool)?.diameter ?? 0;
const pv = { profile: machine, version: 1, verification: 'draft' as const };

function project(): Project {
  return projectOf({
    parts: [{ id: 'a', w: 300, h: 200, qty: 1 }],
    placements: [[{ partId: 'a', index: 0, x: 40, y: 40, rot: 0 }]],
  });
}

function run(p: Project, params: unknown): Project {
  const r = applyCommand(p, 'setEntry', params, { machine });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(applyPatches(r.project, r.inversePatches)).toEqual(p);
  return r.project;
}

const xy = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y);

/** Descending feed moves with XY travel, per pass, with their start point. */
function rampsOf(op: Operation): { from: Move; to: Move }[][] {
  const out: { from: Move; to: Move }[][] = [];
  let prev: Move | null = null;
  for (const seg of op.segments) {
    const pass: { from: Move; to: Move }[] = [];
    for (const m of seg.moves) {
      if (prev && m.kind !== 'rapid' && m.z < prev.z - 1e-9 && xy(prev, m) > 1e-6) {
        pass.push({ from: prev, to: m });
      }
      prev = m;
    }
    if (seg.role === 'pass') out.push(pass);
  }
  return out;
}

const exportText = (p: Project, passDepth?: number): string => {
  const r = exportNc(
    p,
    pv,
    postConfig('generic'),
    passDepth === undefined ? {} : { toolpath: { cutting: { passDepth } } },
  );
  if (!r.ok)
    throw new Error(JSON.stringify({ stage: r.stage, check: r.check, t: r.toolpathIssues }));
  return r.files.map((f) => f.content).join('\n');
};

describe('setEntry (T324)', () => {
  it('default is the straight plunge; ramp with angle and optional length; undo', () => {
    let p = project();
    expect(p.cutting.entry).toBeUndefined();
    p = run(p, { type: 'ramp', angleDeg: 3, length: null });
    expect(p.cutting.entry).toEqual({ type: 'ramp', angleDeg: 3 });
    p = run(p, { type: 'ramp', angleDeg: 5, length: 40 });
    expect(p.cutting.entry).toEqual({ type: 'ramp', angleDeg: 5, length: 40 });
    p = run(p, { type: 'straight' });
    expect(p.cutting.entry).toBeUndefined();
  });

  it('refuses angles and lengths outside the bounds', () => {
    for (const bad of [
      { type: 'ramp', angleDeg: 0, length: null },
      { type: 'ramp', angleDeg: 46, length: null },
      { type: 'ramp', angleDeg: 3, length: 0 },
      { type: 'ramp', angleDeg: 3 },
      { type: 'helix' },
    ]) {
      expect(applyCommand(project(), 'setEntry', bad, { machine }).ok, JSON.stringify(bad)).toBe(
        false,
      );
    }
    const p = clone(project()) as Project;
    (p.cutting as Record<string, unknown>).entry = { type: 'ramp', angleDeg: 90 };
    expect(parseProject(p).ok).toBe(false);
  });

  it('is a project setting, not an AI tool', async () => {
    const { COMMANDS } = await import('../commands/registry');
    expect(COMMANDS.setEntry.aiTool).toBe(false);
  });
});

describe('ramp toolpath (T324)', () => {
  it('straight by default: no descending XY move in a contour', () => {
    const r = buildToolpath(project(), machine);
    for (const op of r.toolpath.operations) {
      expect(rampsOf(op).flat()).toEqual([]);
    }
  });

  it('ramps every pass along the contour, at the plunge feed, never steeper than the angle', () => {
    const p = run(project(), { type: 'ramp', angleDeg: 3, length: null });
    const r = buildToolpath(p, machine);
    expect(r.errors).toEqual([]);
    const op = r.toolpath.operations.find((o) => o.kind === 'outerContour');
    if (!op) throw new Error('no contour');
    const passes = rampsOf(op);
    expect(passes.length).toBe(op.passDepths.length);
    for (const pass of passes) {
      expect(pass.length).toBeGreaterThan(0);
      for (const { from, to } of pass) {
        expect((to as { feed: number }).feed).toBe(op.plungeFeed);
        const angle = (Math.atan2(from.z - to.z, xy(from, to)) * 180) / Math.PI;
        expect(angle).toBeLessThanOrEqual(3 + 1e-6);
      }
    }
    // no vertical plunge into the material inside a pass
    for (const seg of op.segments.filter((s) => s.role === 'pass')) {
      expect(seg.moves.some((m) => m.kind === 'plunge' && m.z < 0 && !op.tabs.length)).toBe(false);
    }
  });

  it('a leg is never shorter than the tool Ø, or the given length', () => {
    // A steep angle would give a short leg: the tool Ø wins.
    const steep = run(project(), { type: 'ramp', angleDeg: 45, length: null });
    const op = buildToolpath(steep, machine).toolpath.operations.find(
      (o) => o.kind === 'outerContour',
    );
    if (!op) throw new Error('no contour');
    const leg = (rampsOf(op)[0] ?? []).reduce((s, m) => s + xy(m.from, m.to), 0) / 2;
    expect(leg).toBeGreaterThanOrEqual(toolD - 1e-6);
    const long = run(project(), { type: 'ramp', angleDeg: 45, length: 60 });
    const op2 = buildToolpath(long, machine).toolpath.operations.find(
      (o) => o.kind === 'outerContour',
    );
    if (!op2) throw new Error('no contour');
    const leg2 = (rampsOf(op2)[0] ?? []).reduce((s, m) => s + xy(m.from, m.to), 0) / 2;
    expect(leg2).toBeCloseTo(60, 6);
  });

  it('tabs keep clear of the ramp', () => {
    let p = run(project(), { type: 'ramp', angleDeg: 3, length: null });
    const t = applyCommand(p, 'setTabs', { mode: 'all' }, { machine });
    if (!t.ok) throw new Error(JSON.stringify(t.error));
    p = t.project;
    const op = buildToolpath(p, machine).toolpath.operations.find((o) => o.kind === 'outerContour');
    if (!op) throw new Error('no contour');
    expect(op.tabs.length).toBeGreaterThan(0);
    const leg = (rampsOf(op)[0] ?? []).reduce((s, m) => s + xy(m.from, m.to), 0) / 2;
    for (const tab of op.tabs) expect(tab.start).toBeGreaterThanOrEqual(leg - 1e-6);
  });

  it('the program says GİRİŞ: rampa; checks pass; default has no such line', () => {
    expect(exportText(project())).not.toMatch(/GIRIS: rampa/);
    const text = exportText(run(project(), { type: 'ramp', angleDeg: 3, length: null }));
    expect(text).toMatch(
      /\(GIRIS: rampa 3\.000°?, kontur boyunca, en az takim capi\)|GIRIS: rampa 3/,
    );
    expect(entryHeaders({ ...meta, entry: { angleDeg: 2.5, length: 20 } })).toEqual([
      'GİRİŞ: rampa 2.500°, kontur boyunca, en az 20.000 mm',
    ]);
  });
});

describe('checker: ramps only inside the declared kerf (T324)', () => {
  it('a ramp moved off the cut line is caught (R3 RAMP_OUTSIDE_KERF)', () => {
    const p = run(project(), { type: 'ramp', angleDeg: 3, length: null });
    const tp = buildToolpath(p, machine);
    const r = exportNc(p, pv, postConfig('generic'));
    if (!r.ok) throw new Error('export failed');
    const text = r.files[0]?.content ?? '';
    // find the first G1 line that goes down while moving in XY: it holds X, Y and Z words
    const lines = text.split('\n');
    // (the ramp runs along the bottom edge here: G1 X.. Z.. with Y modal); move it 3 mm off in Y
    const at = lines.findIndex((l) => /^G1 X-?[\d.]+ Z-[\d.]+/.test(l));
    expect(at).toBeGreaterThan(0);
    const lastY = lines
      .slice(0, at)
      .reverse()
      .map((l) => /Y(-?[\d.]+)/.exec(l))
      .find((m) => m !== null);
    if (!lastY) throw new Error('no Y before the ramp');
    lines[at] = (lines[at] as string).replace(/Z/, `Y${(Number(lastY[1]) + 3).toFixed(3)} Z`);
    const res = checkGcode(lines.join('\n'), {
      profile: machine,
      verification: 'draft',
      post: postConfig('generic'),
      toolpath: tp.toolpath,
      stock: { thickness: 18, sheetWidth: 2440, sheetHeight: 1220 },
      sheet: 0,
    });
    expect(res.violations.map((v) => v.code)).toContain('RAMP_OUTSIDE_KERF');
  });

  it('property: random contours, depths and passes ramp inside the kerf and pass every check', () => {
    const vertex = fc.record({
      r: fc.double({ min: 40, max: 140, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(vertex, { minLength: 3, maxLength: 9 }),
        fc.double({ min: 1, max: 20, noNaN: true }),
        fc.option(fc.double({ min: 1, max: 120, noNaN: true }), { nil: null }),
        fc.double({ min: 2, max: 18, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        (vs, angleDeg, length, passDepth, tabs, inner) => {
          const n = vs.length;
          const outline = vs.map((v, i) => {
            const a = (2 * Math.PI * i) / n;
            return {
              x: Math.round((150 + v.r * Math.cos(a)) * 1000) / 1000,
              y: Math.round((150 + v.r * Math.sin(a)) * 1000) / 1000,
              bulge: 0,
            };
          });
          const base = clone(project()) as Project;
          const part = base.parts[0] as unknown as Record<string, unknown>;
          part.kind = 'freeform';
          delete part.params;
          part.outline = outline;
          // a 40 × 40 cut-out in the middle (CW), ramped too
          part.inners = inner
            ? [
                [
                  { x: 130, y: 130, bulge: 0 },
                  { x: 130, y: 170, bulge: 0 },
                  { x: 170, y: 170, bulge: 0 },
                  { x: 170, y: 130, bulge: 0 },
                ],
              ]
            : [];
          base.cutting.entry =
            length === null ? { type: 'ramp', angleDeg } : { type: 'ramp', angleDeg, length };
          base.cutting.tabs = { auto: tabs };
          const parsed = parseProject(base);
          if (!parsed.ok) return true; // not a valid outline (e.g. self-touching): skip
          const r = exportNc(parsed.project, pv, postConfig('generic'), {
            toolpath: { cutting: { passDepth } },
          });
          if (!r.ok && r.stage === 'toolpath') return true; // geometry refused before the post
          expect(r.ok, JSON.stringify(r.ok ? '' : r.check?.violations?.slice(0, 3))).toBe(true);
          const ops = buildToolpath(parsed.project, machine, {
            cutting: { passDepth },
          }).toolpath.operations.filter(
            (o) => o.kind === 'outerContour' || o.kind === 'innerContour',
          );
          for (const op of ops) {
            // never below the pass depth it enters, never above the material top
            let prev: Move | null = null;
            for (const seg of op.segments) {
              for (const m of seg.moves) {
                if (prev && m.kind !== 'rapid' && m.z < prev.z - 1e-9 && xy(prev, m) > 1e-6) {
                  expect(m.z).toBeGreaterThanOrEqual((seg.depth ?? op.passDepths[0] ?? 0) - 1e-9);
                  expect(prev.z).toBeLessThanOrEqual(1e-9);
                }
                prev = m;
              }
            }
          }
          return true;
        },
      ),
      { numRuns: 40, seed: 324 },
    );
  });
});

const meta = {
  tabMode: 'small' as const,
  tabCount: 2,
  tabWidth: 10,
  tabHeight: 3,
  skin: null,
  leadIn: 'arc' as const,
  direction: 'climb' as const,
};
