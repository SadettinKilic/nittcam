/* eslint-disable @typescript-eslint/no-non-null-assertion -- test lookups on known fixtures */
/**
 * T145: join within JOIN_TOL, part recognition (outer = part, inside = inner, island = part),
 * layer mapping and the `importDxf` command (one undo step).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCommand, CommandStack, type CommandContext } from '../commands';
import { JOIN_TOL } from '../geometry/constants';
import { orientation, reverse, signedArea } from '../geometry/polyline';
import type { Polyline, Vertex } from '../geometry/types';
import { projectOf } from '../toolpath/toolpath.testing';
import { joinPaths } from './join';
import { layerKey, layerOp, mergeLayerMap, dxfLayerMapSchema } from './layers';
import { dxfImportParts, planDxfImport } from './plan';
import { readDxf } from './read';
import { recognizeParts } from './recognize';
import { defaultOnlineDepth } from '../editor/lines';
import type { DxfDrawing, DxfPath } from './types';

const ctx: CommandContext = { actor: 'user', at: '2026-11-19T10:00:00Z' };

function load(name: string): DxfDrawing {
  const r = readDxf(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const piece = (layer: string, vs: Vertex[], closed = false): DxfPath => ({
  layer,
  type: 'LINE',
  poly: { vertices: vs, closed },
});
const rect = (x: number, y: number, w: number, h: number): Vertex[] => [
  v(x, y),
  v(x + w, y),
  v(x + w, y + h),
  v(x, y + h),
];

describe('joinPaths', () => {
  it('rect-lines-gaps: four lines with gaps ≤ 0.05 mm close, the duplicate is dropped', () => {
    const j = joinPaths(load('rect-lines-gaps.dxf').paths);
    expect(j.duplicates).toBe(1);
    expect(j.contours).toHaveLength(1);
    expect(j.contours[0]!.pieces).toBe(4);
    expect(j.contours[0]!.poly.vertices).toHaveLength(4);
    // gaps snap to the earlier end: the area moves by less than gap × side
    expect(Math.abs(Math.abs(signedArea(j.contours[0]!.poly)) - 600 * 400)).toBeLessThan(
      JOIN_TOL * 1000,
    );
    expect(j.open).toEqual([
      { layer: 'SCRIBE', pieces: 1, poly: { closed: false, vertices: [v(100, 100), v(200, 100)] } },
    ]);
  });

  it('a gap larger than JOIN_TOL stays open', () => {
    const j = joinPaths([
      piece('A', [v(0, 0), v(100, 0)]),
      piece('A', [v(100, 0), v(100, 100)]),
      piece('A', [v(100, 100), v(0, 100)]),
      piece('A', [v(0, 100), v(0, 0.06)]),
    ]);
    expect(j.contours).toHaveLength(0);
    expect(j.open).toHaveLength(1);
    expect(j.open[0]!.pieces).toBe(4);
  });

  it('never joins across layers', () => {
    const j = joinPaths([
      piece('A', [v(0, 0), v(100, 0), v(100, 100)]),
      piece('B', [v(100, 100), v(0, 100), v(0, 0)]),
    ]);
    expect(j.contours).toHaveLength(0);
    expect(j.open.map((o) => o.layer)).toEqual(['A', 'B']);
  });

  it('keeps arcs when joining reversed pieces (two half circles)', () => {
    const j = joinPaths([
      piece('A', [v(10, 0, 1), v(-10, 0)]),
      piece('A', [v(10, 0, -1), v(-10, 0)]),
    ]);
    expect(j.contours).toHaveLength(1);
    expect(Math.abs(signedArea(j.contours[0]!.poly))).toBeCloseTo(Math.PI * 100, 9);
  });

  it('property: a closed shape cut into a shuffled, partly reversed soup with jitter rejoins', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 24 }),
        fc.double({ min: 20, max: 1000, noNaN: true }),
        fc.array(fc.double({ min: -0.5, max: 0.5, noNaN: true }), { minLength: 1, maxLength: 1 }),
        fc.infiniteStream(fc.boolean()),
        fc.infiniteStream(fc.double({ min: -JOIN_TOL / 3, max: JOIN_TOL / 3, noNaN: true })),
        fc.infiniteStream(fc.integer({ min: 0, max: 1_000_000 })),
        (n, r, [bulgeBase], flips, jitter, order) => {
          // A star-ish polygon with some arc segments: vertices on a circle, bulges small.
          const vs: Vertex[] = Array.from({ length: n }, (_, i) => {
            const t = (2 * Math.PI * i) / n;
            const rr = i % 2 ? r : r * 0.6;
            return v(rr * Math.cos(t), rr * Math.sin(t), i % 3 === 0 ? (bulgeBase ?? 0) * 0.2 : 0);
          });
          const truth: Polyline = { vertices: vs, closed: true };
          const segs: DxfPath[] = vs.map((a, i) => {
            const b = vs[(i + 1) % n]!;
            const jx = jitter.next().value;
            const jy = jitter.next().value;
            let seg: Polyline = {
              vertices: [v(a.x, a.y, a.bulge), v(b.x + jx, b.y + jy)],
              closed: false,
            };
            if (flips.next().value) seg = reverse(seg);
            return { layer: 'L', type: 'LINE', poly: seg };
          });
          // Shuffle deterministically from the generated stream.
          for (let i = segs.length - 1; i > 0; i--) {
            const k = order.next().value % (i + 1);
            [segs[i], segs[k]] = [segs[k]!, segs[i]!];
          }
          const j = joinPaths(segs);
          expect(j.open).toHaveLength(0);
          expect(j.contours).toHaveLength(1);
          expect(j.contours[0]!.pieces).toBe(n);
          expect(j.contours[0]!.poly.vertices).toHaveLength(n);
          const tolArea = 4 * n * r * JOIN_TOL;
          expect(
            Math.abs(Math.abs(signedArea(j.contours[0]!.poly)) - Math.abs(signedArea(truth))),
          ).toBeLessThan(tolArea);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('recognizeParts', () => {
  it('sign-letters: N, O (with its counter) and the gappy L line soup become 3 parts', () => {
    const plan = planDxfImport(load('sign-letters.dxf'));
    expect(plan.parts).toHaveLength(3);
    expect(plan.open).toHaveLength(0);
    const [n, o, l] = plan.parts;
    expect(n!.inners).toHaveLength(0);
    expect(o!.inners).toHaveLength(1);
    expect(o!.inners[0]!.circle).toEqual({ cx: 300, cy: 100, d: 100 });
    expect(l!.outline.vertices).toHaveLength(6);
    for (const p of plan.parts) {
      expect(orientation(p.outline)).toBe('ccw');
      for (const i of p.inners) expect(orientation(i.poly)).toBe('cw');
    }
  });

  it('an island inside a cut-out is a part again; forced layers override geometry', () => {
    const j = joinPaths([
      piece('A', rect(0, 0, 300, 300), true),
      piece('A', rect(50, 50, 200, 200), true),
      piece('A', rect(100, 100, 50, 50), true),
      piece('SCRAP', rect(-100, -100, 600, 600), true),
    ]);
    const auto = recognizeParts(j, { SCRAP: 'ignore' });
    expect(auto.parts.map((p) => p.inners.length)).toEqual([1, 0]);
    expect(auto.ignored).toBe(1);
    // Without ignoring the frame, the frame is the part and the 300 square its cut-out.
    const framed = recognizeParts(j, {});
    expect(framed.parts).toHaveLength(2);
    expect(framed.parts[0]!.box.minX).toBe(-100);
    // Forcing A to "outside" makes every A contour a part.
    const forced = recognizeParts(j, { A: 'outside', SCRAP: 'ignore' });
    expect(forced.parts).toHaveLength(3);
    expect(forced.parts.every((p) => p.inners.length === 0)).toBe(true);
  });

  it('inside/drill contours outside any part are orphans; pocket waits', () => {
    const j = joinPaths([
      piece('OUT', rect(0, 0, 100, 100), true),
      piece('IN', rect(200, 0, 10, 10), true),
      piece('POCKET', rect(10, 10, 10, 10), true),
    ]);
    const r = recognizeParts(j, { IN: 'inside', POCKET: 'pocket' });
    expect(r.parts).toHaveLength(1);
    expect(r.orphans.map((o) => o.layer)).toEqual(['IN']);
    expect(r.pending.map((o) => o.layer)).toEqual(['POCKET']);
  });

  it('insert-block: drill-layer circles become holes when a hole tool is given', () => {
    const plan = planDxfImport(load('lwpoly-bulge.dxf'), { HOLES: 'drill', MISC: 'ignore' });
    expect(plan.parts).toHaveLength(1);
    const ids = (i: number) => `p${i}`;
    const names = (i: number) => `Parça ${i + 1}`;
    const withTool = dxfImportParts(plan, ids, names, 3);
    expect(withTool[0]!.holes).toEqual([
      { type: 'through', id: 'h1', d: 20, cx: 50, cy: 50, tool: 3 },
    ]);
    expect(withTool[0]!.inners).toHaveLength(1); // the slot
    const noTool = dxfImportParts(plan, ids, names);
    expect(noTool[0]!.holes).toEqual([]);
    expect(noTool[0]!.inners).toHaveLength(2);
  });
});

describe('layer mapping', () => {
  it('keys are case-insensitive; unmapped = auto', () => {
    expect(layerKey('  Kesim ')).toBe('KESIM');
    expect(layerOp({ KESIM: 'outside' }, 'kesim')).toBe('outside');
    expect(layerOp({}, 'x')).toBe('auto');
  });

  it('merge keeps other layers, replaces chosen ones and drops auto', () => {
    expect(mergeLayerMap({ A: 'drill', B: 'ignore' }, { b: 'auto', c: 'inside' })).toEqual({
      A: 'drill',
      C: 'inside',
    });
  });

  it('schema rejects unknown operations', () => {
    expect(dxfLayerMapSchema.safeParse({ A: 'laser' }).success).toBe(false);
    expect(dxfLayerMapSchema.safeParse({ A: 'online' }).success).toBe(true);
  });
});

describe('importDxf command', () => {
  const plan = planDxfImport(load('sign-letters.dxf'));
  const parts = dxfImportParts(
    plan,
    (i) => `dxf-${i + 1}`,
    (i) => `Harf ${i + 1}`,
  );

  it('adds every part in one undo step; undo restores the project byte for byte', () => {
    const start = projectOf({ parts: [{ id: 'a', w: 500, h: 300 }] });
    const stack = new CommandStack(start);
    const res = stack.execute('importDxf', { parts }, ctx);
    expect(res.ok).toBe(true);
    const after = stack.project;
    expect(after.parts.map((p) => p.id)).toEqual(['a', 'dxf-1', 'dxf-2', 'dxf-3']);
    const o = after.parts[2]!;
    expect(o.kind).toBe('freeform');
    expect(o.inners).toHaveLength(1);
    // Placed right of the existing part, relative layout of the drawing kept.
    const n = after.parts[1]!;
    expect(n.draw!.x).toBeGreaterThanOrEqual(500);
    expect(o.draw!.x - n.draw!.x).toBeCloseTo(200, 6);
    expect(stack.undo()).toBe(true);
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(start));
  });

  it('stores outlines CCW and inners CW in the part frame', () => {
    const r = applyCommand(projectOf({ parts: [] }), 'importDxf', { parts, at: { x: 0, y: 0 } });
    if (!r.ok) throw new Error(r.error.message);
    const o = r.project.parts[1]!;
    if (o.kind !== 'freeform') throw new Error('kind');
    expect(o.draw).toEqual({ x: 200, y: 0 });
    expect(orientation({ vertices: o.outline, closed: true })).toBe('ccw');
    expect(orientation({ vertices: o.inners[0]!, closed: true })).toBe('cw');
    expect(Math.min(...o.outline.map((p) => p.x))).toBeCloseTo(0, 9);
  });

  it('rejects duplicate or taken ids', () => {
    const dup = applyCommand(projectOf({ parts: [] }), 'importDxf', {
      parts: [parts[0], parts[0]],
    });
    expect(dup.ok).toBe(false);
    const taken = applyCommand(projectOf({ parts: [{ id: 'dxf-1', w: 10, h: 10 }] }), 'importDxf', {
      parts,
    });
    expect(taken.ok).toBe(false);
  });
});

describe('T277: "Çizgi üzerinden" layers become on-line lines of their part', () => {
  const j = () =>
    joinPaths([
      piece('0', rect(100, 100, 300, 200), true),
      // open engraving line inside the part, a closed text frame inside, one line outside
      piece('GRAVUR', [v(150, 150), v(250, 150)]),
      piece('GRAVUR', rect(300, 150, 40, 40), true),
      piece('GRAVUR', [v(500, 150), v(600, 150)]),
    ]);

  it('lines inside a part are attached to it; a line in no part is reported, not imported', () => {
    const r = recognizeParts(j(), { GRAVUR: 'online' });
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]!.inners).toHaveLength(0);
    expect(r.parts[0]!.lines).toHaveLength(2);
    expect(r.open).toEqual([]);
    expect(r.pending).toEqual([]);
    expect(r.lineOrphans).toHaveLength(1);
    // the closed frame comes back as an open line that ends where it starts
    const frame = r.parts[0]!.lines.find((l) => l.poly.vertices.length === 5)!;
    expect(frame.poly.vertices[4]).toEqual(
      frame.poly.vertices[0] && { ...frame.poly.vertices[0], bulge: 0 },
    );
  });

  it('importDxf stores them part-local with the given depth; in the part frame', () => {
    const plan = recognizeParts(j(), { GRAVUR: 'online' });
    const parts = dxfImportParts(
      plan,
      () => 'sign',
      () => 'Tabela',
      undefined,
      1,
    );
    expect(parts[0]!.lines.map((l) => l.op)).toEqual([
      { kind: 'online', depth: 1 },
      { kind: 'online', depth: 1 },
    ]);
    const r = applyCommand(projectOf({ parts: [] }), 'importDxf', { parts, at: { x: 0, y: 0 } });
    if (!r.ok) throw new Error(r.error.message);
    const part = r.project.parts[0]!;
    expect(part.lines?.map((l) => l.vertices.map((p) => [p.x, p.y]))).toContainEqual([
      [50, 50],
      [150, 50],
    ]);
  });

  it('default depth: 1 mm, half the thickness on stock of 1 mm or less', () => {
    expect(defaultOnlineDepth(18)).toBe(1);
    expect(defaultOnlineDepth(1)).toBe(0.5);
    expect(defaultOnlineDepth(0.8)).toBe(0.4);
  });
});
