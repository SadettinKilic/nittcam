/**
 * Tester suite for T022 (spec §7.2, §7.3): the 10 safety rules against the air-cut and test-cut
 * programs (failing input per rule), the air-cut floor over many profiles, pocket geometry,
 * measurement edge cases. A false PASS is the worst bug.
 */
import { describe, expect, it } from 'vitest';
import { canDownload, checkGcode, type GcodeCheckContext } from '../gcode-check';
import { readGcode } from '../gcode-reader';
import type { MachineProfile } from '../machine';
import { parsePostConfig } from '../post';
import { GOLDEN_POSTS, goldenProfile } from '../post/golden.testing';
import { operationMoves } from '../toolpath';
import { TEST_TOLERANCE, evaluateTestCut } from './measure';
import {
  AIR_CUT_GAP,
  TEST_PART,
  airCutToolpath,
  testPartToolpath,
  testPocketDepth,
  testProgram,
  type TestProgramKind,
} from './program';

const NL = '\r\n';
type PostId = 'generic' | 'mach3';
const POSTS: PostId[] = ['generic', 'mach3'];
const KINDS: TestProgramKind[] = ['airCut', 'testCut'];
const cfg = (id: PostId) => GOLDEN_POSTS.find((p) => p.id === id)?.config;

function program(
  kind: TestProgramKind,
  post: PostId,
  edit: (p: MachineProfile) => void = () => undefined,
) {
  const profile = goldenProfile(post);
  edit(profile);
  const r = testProgram(kind, { profile, version: 1, verification: 'draft' }, cfg(post));
  return { r, profile, text: r.files[0]?.content ?? '' };
}

function context(kind: TestProgramKind, post: PostId): GcodeCheckContext {
  const profile = goldenProfile(post);
  const tp = testPartToolpath(profile);
  if (!tp.ok || !tp.toolpath) throw new Error('fixture');
  const parsed = parsePostConfig(cfg(post));
  if (!parsed.ok) throw new Error('post');
  return {
    profile,
    verification: 'draft',
    post: parsed.config,
    toolpath: kind === 'airCut' ? airCutToolpath(tp.toolpath) : tp.toolpath,
    stock: { thickness: 18, sheetWidth: 300, sheetHeight: 300 },
    sheet: 0,
    ...(kind === 'testCut' ? { layout: tp.layout } : {}),
  } as GcodeCheckContext;
}

function codesOf(text: string, kind: TestProgramKind, post: PostId) {
  const res = checkGcode(text, context(kind, post));
  const codes = [...new Set(res.violations.map((v) => `${v.rule}/${v.code}`))].join(',');
  return { res, codes };
}

function fails(kind: TestProgramKind, post: PostId, mutate: (l: string[]) => void, rule?: RegExp) {
  const base = program(kind, post).text;
  const l = base.split(NL);
  mutate(l);
  const text = l.join(NL);
  expect(text).not.toBe(base);
  const { res, codes } = codesOf(text, kind, post);
  expect(canDownload(res), codes).toBe(false);
  if (rule) expect(codes).toMatch(rule);
}
const at = (l: string[], re: RegExp, from = 0) => {
  const i = l.findIndex((s, k) => k >= from && re.test(s));
  if (i < 0) throw new Error(`anchor ${String(re)}`);
  return i;
};

describe.each(POSTS)('control: unmutated programs pass (%s)', (post) => {
  it.each(KINDS)('%s', (kind) => {
    const { res, codes } = codesOf(program(kind, post).text, kind, post);
    expect(
      res.violations.filter((v) => v.severity === 'error'),
      codes,
    ).toEqual([]);
  });
});

describe.each(POSTS)('§7.2 failing inputs on the air cut (%s)', (post) => {
  const k: TestProgramKind = 'airCut';
  it('R1 modal line removed', () => fails(k, post, (l) => l.splice(at(l, /^G21/), 1)));
  it('R1 units flipped to inch', () =>
    fails(k, post, (l) => (l[at(l, /^G21/)] = 'G20 G90 G17 G54')));
  it('R2 first Z retract removed', () => fails(k, post, (l) => l.splice(at(l, /^G0 Z/), 1)));
  it('R2 XY rapid below safe Z', () =>
    fails(k, post, (l) => l.splice(at(l, /^G0 X/), 0, 'G0 Z1.000')));
  it('R3 rapid into the material', () =>
    fails(k, post, (l) => (l[at(l, /^G0 Z\d+\.\d+$/, at(l, /^M3/))] = 'G0 Z-1.000')));
  it('R3 plunge replaced by a rapid below the top', () =>
    fails(k, post, (l) => (l[at(l, /^G1 Z/)] = 'G0 Z-2.000')));
  it('R4 spindle start removed', () => fails(k, post, (l) => l.splice(at(l, /^M3 S/), 1)));
  it('R4 warm-up dwell removed', () => fails(k, post, (l) => l.splice(at(l, /^G4 P/), 1)));
  it('R5 first cutting move without feed', () =>
    fails(k, post, (l) => {
      const i = at(l, /^G1 Z/);
      l[i] = (l[i] ?? '').replace(/ F\d+/, '');
    }));
  it('R6 X out of the envelope', () =>
    fails(k, post, (l) => (l[at(l, /^G0 X/)] = 'G0 X99999.000 Y90.000')));
  it('R6 Z above the envelope', () => fails(k, post, (l) => (l[at(l, /^G0 Z/)] = 'G0 Z9999.000')));
  it('R7 spindle off removed', () => fails(k, post, (l) => l.splice(at(l, /^M5$/), 1)));
  it('R7 end code removed', () => fails(k, post, (l) => l.splice(at(l, /^M30$/), 1)));
  it('R7 end park Z removed', () =>
    fails(k, post, (l) => l.splice(at(l, /^G0 Z/, at(l, /^M5$/) - 3), 1)));
  it('R8 exponent notation', () => fails(k, post, (l) => (l[at(l, /^G0 X/)] = 'G0 X1e2 Y90.000')));
  it('R8 NaN', () => fails(k, post, (l) => (l[at(l, /^G0 X/)] = 'G0 XNaN Y90.000')));
  it('R8 empty value', () => fails(k, post, (l) => (l[at(l, /^G0 X/)] = 'G0 X Y90.000')));
  it('R10 unverified header removed', () => fails(k, post, (l) => l.splice(0, 1)));
});

describe.each(POSTS)('test cut mutations (%s)', (post) => {
  const k: TestProgramKind = 'testCut';
  it('plunge becomes a rapid into the pocket', () =>
    fails(k, post, (l) => (l[at(l, /^G1 Z/)] = 'G0 Z-3.000')));
  it('R7 end code removed', () => fails(k, post, (l) => l.splice(at(l, /^M30$/), 1)));
  it('spindle start removed', () => fails(k, post, (l) => l.splice(at(l, /^M3 S/), 1)));
});

describe.each(POSTS)('air-cut floor (%s)', (post) => {
  const profiles: [string, (p: MachineProfile) => void][] = [
    ['default', () => undefined],
    ['table zero', (p) => (p.zZero = { reference: 'table', spoilboardAllowance: 0.5 })],
    [
      'thin 6mm',
      (p) => (p.materials = p.materials.map((m) => ({ ...m, thickness: 6, stepDown: 3 }))),
    ],
    [
      'thick 22mm',
      (p) => (p.materials = p.materials.map((m) => ({ ...m, thickness: 22, stepDown: 6 }))),
    ],
    [
      'big spoilboard allowance',
      (p) => (p.zZero = { reference: 'materialTop', spoilboardAllowance: 2 }),
    ],
    ['tool 6', (p) => (p.tools = p.tools.map((t) => (t.number === 2 ? { ...t, diameter: 6 } : t)))],
  ];
  it.each(profiles)(
    'every Z (rapids, leads, tool change, end park) >= gap above stock top: %s',
    (_n, edit) => {
      const { r, profile, text } = program('airCut', post, (p) => {
        p.workEnvelope = { ...p.workEnvelope, z: 300 };
        edit(p);
      });
      expect(r.ok, JSON.stringify([r.stage, r.toolpathIssues, r.postErrors, r.issues])).toBe(true);
      const th = profile.materials[0]?.thickness ?? 18;
      const top = profile.zZero.reference === 'table' ? th : 0;
      const zs = readGcode(text, { strict: true }).moves.map((m) => m.to.z);
      expect(Math.min(...zs)).toBeGreaterThanOrEqual(top + AIR_CUT_GAP - 1e-6);
      const raw = [...text.matchAll(/Z(-?\d+\.\d+)/g)].map((m) => Number(m[1]));
      expect(Math.min(...raw)).toBeGreaterThanOrEqual(top + AIR_CUT_GAP - 1e-6);
    },
  );
  it('deterministic', () => {
    expect(program('airCut', post).text).toBe(program('airCut', post).text);
  });
});

describe('pocket geometry', () => {
  for (const tool of [2, 3, 4, 6, 8, 10, 12, 16, 20]) {
    it(`tool Ø${tool}: no island, no gouge, no through cut, stepover <= tool`, () => {
      const p = goldenProfile('generic');
      p.tools = p.tools.map((t) => (t.number === 2 ? { ...t, diameter: tool } : t));
      const r = testPartToolpath(p);
      expect(r.ok, JSON.stringify(r.issues)).toBe(true);
      const ops = r.toolpath?.operations.filter((o) => o.kind === 'pocket') ?? [];
      expect(ops).toHaveLength(2);
      for (const op of ops) {
        const hole = op.partId === 'test-hole';
        const radius = hole ? TEST_PART.holeDiameter / 2 : TEST_PART.pocketDiameter / 2;
        const moves = operationMoves(op);
        const cx = moves[0]?.x ?? 0;
        const cy = moves[0]?.y ?? 0;
        const radii = [
          ...new Set(
            moves
              .filter((m) => m.kind === 'arc')
              .map((m) => Math.round(Math.hypot(m.x - cx, m.y - cy) * 1e6) / 1e6),
          ),
        ].sort((a, b) => a - b);
        expect(radii.at(-1) ?? 0).toBeCloseTo(radius - tool / 2, 5);
        expect(radii[0] ?? 0).toBeLessThanOrEqual(tool + 1e-6);
        for (let i = 1; i < radii.length; i++) {
          expect((radii[i] ?? 0) - (radii[i - 1] ?? 0)).toBeLessThanOrEqual(tool + 1e-6);
        }
        const zMin = Math.min(...moves.map((m) => m.z));
        if (hole) expect(zMin).toBeGreaterThanOrEqual(-18.5 - 1e-9);
        else expect(zMin).toBeGreaterThanOrEqual(-9 - 1e-9);
        for (const m of moves) if (m.kind === 'plunge') expect(m.feed).toBe(op.plungeFeed);
      }
      const pc = {
        x: TEST_PART.partAt.x + TEST_PART.pocketCentre.x,
        y: TEST_PART.partAt.y + TEST_PART.pocketCentre.y,
      };
      const hc = { x: TEST_PART.partAt.x + 100, y: TEST_PART.partAt.y + 100 };
      expect(Math.hypot(pc.x - hc.x, pc.y - hc.y) - 20).toBeGreaterThan(50);
    });
  }
  it('pocket depth is always < thickness for thicknesses 3..40', () => {
    for (let t = 3; t <= 40; t += 0.5) expect(testPocketDepth(t)).toBeLessThan(t);
  });
});

describe('measurement edge cases', () => {
  const info = {
    edge: 200,
    holeDiameter: 100,
    pocketDepth: 9,
    thickness: 18,
    tool: 2,
    toolDiameter: 8,
    zReference: 'materialTop' as const,
  };
  const diag = Math.hypot(200, 200);
  const ok = { edgeX: 200, edgeY: 200, diagonal: diag, holeDiameter: 100, pocketDepth: 9 };
  const sized = (e: number, h: number) => ({
    ...ok,
    edgeX: e,
    edgeY: e,
    diagonal: Math.hypot(e, e),
    holeDiameter: h,
  });
  it('exact nominal passes with no suggestions', () => {
    const e = evaluateTestCut(ok, info);
    expect(e.inTolerance).toBe(true);
    expect(e.suggestions).toEqual([]);
  });
  it('exact limits pass, just beyond fail (both signs)', () => {
    for (const s of [1, -1]) {
      expect(
        evaluateTestCut({ ...ok, edgeX: 200 + s * TEST_TOLERANCE.edge }, info).items[0]?.ok,
      ).toBe(true);
      expect(evaluateTestCut({ ...ok, edgeX: 200 + s * 0.2001 }, info).items[0]?.ok).toBe(false);
      expect(evaluateTestCut({ ...ok, pocketDepth: 9 + s * 0.2 }, info).inTolerance).toBe(true);
      expect(evaluateTestCut({ ...ok, pocketDepth: 9 + s * 0.21 }, info).inTolerance).toBe(false);
      expect(evaluateTestCut({ ...ok, holeDiameter: 100 + s * 0.2 }, info).inTolerance).toBe(true);
      expect(evaluateTestCut({ ...ok, holeDiameter: 100 + s * 0.21 }, info).inTolerance).toBe(
        false,
      );
      expect(evaluateTestCut({ ...ok, diagonal: diag + s * 0.3 }, info).inTolerance).toBe(true);
      expect(evaluateTestCut({ ...ok, diagonal: diag + s * 0.31 }, info).inTolerance).toBe(false);
    }
  });
  it('edges small + hole big by the same amount: tool bigger; the reverse: smaller', () => {
    expect(evaluateTestCut(sized(199.5, 100.5), info).suggestions).toEqual([
      { kind: 'toolDiameter', tool: 2, from: 8, to: 8.5 },
    ]);
    expect(evaluateTestCut(sized(200.5, 99.5), info).suggestions).toEqual([
      { kind: 'toolDiameter', tool: 2, from: 8, to: 7.5 },
    ]);
  });
  it('edges and hole disagree: axis scale, not tool', () => {
    const e = evaluateTestCut({ ...sized(201, 100) }, info);
    expect(e.suggestions.map((s) => s.kind)).toContain('axisScale');
    expect(e.suggestions.map((s) => s.kind)).not.toContain('toolDiameter');
  });
  it('tool correction never suggests <= 0', () => {
    const e = evaluateTestCut(sized(210, 90), info);
    expect(e.suggestions.some((s) => s.kind === 'toolDiameter' && s.to <= 0)).toBe(false);
  });
  it('pocket too deep: raise Z zero; too shallow: lower it', () => {
    expect(evaluateTestCut({ ...ok, pocketDepth: 9.5 }, info).suggestions).toEqual([
      { kind: 'zZero', direction: 'up', amount: 0.5 },
    ]);
    expect(evaluateTestCut({ ...ok, pocketDepth: 8.5 }, info).suggestions).toEqual([
      { kind: 'zZero', direction: 'down', amount: 0.5 },
    ]);
  });
  it('absurd inputs are rejected, nothing evaluated', () => {
    const bads: unknown[] = [NaN, Infinity, -Infinity, -5, 0, 2000, '200', null, undefined, {}, []];
    for (const bad of bads) {
      const e = evaluateTestCut({ ...ok, edgeX: bad }, info);
      expect(e.valid).toBe(false);
      expect(e.inTolerance).toBe(false);
    }
    expect(evaluateTestCut({}, info).valid).toBe(false);
  });
  it('a Turkish-comma string never silently passes server-side', () => {
    const e = evaluateTestCut({ ...ok, edgeX: '199,9' }, info);
    expect(e.valid).toBe(false);
    expect(e.inTolerance).toBe(false);
  });
  it('table zero requires thickness; real thickness shifts the nominal pocket depth', () => {
    const t = { ...info, zReference: 'table' as const };
    expect(evaluateTestCut(ok, t).valid).toBe(false);
    expect(evaluateTestCut({ ...ok, thickness: 18.4, pocketDepth: 9.4 }, t).inTolerance).toBe(true);
    expect(evaluateTestCut({ ...ok, thickness: 18.4, pocketDepth: 9 }, t).inTolerance).toBe(false);
  });
  it('diagonal-only error: squareness; deterministic', () => {
    const m = { ...ok, diagonal: diag + 1 };
    const a = evaluateTestCut(m, info);
    expect(a.suggestions.map((s) => s.kind)).toEqual(['squareness']);
    expect(evaluateTestCut(m, info)).toEqual(a);
  });
});
