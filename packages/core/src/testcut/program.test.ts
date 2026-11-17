/**
 * T022: air-cut and test-cut programs through the real post processors and the automatic checks.
 */
import { describe, expect, it } from 'vitest';
import { postAndCheck } from '../export/export';
import { canDownload, checkGcode } from '../gcode-check';
import { readGcode } from '../gcode-reader';
import { goldenProfile, GOLDEN_POSTS } from '../post/golden.testing';
import type { MachineProfile, VerificationState } from '../machine';
import { parsePostConfig } from '../post';
import { operationMoves, throughCutTarget, type Toolpath } from '../toolpath';
import {
  AIR_CUT_GAP,
  TEST_PART,
  airCutToolpath,
  testPartToolpath,
  testPocketDepth,
  testProgram,
  type TestProgramKind,
} from './program';

const POSTS = GOLDEN_POSTS.map((p) => [p.id, p.config] as const);
const KINDS: TestProgramKind[] = ['airCut', 'testCut'];

function run(
  kind: TestProgramKind,
  post: 'generic' | 'mach3',
  edit: (p: MachineProfile) => void = () => undefined,
  verification: VerificationState = 'draft',
) {
  const profile = goldenProfile(post);
  edit(profile);
  const config = GOLDEN_POSTS.find((p) => p.id === post)?.config;
  return testProgram(kind, { profile, version: 3, verification }, config);
}

function readZ(text: string, dwellUnit: 's' | 'ms' = 's') {
  const r = readGcode(text, { strict: true, dwellUnit });
  return r.moves.filter((m) => m.assumedAxes.length === 0).map((m) => m.to.z);
}

describe.each(POSTS)('%s post', (post) => {
  it.each(KINDS)('%s: passes the post and every automatic check', (kind) => {
    const r = run(kind, post);
    expect(r.issues).toEqual([]);
    expect(r.postErrors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.stage).toBe('done');
    expect(r.check?.ok).toBe(true);
    expect(r.check?.violations.filter((v) => v.severity === 'error')).toEqual([]);
    expect(r.files).toHaveLength(1);
  });

  it.each(KINDS)('%s: deterministic (same input, same bytes)', (kind) => {
    expect(run(kind, post).files).toEqual(run(kind, post).files);
  });

  it.each(KINDS)('%s: tool change, spindle start, warm-up, stop and end are all there', (kind) => {
    const text = run(kind, post).files[0]?.content ?? '';
    const lines = text.split('\r\n');
    const idx = (re: RegExp) => lines.findIndex((l) => re.test(l));
    const toolChange = post === 'generic' ? idx(/^T2 M6/) : idx(/^M0$/);
    const spindle = idx(/^M3 S\d+/);
    const dwell = idx(/^G4 P/);
    const firstFeed = idx(/^G1 /);
    const stop = idx(/^M5$/);
    const end = idx(/^M30$/);
    expect(toolChange).toBeGreaterThan(0);
    expect(spindle).toBeGreaterThan(toolChange);
    expect(dwell).toBeGreaterThan(spindle);
    expect(firstFeed).toBeGreaterThan(dwell);
    expect(stop).toBeGreaterThan(firstFeed);
    expect(end).toBeGreaterThan(stop);
  });

  it('air cut: never below the gap above the material top, test cut: reaches the target', () => {
    const air = readZ(run('airCut', post).files[0]?.content ?? '');
    const cut = readZ(run('testCut', post).files[0]?.content ?? '');
    expect(Math.min(...air)).toBeGreaterThanOrEqual(AIR_CUT_GAP - 1e-9);
    expect(Math.min(...cut)).toBeCloseTo(throughCutTarget(18, 0.5), 3);
  });

  it('air cut with Z zero on the table: still the gap above the material top', () => {
    const r = run('airCut', post, (p) => {
      p.zZero = { reference: 'table', spoilboardAllowance: 0.5 };
    });
    expect(r.ok).toBe(true);
    // Machine Z = sheet Z + thickness when Z zero is the table.
    expect(Math.min(...readZ(r.files[0]?.content ?? ''))).toBeGreaterThanOrEqual(
      AIR_CUT_GAP + 18 - 1e-9,
    );
  });

  it('air cut has the same XY path as the test cut', () => {
    const xy = (kind: TestProgramKind) =>
      readGcode(run(kind, post).files[0]?.content ?? '', { strict: true }).moves.map(
        (m) => `${m.type} ${m.to.x.toFixed(4)} ${m.to.y.toFixed(4)}`,
      );
    expect(xy('airCut')).toEqual(xy('testCut'));
  });

  it('unverified profile: first line is the air-cut warning', () => {
    const text = run('airCut', post).files[0]?.content ?? '';
    expect(text.split('\r\n')[0]).toBe('(DOGRULANMADI, once air cut)');
  });

  it('a profile whose Z travel cannot hold the raised air cut gets no file', () => {
    const r = run('airCut', post, (p) => {
      p.workEnvelope = { ...p.workEnvelope, z: 50 };
    });
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
    expect(r.postErrors.map((e) => e.code)).toContain('OUT_OF_ENVELOPE');
  });

  it('test cut: the check sees the part and the hole cut through at the part centre', () => {
    const r = run('testCut', post);
    const summary = r.check?.files[0]?.result.summary;
    expect(summary?.partsCut).toBe(2);
    expect(summary?.partsExpected).toBe(2);
  });
});

describe('testPartToolpath', () => {
  const profile = goldenProfile('mach3');

  it('pocket, hole, then the outer contour (§6.3 order)', () => {
    const r = testPartToolpath(profile);
    expect(r.ok).toBe(true);
    expect(r.toolpath?.operations.map((o) => [o.kind, o.partId])).toEqual([
      ['pocket', 'test-pocket'],
      ['pocket', 'test-hole'],
      ['outerContour', 'test'],
    ]);
  });

  it('finished radii: pocket wall and hole wall at radius − tool radius; depths', () => {
    const r = testPartToolpath(profile);
    const [pocket, hole] = r.toolpath?.operations ?? [];
    const toolR = 4;
    const maxR = (op: typeof pocket, cx: number, cy: number) =>
      Math.max(...(op ? operationMoves(op) : []).map((m) => Math.hypot(m.x - cx, m.y - cy)));
    const pc = { x: TEST_PART.partAt.x + 40, y: TEST_PART.partAt.y + 40 };
    expect(maxR(pocket, pc.x, pc.y)).toBeCloseTo(TEST_PART.pocketDiameter / 2 - toolR, 9);
    expect(maxR(hole, 150, 150)).toBeCloseTo(TEST_PART.holeDiameter / 2 - toolR, 9);
    expect(pocket?.passDepths.at(-1)).toBe(-testPocketDepth(18));
    expect(hole?.passDepths.at(-1)).toBe(throughCutTarget(18, 0.5));
    expect(r.info).toMatchObject({ edge: 200, holeDiameter: 100, pocketDepth: 9, tool: 2 });
  });

  it('ring step never exceeds 40 % of the tool diameter', () => {
    const r = testPartToolpath(profile);
    for (const op of r.toolpath?.operations.filter((o) => o.kind === 'pocket') ?? []) {
      const pass = op.segments.find((s) => s.role === 'pass');
      const xs = (pass?.moves ?? []).filter((m) => m.kind === 'linear').map((m) => m.x);
      const steps = xs.slice(1, -1).map((x, i) => x - (xs[i] ?? 0));
      for (const s of steps) expect(s).toBeLessThanOrEqual(0.4 * 8 + 1e-9);
    }
  });

  it('pocket depth: half the thickness to 0.1 mm', () => {
    expect(testPocketDepth(18)).toBe(9);
    expect(testPocketDepth(12.5)).toBe(6.2);
    expect(testPocketDepth(19)).toBe(9.5);
  });

  it('no material set → NO_MATERIAL_SET', () => {
    const p = goldenProfile('mach3');
    p.materials = [];
    expect(testPartToolpath(p).issues.map((i) => i.code)).toEqual(['NO_MATERIAL_SET']);
  });

  it('tool larger than half the pocket → TEST_TOOL_TOO_LARGE', () => {
    const p = goldenProfile('mach3');
    p.tools = p.tools.map((t) => (t.number === 2 ? { ...t, diameter: 25 } : t));
    expect(testPartToolpath(p).issues.map((i) => i.code)).toContain('TEST_TOOL_TOO_LARGE');
  });

  it('stock too thin for a measurable pocket → TEST_STOCK_TOO_THIN', () => {
    const p = goldenProfile('mach3');
    p.materials = p.materials.map((m) => ({ ...m, thickness: 1.5 }));
    expect(testPartToolpath(p).issues.map((i) => i.code)).toContain('TEST_STOCK_TOO_THIN');
  });

  it('the material set can be chosen by index', () => {
    const p = goldenProfile('mach3');
    const first = p.materials[0];
    if (!first) throw new Error('fixture');
    p.materials = [first, { ...first, thickness: 12, stepDown: 4 }];
    expect(testPartToolpath(p, { materialIndex: 1 }).info?.thickness).toBe(12);
    expect(testPartToolpath(p, { materialIndex: 5 }).issues[0]?.code).toBe('NO_MATERIAL_SET');
  });
});

describe('airCutToolpath', () => {
  it('raises every Z by the same shift and keeps XY, feeds and order', () => {
    const tp = testPartToolpath(goldenProfile('generic')).toolpath;
    if (!tp) throw new Error('fixture');
    const air = airCutToolpath(tp, 25);
    const a = air.operations.flatMap(operationMoves);
    const b = tp.operations.flatMap(operationMoves);
    expect(a).toHaveLength(b.length);
    const shift = 25 - Math.min(...b.map((m) => m.z));
    a.forEach((m, i) => {
      const o = b[i];
      expect(m.x).toBe(o?.x);
      expect(m.y).toBe(o?.y);
      expect(m.z).toBeCloseTo((o?.z ?? 0) + shift, 9);
      expect(m.kind).toBe(o?.kind);
    });
    expect(Math.min(...a.map((m) => m.z))).toBeCloseTo(25, 9);
    expect(air.safeZ).toBeCloseTo(tp.safeZ + shift, 9);
    expect(air.targetDepth).toBe(tp.targetDepth);
  });
});

/**
 * PO hardening (T022, D-031): the air-cut floor is enforced twice, independently of the constant
 * gap the builder uses today. Failing inputs: a gap below the floor, and a program whose moves go
 * below "stock top + AIR_CUT_GAP" (the checks must refuse it, so `canDownload` blocks the file).
 */
describe('air-cut floor guard', () => {
  const testTp = () => {
    const tp = testPartToolpath(goldenProfile('generic')).toolpath;
    if (!tp) throw new Error('fixture');
    return tp;
  };

  it.each([AIR_CUT_GAP - 0.001, 19, 10, 0, -5, Number.NaN, Number.NEGATIVE_INFINITY])(
    'airCutToolpath refuses gap %s',
    (gap) => {
      expect(() => airCutToolpath(testTp(), gap)).toThrow(RangeError);
    },
  );
  it('airCutToolpath accepts the floor itself and more', () => {
    for (const gap of [AIR_CUT_GAP, AIR_CUT_GAP + 10]) {
      const moves = airCutToolpath(testTp(), gap).operations.flatMap(operationMoves);
      expect(Math.min(...moves.map((m) => m.z))).toBeCloseTo(gap, 9);
    }
  });

  function postOf(
    post: 'generic' | 'mach3',
    toolpath: Toolpath,
    zFloor: number | undefined,
    edit: (p: MachineProfile) => void = () => undefined,
  ) {
    const profile = goldenProfile(post);
    edit(profile);
    const config = GOLDEN_POSTS.find((p) => p.id === post)?.config;
    return postAndCheck(toolpath, [], { profile, version: 1, verification: 'draft' }, config, {
      projectName: 'FLOOR',
      revision: 0,
      fileStem: 'FLOOR',
      stock: { material: 'MDF', thickness: 18, sheetWidth: 300, sheetHeight: 300 },
      layout: null,
      ...(zFloor !== undefined ? { zFloor } : {}),
    });
  }
  const codes = (r: ReturnType<typeof postOf>) =>
    (r.check?.violations ?? []).map((v) => `${v.rule}/${v.code}`);

  describe.each(['generic', 'mach3'] as const)('%s post', (post) => {
    it('a program that passes every other check is refused when it goes below the floor', () => {
      // The test-cut toolpath is a valid program; as an "air cut" it reaches into the material.
      const plain = postOf(post, testTp(), undefined);
      expect(plain.ok).toBe(true);
      const floored = postOf(post, testTp(), AIR_CUT_GAP);
      expect(floored.ok).toBe(false);
      expect(floored.stage).toBe('check');
      expect(floored.files).toEqual([]);
      expect(codes(floored)).toContain('R3/AIR_CUT_BELOW_FLOOR');
      expect(floored.check ? canDownload(floored.check) : true).toBe(false);
    });
    it('a raised program only slightly too low (gap 19.9 mm, guard bypassed) is refused', () => {
      const air = airCutToolpath(testTp(), AIR_CUT_GAP);
      const low: Toolpath = {
        ...air,
        operations: air.operations.map((op) => ({
          ...op,
          segments: op.segments.map((s) => ({
            ...s,
            moves: s.moves.map((m) => (m.z <= AIR_CUT_GAP + 1e-9 ? { ...m, z: m.z - 0.1 } : m)),
          })),
        })),
      };
      const r = postOf(post, low, AIR_CUT_GAP);
      expect(r.ok).toBe(false);
      expect(codes(r)).toContain('R3/AIR_CUT_BELOW_FLOOR');
    });
    it('the real air cut passes the floor (top and table zero)', () => {
      const r = run('airCut', post);
      expect(r.ok).toBe(true);
      expect(codes(r)).not.toContain('R3/AIR_CUT_BELOW_FLOOR');
      const t = run('airCut', post, (p) => {
        p.zZero = { reference: 'table', spoilboardAllowance: 0.5 };
        p.workEnvelope = { ...p.workEnvelope, z: 300 };
      });
      expect(t.ok, JSON.stringify(t.check?.violations)).toBe(true);
    });
    it('table zero: the floor is measured from the material top, not the table', () => {
      const edit = (p: MachineProfile) => {
        p.zZero = { reference: 'table', spoilboardAllowance: 0.5 };
        p.workEnvelope = { ...p.workEnvelope, z: 300 };
      };
      // Gap 20 above the top passes; a floor of 20 + thickness would wrongly need 38 above it.
      expect(postOf(post, airCutToolpath(testTp(), AIR_CUT_GAP), AIR_CUT_GAP, edit).ok).toBe(true);
      expect(postOf(post, testTp(), AIR_CUT_GAP, edit).ok).toBe(false);
    });
  });

  it.each(['airCut', 'testCut'] as const)(
    'text mutations below the floor are refused by the %s-agnostic floor rule',
    (kind) => {
      const r = run('airCut', 'generic');
      const text = r.files[0]?.content ?? '';
      const lines = text.split('\r\n');
      // End park, tool change and leads are all G0 Z lines: drop one of them to Z 5 (above the
      // clearance of a normal program, below the air-cut floor).
      const last = lines.map((l, i) => [l, i] as const).filter(([l]) => /^G0 Z/.test(l));
      const target = kind === 'airCut' ? last.at(-1) : last[0];
      if (!target) throw new Error('anchor');
      lines[target[1]] = 'G0 Z5.000';
      const tp = airCutToolpath(testTp());
      const parsed = parsePostConfig(GOLDEN_POSTS.find((p) => p.id === 'generic')?.config);
      if (!parsed.ok) throw new Error('post');
      const res = checkGcode(lines.join('\r\n'), {
        profile: goldenProfile('generic'),
        verification: 'draft',
        post: parsed.config,
        toolpath: tp,
        stock: { thickness: 18, sheetWidth: 300, sheetHeight: 300 },
        sheet: 0,
        zFloor: AIR_CUT_GAP,
      });
      expect(canDownload(res)).toBe(false);
      expect(res.violations.map((v) => `${v.rule}/${v.code}`)).toContain('R3/AIR_CUT_BELOW_FLOOR');
    },
  );

  it('an invalid floor is an INPUT failure, never a pass', () => {
    const r = postOf('generic', airCutToolpath(testTp()), Number.NaN);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('INPUT/Z_FLOOR_INVALID');
  });
});
