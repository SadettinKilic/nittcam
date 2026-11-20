/**
 * B50 tester: "Ortasına köşe ekle" (splitSegment) end to end. A rectangle gets a corner split in,
 * the new corner is moved to make a V-notch, and two splits + one move make an L. Both parts go
 * through nesting → toolpath → post → independent reader: the read tool-centre path never enters
 * a part and keeps at least the tool radius from every placed outline (spec §7.2), and the
 * G-code check reports no violations. Plus: the split alone keeps the outline (area, bbox).
 */
import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { forEachSegment } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Point, Polyline, Vertex } from '../geometry/types';
import { nestProject } from '../nesting';
import { exportNc } from '../export';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { deriveOutline, type Part, type Project } from '../schema';
import { placedOutline } from '../toolpath/build';
import { applyCommand } from './index';

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const TOOL_D = 8;
const R = TOOL_D / 2;
const RECT: Vertex[] = [v(0, 0), v(600, 0), v(600, 400), v(0, 400)];

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

function outlineOf(p: Project, id: string): Vertex[] {
  return deriveOutline(p.parts.find((x) => x.id === id) as Part);
}

function area(vs: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i] as Point;
    const b = vs[(i + 1) % vs.length] as Point;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function indexOf(vs: readonly Vertex[], x: number, y: number): number {
  const i = vs.findIndex((q) => Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6);
  if (i < 0) throw new Error(`no vertex at ${x},${y}`);
  return i;
}

function segIndex(vs: readonly Vertex[], a: Point, b: Point): number {
  return indexOf(vs, a.x, a.y) === (indexOf(vs, b.x, b.y) - 1 + vs.length) % vs.length
    ? indexOf(vs, a.x, a.y)
    : indexOf(vs, b.x, b.y);
}

function polyPoints(pl: Polyline): Point[] {
  const pts: Point[] = [];
  forEachSegment(pl, (a, b, bulge) => {
    const s = sampleSegment(a, b, bulge, 64);
    s.pop();
    pts.push(...s);
  });
  return pts;
}

function inside(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function distTo(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Point;
    const b = poly[(i + 1) % poly.length] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

function cutPoints(content: string): Point[] {
  const read = readGcode(content);
  expect(read.errors).toEqual([]);
  const out: Point[] = [];
  for (const m of read.moves) {
    if (m.type === 'rapid' || Math.min(m.from.z, m.to.z) >= 0) continue;
    if (m.arc) {
      const a0 = Math.atan2(m.from.y - m.arc.cy, m.from.x - m.arc.cx);
      const sweep = m.arc.direction === 'ccw' ? Math.abs(m.arc.sweep) : -Math.abs(m.arc.sweep);
      for (let k = 0; k <= 32; k++) {
        const a = a0 + (sweep * k) / 32;
        out.push({
          x: m.arc.cx + m.arc.radius * Math.cos(a),
          y: m.arc.cy + m.arc.radius * Math.sin(a),
        });
      }
    } else {
      for (let k = 0; k <= 16; k++) {
        out.push({
          x: m.from.x + ((m.to.x - m.from.x) * k) / 16,
          y: m.from.y + ((m.to.y - m.from.y) * k) / 16,
        });
      }
    }
  }
  return out;
}

/** Notch: split the top edge, pull the new middle corner 100 mm down. L: two splits, one move. */
function project(): Project {
  let p = goldenProject(shelfSet, TOOL_D);
  for (const id of ['notch', 'ell']) {
    p = run(p, 'drawPart', { id, name: id, shape: { kind: 'outline', vertices: RECT } });
  }
  // Notch
  let vs = outlineOf(p, 'notch');
  p = run(p, 'splitSegment', {
    id: 'notch',
    index: segIndex(vs, { x: 600, y: 400 }, { x: 0, y: 400 }),
  });
  vs = outlineOf(p, 'notch');
  expect(vs).toHaveLength(5);
  expect(area(vs)).toBeCloseTo(240000, 6);
  p = run(p, 'moveVertex', { id: 'notch', index: indexOf(vs, 300, 400), x: 300, y: 300 });
  expect(area(outlineOf(p, 'notch'))).toBeCloseTo(240000 - 30000, 6);
  // L
  vs = outlineOf(p, 'ell');
  p = run(p, 'splitSegment', {
    id: 'ell',
    index: segIndex(vs, { x: 600, y: 0 }, { x: 600, y: 400 }),
  });
  vs = outlineOf(p, 'ell');
  p = run(p, 'splitSegment', {
    id: 'ell',
    index: segIndex(vs, { x: 600, y: 400 }, { x: 0, y: 400 }),
  });
  vs = outlineOf(p, 'ell');
  expect(vs).toHaveLength(6);
  p = run(p, 'moveVertex', { id: 'ell', index: indexOf(vs, 600, 400), x: 300, y: 200 });
  expect(area(outlineOf(p, 'ell'))).toBeCloseTo(240000 - 60000, 6);
  return { ...p, layout: nestProject(p, { toolDiameter: TOOL_D }).layout };
}

describe('B50 tester: split corner → notch / L through nesting, post and the reader', () => {
  it.each(['generic', 'mach3'] as const)('%s: valid NC, no gouge into the edited parts', (post) => {
    const p = project();
    const placed = p.layout.sheets.flatMap((s) => s.placements.map((pl) => pl.partId));
    expect(placed).toContain('notch');
    expect(placed).toContain('ell');
    const r = exportNc(
      p,
      { profile: goldenProfile(post), version: 1, verification: 'draft' },
      postConfig(post),
    );
    expect(r.ok).toBe(true);
    expect(r.check?.violations).toEqual([]);
    for (const [si, sheet] of p.layout.sheets.entries()) {
      const mine = sheet.placements.filter((pl) => pl.partId === 'notch' || pl.partId === 'ell');
      if (mine.length === 0) continue;
      const pts = cutPoints(r.files[si]?.content ?? '');
      for (const pl of mine) {
        const part = p.parts.find((x) => x.id === pl.partId) as Part;
        const poly = polyPoints(placedOutline(part, pl));
        const xs = poly.map((q) => q.x);
        const ys = poly.map((q) => q.y);
        const pad = R + 1;
        const near = pts.filter(
          (q) =>
            q.x >= Math.min(...xs) - pad &&
            q.x <= Math.max(...xs) + pad &&
            q.y >= Math.min(...ys) - pad &&
            q.y <= Math.max(...ys) + pad,
        );
        expect(near.length, `${pl.partId}: cut near the part`).toBeGreaterThan(0);
        expect(
          near.filter((q) => inside(q, poly)),
          `${pl.partId}: inside`,
        ).toEqual([]);
        let minD = Infinity;
        for (const q of near) minD = Math.min(minD, distTo(q, poly));
        expect(minD).toBeGreaterThan(R - 0.01);
      }
    }
  });

  it('a split on a degenerate (zero-length) segment is refused, project unchanged', () => {
    let p = goldenProject(shelfSet, TOOL_D);
    p = run(p, 'drawPart', { id: 'n', name: 'n', shape: { kind: 'outline', vertices: RECT } });
    const r = applyCommand(p, 'splitSegment', { id: 'n', index: -1 });
    expect(r.ok).toBe(false);
    const r2 = applyCommand(p, 'splitSegment', { id: 'n', index: 1.5 });
    expect(r2.ok).toBe(false);
  });
});
