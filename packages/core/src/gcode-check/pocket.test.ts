/**
 * T325: the independent pocket rule (LAYOUT): a cutting move inside a pocket must keep the tool
 * inside the boundary minus its radius and above the declared depth, and every pocket must be
 * cleared. Synthetic read moves plus a real export whose Z words are deepened.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { goldenProfile } from '../post/golden.testing';
import { defaultSheet, parseProject, type Project } from '../schema';
import { buildToolpath } from '../toolpath';
import { clone, projectOf } from '../toolpath/toolpath.testing';
import { checkGcodeFiles } from './check';
import { postConfig } from './check.testing';
import type { Derived } from './derive';
import { expectedLayouts } from './layout';
import type { SheetMove } from './path';
import { pocketMoveRule, pocketNotCutRule } from './pocket';
import type { GcodeCheckRule, ExpectedPart } from './types';

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];
const expected: ExpectedPart[] = [
  { partId: 'a', copy: 0, cx: 0, cy: 0, pockets: [{ inner: 0, boundary: square, depth: 5 }] },
];
const d = {
  posTol: 0.005,
  ctx: { profile: { tools: [{ number: 1, diameter: 6 }] } },
  // B62 fix r1: the radius is the active tool's, from the job's operations
  ops: [{ tool: 1, toolDiameter: 6 }],
} as unknown as Derived;

function feed(x0: number, y0: number, x1: number, y1: number, z0: number, z1 = z0): SheetMove {
  return {
    index: 0,
    line: 1,
    kind: 'feed',
    from: { x: x0, y: y0, z: z0 },
    to: { x: x1, y: y1, z: z1 },
    fromAssumed: [],
    toAssumed: [],
    raw: {} as SheetMove['raw'],
  };
}

function run(moves: SheetMove[]) {
  const found: string[] = [];
  const push = (_r: GcodeCheckRule, code: string) => found.push(code);
  const reached = pocketMoveRule(
    moves.map((m, i) => ({ ...m, index: i })),
    [],
    expected,
    d,
    push,
    moves.map(() => 1),
  );
  pocketNotCutRule(expected, reached, push);
  return found;
}

describe('pocket rule (T325)', () => {
  it('a floor pass inside the pocket minus r passes', () => {
    expect(run([feed(3, 3, 97, 3, -5), feed(97, 3, 97, 57, -5)])).toEqual([]);
  });

  it('a move closer to the wall than the tool radius, or leaving the pocket, is caught', () => {
    expect(run([feed(3, 3, 98, 3, -5)])).toEqual(['POCKET_OUTSIDE_BOUNDARY']);
    expect(run([feed(50, 30, 150, 30, -5)])).toEqual(['POCKET_OUTSIDE_BOUNDARY']);
  });

  it('a move below the declared depth is caught; a pocket never reached is reported', () => {
    expect(run([feed(10, 10, 50, 10, -5.2)])).toEqual(['POCKET_TOO_DEEP']);
    expect(run([feed(10, 10, 50, 10, -2)])).toEqual(['POCKET_NOT_CUT']);
    expect(run([])).toEqual(['POCKET_NOT_CUT']);
  });

  it('a ramp inside (Z changing along the move) is judged along its length', () => {
    expect(run([feed(10, 10, 90, 10, 0, -5)])).toEqual([]);
    expect(run([feed(10, 10, 90, 10, 0, -6)])).toEqual(['POCKET_TOO_DEEP']);
  });
});

describe('pocket rule on a real export (T325)', () => {
  function project(): Project {
    const p = clone(
      projectOf({
        parts: [{ id: 'a', w: 300, h: 200 }],
        placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
      }),
    ) as unknown as { parts: Record<string, unknown>[] };
    (p.parts[0] as Record<string, unknown>)['inners'] = [
      [
        { x: 40, y: 40, bulge: 0 },
        { x: 40, y: 120, bulge: 0 },
        { x: 140, y: 120, bulge: 0 },
        { x: 140, y: 40, bulge: 0 },
      ],
    ];
    const r = parseProject(p);
    if (!r.ok) throw new Error('fixture');
    const c = applyCommand(r.project, 'setOperation', {
      id: 'a',
      contour: { type: 'inner', index: 0 },
      kind: 'pocket',
      depth: 5,
    });
    if (!c.ok) throw new Error('fixture');
    return c.project;
  }

  it('the generated program passes; the same program 0.4 mm deeper in the pocket is refused', () => {
    const p = project();
    const prof = goldenProfile('generic');
    const out = exportNc(
      p,
      { profile: prof, version: 1, verification: 'draft' },
      postConfig('generic'),
    );
    expect(out.ok).toBe(true);
    const tp = buildToolpath(p, prof);
    const context = {
      profile: prof,
      verification: 'draft' as const,
      post: postConfig('generic'),
      toolpath: tp.toolpath,
      stock: {
        thickness: p.stock.thickness,
        sheetWidth: defaultSheet(p).width,
        sheetHeight: defaultSheet(p).height,
      },
      layout: expectedLayouts(p, tp.toolpath.operations[0]?.toolDiameter ?? 0),
    };
    const file = out.files[0];
    if (!file) throw new Error('no file');
    expect(checkGcodeFiles([file], context).ok).toBe(true);
    const zDeep = file.content.replace(/Z-5(\.0+)?(?=\D|$)/gm, 'Z-5.4');
    expect(zDeep).not.toBe(file.content);
    const res = checkGcodeFiles([{ ...file, content: zDeep }], context);
    expect(res.violations.map((v) => v.code)).toContain('POCKET_TOO_DEEP');
  });
});
