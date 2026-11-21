import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { checkGcode } from '../gcode-check';
import { postConfig } from '../gcode-check/check.testing';
import { goldenProfile } from '../post/golden.testing';
import type { Project } from '../schema';
import { buildToolpath } from './build';
import { clone, projectOf } from './toolpath.testing';
import type { Move } from './types';

// T324 tester: look for a ramp that escapes its kerf. Each scenario must either export with every
// check passing (R3 RAMP_OUTSIDE_KERF judged on the read path) or be refused before the post; and
// in the toolpath no ramp is steeper than the angle, starts above the top or ends below its pass.

const machine = goldenProfile('generic');
const pv = { profile: machine, version: 1, verification: 'draft' as const };
const v = (x: number, y: number, bulge = 0) => ({ x, y, bulge });

type Spec = {
  w: number;
  h: number;
  r?: number;
  inners?: ReturnType<typeof v>[][];
  tabs?: boolean;
  angleDeg?: number;
  length?: number;
  passDepth?: number;
};

function projectFor(s: Spec): Project {
  const p = clone(
    projectOf({
      parts: [{ id: 'a', w: s.w, h: s.h, qty: 1, r: s.r ?? 0 }],
      placements: [[{ partId: 'a', index: 0, x: 40, y: 40, rot: 0 }]],
    }),
  ) as Project;
  const part = p.parts[0];
  if (!part) throw new Error('no part');
  part.inners = s.inners ?? [];
  p.cutting.tabs = { auto: s.tabs ?? false };
  p.cutting.entry = {
    type: 'ramp',
    angleDeg: s.angleDeg ?? 3,
    ...(s.length === undefined ? {} : { length: s.length }),
  };
  return p;
}

const xy = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y);

function assertSafe(s: Spec) {
  const p = projectFor(s);
  const opts =
    s.passDepth === undefined ? {} : { toolpath: { cutting: { passDepth: s.passDepth } } };
  const r = exportNc(p, pv, postConfig('generic'), opts);
  if (!r.ok) {
    // refused before the post is fine (no file); a refusal by the checker is a generator bug
    expect(r.stage, JSON.stringify(r.check?.violations?.slice(0, 3))).toBe('toolpath');
    return;
  }
  expect(r.files.length).toBeGreaterThan(0);
  const tan = Math.tan(((s.angleDeg ?? 3) * Math.PI) / 180);
  const tp = buildToolpath(
    p,
    machine,
    s.passDepth === undefined ? {} : { cutting: { passDepth: s.passDepth } },
  );
  let ramps = 0;
  for (const op of tp.toolpath.operations) {
    if (op.kind !== 'outerContour' && op.kind !== 'innerContour') continue;
    let prev: Move | null = null;
    for (const seg of op.segments) {
      for (const m of seg.moves) {
        if (prev && m.kind !== 'rapid' && m.z < prev.z - 1e-9 && xy(prev, m) > 1e-6) {
          ramps++;
          expect(prev.z).toBeLessThanOrEqual(1e-9);
          const run =
            m.kind === 'arc'
              ? Math.hypot(prev.x - m.cx, prev.y - m.cy) * 4 * Math.atan(Math.abs(m.bulge))
              : xy(prev, m);
          expect(prev.z - m.z).toBeLessThanOrEqual(run * tan * 1.001 + 1e-6);
          if (seg.role === 'pass' && seg.depth !== undefined) {
            expect(m.z).toBeGreaterThanOrEqual(seg.depth - 1e-9);
          }
        }
        prev = m;
      }
    }
  }
  expect(ramps).toBeGreaterThan(0);
}

describe('T324 tester: ramps never leave the kerf', () => {
  it('short contour: 12 × 12 part', () => assertSafe({ w: 12, h: 12 }));
  it('arcs: a round part (R = half the side) and R20 corners', () => {
    assertSafe({ w: 120, h: 120, r: 60 });
    assertSafe({ w: 300, h: 200, r: 20 });
  });
  it('tabs near the ramp on a small part', () => assertSafe({ w: 80, h: 60, tabs: true }));
  it('inner cut-outs: a rectangle and a round hole, with tabs', () =>
    assertSafe({
      w: 400,
      h: 300,
      tabs: true,
      inners: [
        [v(50, 50), v(50, 150), v(150, 150), v(150, 50)],
        [v(250, 150, -1), v(330, 150, -1)],
      ],
    }));
  it('many passes (2 mm)', () => assertSafe({ w: 300, h: 200, passDepth: 2, tabs: true }));
  it('edges shorter than the ramp leg: 300 × 12 with a 100 mm leg', () =>
    assertSafe({ w: 300, h: 12, length: 100 }));
  it('a leg longer than the whole contour (0,5°, 1000 mm)', () =>
    assertSafe({ w: 60, h: 40, angleDeg: 0.5, length: 1000 }));
  it('steep 45° on a round part with many passes', () =>
    assertSafe({ w: 100, h: 100, r: 50, angleDeg: 45, passDepth: 3 }));
});

describe('T324 tester: checker R3 on hand-made programs', () => {
  const ctx = {
    profile: machine,
    verification: 'draft' as const,
    post: postConfig('generic'),
    stock: { thickness: 18, sheetWidth: 2440, sheetHeight: 1220 },
    sheet: 0,
    toolpath: buildToolpath(projectFor({ w: 100, h: 100 }), machine).toolpath,
  };
  const prog = (body: string[]) =>
    [
      '%',
      '(DOGRULANMADI, once air cut)',
      'G21 G90 G17 G54',
      'G0 Z20.000',
      'M3 S18000',
      'G4 P5.0',
      ...body,
      'G0 Z20.000',
      'M5',
      'M30',
      '%',
    ].join('\n');
  const codes = (text: string) => checkGcode(text, ctx).violations.map((x) => x.code);

  it('a ramp along the line it then cuts passes R3', () => {
    const c = codes(
      prog([
        'G0 X100.000 Y100.000',
        'G1 Z0.000 F1500',
        'G1 X200.000 Y100.000 Z-1.000 F1500',
        'G1 X100.000 Y100.000 F6000',
        'G1 X100.000 Y200.000',
      ]),
    );
    expect(c).not.toContain('RAMP_OUTSIDE_KERF');
  });

  it('a ramp across the corner (diagonal) is caught', () => {
    const c = codes(
      prog([
        'G0 X100.000 Y100.000',
        'G1 Z0.000 F1500',
        'G1 X200.000 Y200.000 Z-1.000 F1500',
        'G1 X200.000 Y100.000 F6000',
        'G1 X100.000 Y100.000',
      ]),
    );
    expect(c).toContain('RAMP_OUTSIDE_KERF');
  });

  // Known gap (not blocking): fails today; when the checker samples by length, drop `.fails`.
  it.fails('a long ramp over uncut material whose 5 sample points touch short level cuts', () => {
    // The ramp X100 → X200 crosses uncut board; level cuts at the same depth cross it only at
    // X100, 125, 150, 175 and 200 (the checker's sample points).
    const cross = [100, 125, 150, 175, 200].flatMap((x) => [
      `G1 X${x}.000 Y95.000`,
      `G1 X${x}.000 Y105.000`,
    ]);
    const c = codes(
      prog([
        'G0 X100.000 Y100.000',
        'G1 Z0.000 F1500',
        'G1 X200.000 Y100.000 Z-1.000 F1500',
        'G1 X200.000 Y95.000 F6000',
        ...cross,
      ]),
    );
    // Sampling 5 points per ramp lets this through.
    expect(c).toContain('RAMP_OUTSIDE_KERF');
  });
});

describe('T323 tester: feed bounds and the ramp feed', () => {
  const base = projectFor({ w: 300, h: 200 });
  const ok = (params: Record<string, number>) =>
    applyCommand(base, 'setToolFeed', { tool: 1, ...params }, { machine }).ok;

  it('setToolFeed accepts exactly the bounds and refuses one step outside', () => {
    expect([ok({ feed: 100 }), ok({ feed: 60_000 })]).toEqual([true, true]);
    expect([ok({ feed: 99.9 }), ok({ feed: 60_000.1 })]).toEqual([false, false]);
    expect([ok({ plungeFeed: 50 }), ok({ plungeFeed: 30_000 })]).toEqual([true, true]);
    expect([ok({ plungeFeed: 49 }), ok({ plungeFeed: 30_001 })]).toEqual([false, false]);
    expect(ok({ feed: Number.NaN })).toBe(false);
    expect(ok({ feed: -3000 })).toBe(false);
  });

  it('the ramp runs at the tool’s own plunge feed, then cuts at its own feed', () => {
    const cut = machine.materials.find((m) => m.material === 'mdf' && m.thickness === 18)?.tool;
    if (cut === undefined) throw new Error('no set');
    const r = applyCommand(
      base,
      'setToolFeed',
      { tool: cut, feed: 4321, plungeFeed: 765 },
      {
        machine,
      },
    );
    if (!r.ok) throw new Error('setToolFeed');
    const tp = buildToolpath(r.project, machine);
    for (const op of tp.toolpath.operations) {
      if (op.kind !== 'outerContour') continue;
      let prev: Move | null = null;
      for (const seg of op.segments) {
        for (const m of seg.moves) {
          if (prev && m.kind !== 'rapid') {
            const down = m.z < prev.z - 1e-9;
            if (down) expect(m.feed).toBe(765);
            else if (seg.role === 'pass') expect([4321, 765]).toContain(m.feed);
          }
          prev = m;
        }
      }
    }
    const ex = exportNc(r.project, pv, postConfig('generic'));
    expect(ex.ok).toBe(true);
  });
});
