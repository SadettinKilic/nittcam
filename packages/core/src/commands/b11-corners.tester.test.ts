/**
 * B11 tester (T131, T132, T130): what the dev tests leave out. An L-shaped part opened with a
 * dogbone, a T-bone on either edge, and one with its inner corner auto-filleted to the tool radius
 * all go through nesting → toolpath → post → reader. The read tool-centre path (G-code, not the
 * offset) must never come closer than the tool radius to any placed outline (no gouge outside the
 * edited outline, spec §7.2), and on the overcut parts it must reach the original corner point.
 * Plus hand-checked outline edits on 3 shapes (segment length / angle, vertex move).
 */
import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { fixTightCorners } from '../editor/corners';
import { withSegmentAngle, withSegmentLength, withVertexAt } from '../editor/edit';
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
const L: Vertex[] = [v(0, 0), v(500, 0), v(500, 200), v(250, 200), v(250, 400), v(0, 400)];
const TOOL_D = 8;
const R = TOOL_D / 2;

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polyPoints(pl: Polyline): Point[] {
  const pts: Point[] = [];
  forEachSegment(pl, (a, b, bulge) => {
    const s = sampleSegment(a, b, bulge, 256);
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
    best = Math.min(best, toSegment(p, poly[i] as Point, poly[(i + 1) % poly.length] as Point));
  }
  return best;
}

/** Tool-centre points of every feed / arc move below the sheet top, read from the program. */
function cutPoints(content: string): Point[] {
  const read = readGcode(content);
  expect(read.errors).toEqual([]);
  const out: Point[] = [];
  for (const m of read.moves) {
    if (m.type === 'rapid' || Math.min(m.from.z, m.to.z) >= 0) continue;
    if (m.arc) {
      const a0 = Math.atan2(m.from.y - m.arc.cy, m.from.x - m.arc.cx);
      const sweep = m.arc.direction === 'ccw' ? Math.abs(m.arc.sweep) : -Math.abs(m.arc.sweep);
      for (let k = 0; k <= 64; k++) {
        const a = a0 + (sweep * k) / 64;
        out.push({
          x: m.arc.cx + m.arc.radius * Math.cos(a),
          y: m.arc.cy + m.arc.radius * Math.sin(a),
        });
      }
    } else {
      for (let k = 0; k <= 32; k++) {
        out.push({
          x: m.from.x + ((m.to.x - m.from.x) * k) / 32,
          y: m.from.y + ((m.to.y - m.from.y) * k) / 32,
        });
      }
    }
  }
  return out;
}

const STYLES = ['dogbone', 'tbone-prev', 'tbone-next'] as const;

function project(): Project {
  let p = goldenProject(shelfSet, TOOL_D);
  for (const style of STYLES) {
    p = run(p, 'drawPart', { id: style, name: style, shape: { kind: 'outline', vertices: L } });
    p = run(p, 'addDogbone', { id: style, corner: 3, r: R, style });
  }
  p = run(p, 'drawPart', { id: 'fixed', name: 'fixed', shape: { kind: 'outline', vertices: L } });
  const fix = fixTightCorners(deriveOutline(p.parts.find((x) => x.id === 'fixed') as Part), R);
  if (!fix?.ok) throw new Error('auto-fix');
  expect(fix.radii).toEqual([R]);
  p = run(p, 'filletCorners', { id: 'fixed', corners: [3], r: R });
  return { ...p, layout: nestProject(p, { toolDiameter: TOOL_D }).layout };
}

describe('B11 tester: overcuts through the whole pipeline (read G-code)', () => {
  it.each(['generic', 'mach3'] as const)(
    '%s: no gouge into any edited part; the overcut parts reach the corner point',
    (post) => {
      const p = project();
      const r = exportNc(
        p,
        { profile: goldenProfile(post), version: 1, verification: 'draft' },
        postConfig(post),
      );
      expect(r.ok).toBe(true);
      expect(r.check?.violations).toEqual([]);
      const ids = [...STYLES, 'fixed'];
      const seen = new Set<string>();
      for (const [si, sheet] of p.layout.sheets.entries()) {
        const mine = sheet.placements.filter((pl) => ids.includes(pl.partId));
        if (mine.length === 0) continue;
        const file = r.files[si];
        expect(file).toBeDefined();
        const pts = cutPoints(file?.content ?? '');
        for (const pl of mine) {
          seen.add(pl.partId);
          const part = p.parts.find((x) => x.id === pl.partId) as Part;
          const outline = placedOutline(part, pl);
          const poly = polyPoints(outline);
          let minD = Infinity;
          for (const q of pts) {
            expect(inside(q, poly), `${pl.partId}: tool centre inside the part`).toBe(false);
            minD = Math.min(minD, distTo(q, poly));
          }
          // The tool edge never enters the part (sampling tolerance 0.01 mm).
          expect(minD).toBeGreaterThan(R - 0.01);
          // Corner point of the original L (250, 200) in the sheet frame: placedOutline only
          // translates/rotates, so map it through the same rigid motion via the unedited L.
          const plain = placedOutline(
            { ...part, kind: 'freeform', outline: L } as unknown as Part,
            pl,
          );
          // Index 3 of L after normalisation: find the placed point closest to the original corner
          // by matching the reflex vertex (the only concave one).
          const corner = reflexVertex(plain);
          const reach = Math.min(...pts.map((q) => Math.hypot(q.x - corner.x, q.y - corner.y)));
          if (pl.partId === 'fixed')
            expect(reach - R).toBeGreaterThan(1); // fillet: corner stays
          else expect(Math.abs(reach - R)).toBeLessThan(0.05);
        }
      }
      expect([...seen].sort()).toEqual([...ids].sort());
    },
  );
});

function reflexVertex(pl: Polyline): Point {
  const vs = pl.vertices;
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const a = vs[(i - 1 + n) % n] as Vertex;
    const b = vs[i] as Vertex;
    const c = vs[(i + 1) % n] as Vertex;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross < -1e-6) return b;
  }
  throw new Error('no reflex vertex');
}

describe('B11 tester: outline edits by hand on 3 shapes (§4.4 rule)', () => {
  const ok = (r: ReturnType<typeof withSegmentLength>) => {
    if (!r.ok) throw new Error(r.error);
    return r.vertices.map(({ x, y }) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
  };

  it('rectangle 560×720: bottom edge → 700 moves only the bottom-right corner', () => {
    const rect = [v(0, 0), v(560, 0), v(560, 720), v(0, 720)];
    expect(ok(withSegmentLength(rect, 0, 700))).toEqual([
      [0, 0],
      [700, 0],
      [560, 720],
      [0, 720],
    ]);
    // angle of the bottom edge 10°: end at 560·(cos10, sin10)
    expect(ok(withSegmentAngle(rect, 0, 10))).toEqual([
      [0, 0],
      [
        Math.round(560 * Math.cos(Math.PI / 18) * 1e6) / 1e6,
        Math.round(560 * Math.sin(Math.PI / 18) * 1e6) / 1e6,
      ],
      [560, 720],
      [0, 720],
    ]);
  });

  it('L shape: the closing edge (5 → 0) shortened slides vertex 0 up the left side', () => {
    expect(ok(withSegmentLength(L, 5, 300))).toEqual([
      [0, 100],
      [500, 0],
      [500, 200],
      [250, 200],
      [250, 400],
      [0, 400],
    ]);
    // a vertex move: the reflex corner to (300, 250)
    expect(ok(withVertexAt(L, 3, { x: 300, y: 250 }))[3]).toEqual([300, 250]);
  });

  it('triangle at 45°: hypotenuse √2·100 → √2·150 moves the apex, then refuses a flip', () => {
    const tri = [v(0, 0), v(100, 0), v(0, 100)];
    // segment 1: (100,0) → (0,100), length √2·100; new end = (100,0) + 1.5·(−100, 100)
    expect(ok(withSegmentLength(tri, 1, Math.SQRT2 * 150))).toEqual([
      [0, 0],
      [100, 0],
      [-50, 150],
    ]);
    // segment 0 turned to 180°: end at (−100, 0) → outline turns inside out / degenerate
    const flip = withSegmentAngle(tri, 0, 180);
    expect(flip.ok).toBe(false);
    expect(withSegmentLength(tri, 0, 0).ok).toBe(false);
    expect(withSegmentLength(tri, 0, Number.NaN).ok).toBe(false);
  });
});
