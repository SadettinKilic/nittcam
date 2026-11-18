/**
 * B10 tester (T127–T129): what the dev tests leave out. Typed radius → stored arc radius for any
 * chord (property), drawn outlines always stored CCW at the local origin (property), and the
 * G2/G3 arcs that the reader reads back from a program have the typed radius plus/minus the tool
 * radius (generic + mach3), with the gcode-check passing.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { bulgeFromRadius, circleOutline, nextVertex, placeOutline } from '../editor/draw';
import { contour, orientation, bbox } from '../geometry/polyline';
import { arcOf } from '../geometry/segment';
import type { Point, Vertex } from '../geometry/types';
import { nestProject } from '../nesting';
import { exportNc } from '../export';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { deriveOutline, type Part, type Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const ctx: CommandContext = { actor: 'user', at: '2026-11-18T10:00:00Z' };

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

const coord = fc.double({ min: -3000, max: 3000, noNaN: true });
const pt = fc.record({ x: coord, y: coord });

describe('B10 tester: typed sizes are stored exactly', () => {
  it('property: a typed radius ≥ chord/2 gives an arc of exactly that radius', () => {
    fc.assert(
      fc.property(
        pt,
        pt,
        fc.double({ min: 1, max: 5, noNaN: true }),
        fc.boolean(),
        (p0, p1, k, right) => {
          const c = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          fc.pre(c > 1);
          const r = (c / 2) * k;
          const b = bulgeFromRadius(p0, p1, r, right);
          expect(b).toBeDefined();
          const arc = arcOf(p0, p1, b ?? 0);
          expect(arc?.radius).toBeDefined();
          expect(Math.abs((arc?.radius ?? 0) - r) / r).toBeLessThan(1e-9);
          // bulge sign = side: right of travel = CCW
          expect(Math.sign(b ?? 0)).toBe(right ? 1 : -1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('property: typed polyline lengths land exactly (1e-6 mm) at any angle', () => {
    fc.assert(
      fc.property(
        pt,
        fc.integer({ min: 1, max: 30000 }).map((n) => n / 10),
        fc.integer({ min: 0, max: 3599 }).map((n) => n / 10),
        (from, length, angle) => {
          const p = nextVertex(from, { x: from.x + 1, y: from.y }, { length, angle });
          expect(Math.abs(Math.hypot(p.x - from.x, p.y - from.y) - length)).toBeLessThan(2e-6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('property: a drawn closed outline (either winding) is stored CCW with its box at 0,0', () => {
    fc.assert(
      fc.property(
        pt,
        fc.integer({ min: 10, max: 2000 }),
        fc.integer({ min: 10, max: 2000 }),
        fc.integer({ min: 1, max: 9 }),
        fc.boolean(),
        (o, w, h, notch, cw) => {
          // L-shape: notch tenths of the size cut from the top-right
          const nx = (w * notch) / 10;
          const ny = (h * notch) / 10;
          let pts: Point[] = [
            { x: o.x, y: o.y },
            { x: o.x + w, y: o.y },
            { x: o.x + w, y: o.y + h - ny },
            { x: o.x + w - nx, y: o.y + h - ny },
            { x: o.x + w - nx, y: o.y + h },
            { x: o.x, y: o.y + h },
          ];
          if (cw) pts = pts.reverse();
          const { at, outline } = placeOutline(pts.map((p) => ({ ...p, bulge: 0 })));
          expect(orientation(contour(outline))).toBe('ccw');
          const b = bbox(contour(outline));
          expect(b.minX).toBeCloseTo(0, 6);
          expect(b.minY).toBeCloseTo(0, 6);
          expect(b.maxX).toBeCloseTo(w, 5);
          expect(b.maxY).toBeCloseTo(h, 5);
          expect(at.x).toBeCloseTo(o.x, 5);
          expect(at.y).toBeCloseTo(o.y, 5);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('drawPart → redo after undo gives the same project; rect params exact', () => {
    const p0 = goldenProject(shelfSet, 8);
    const stack = new CommandStack(p0);
    const params = {
      id: 'drawn-rect',
      name: 'Parça 9',
      at: { x: 123.4, y: 56.7 },
      shape: { kind: 'rect', params: { w: 596, h: 716, r: 0 } },
    };
    expect(stack.execute('drawPart', params, ctx).ok).toBe(true);
    const after = JSON.stringify(stack.project);
    const part = stack.project.parts.find((p) => p.id === 'drawn-rect') as Part;
    expect(part.kind).toBe('rect');
    if (part.kind === 'rect') expect(part.params).toEqual({ w: 596, h: 716, r: 0 });
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
    stack.redo();
    expect(JSON.stringify(stack.project)).toBe(after);
  });
});

describe('B10 tester: drawn arcs read back from the program with the typed radius', () => {
  /** A typed-R arc closed by a line (chord 600, R 400) and a circle of R 150, plus the shelf set. */
  function project(): Project {
    let p = goldenProject(shelfSet, 8);
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 600, y: 0 };
    const b = bulgeFromRadius(p1, p0, 400, true);
    if (b === undefined) throw new Error('no arc');
    // travel 600,0 → 0,0 bent to the right (below): an outward bulge of a CCW part
    const vs: Vertex[] = [
      { x: 0, y: 0, bulge: 0 },
      { x: 600, y: 0, bulge: b },
    ];
    p = run(p, 'drawPart', {
      id: 'segment',
      name: 'Parça S',
      shape: { kind: 'outline', vertices: vs },
    });
    p = run(p, 'drawPart', {
      id: 'disc',
      name: 'Parça D',
      shape: { kind: 'outline', vertices: circleOutline(150) },
    });
    return { ...p, layout: nestProject(p, { toolDiameter: 8 }).layout };
  }

  it('stored outline keeps R 400 and the circle R 150', () => {
    const p = project();
    const radii = (id: string) => {
      const part = p.parts.find((x) => x.id === id) as Part;
      const vs = deriveOutline(part);
      return vs
        .map((v, i) => arcOf(v, vs[(i + 1) % vs.length] as Vertex, v.bulge)?.radius)
        .filter((r): r is number => r !== undefined);
    };
    expect(radii('segment').map((r) => Math.round(r * 1e6) / 1e6)).toEqual([400]);
    expect(radii('disc').map((r) => Math.round(r * 1e6) / 1e6)).toEqual([150, 150]);
  });

  it.each(['generic', 'mach3'] as const)(
    '%s: G2/G3 arcs read back at R ± tool radius, both parts placed, check passes',
    (post) => {
      const p = project();
      const placed = new Set(p.layout.sheets.flatMap((s) => s.placements.map((x) => x.partId)));
      expect(placed.has('segment')).toBe(true);
      expect(placed.has('disc')).toBe(true);
      const r = exportNc(
        p,
        { profile: goldenProfile(post), version: 1, verification: 'draft' },
        postConfig(post),
      );
      expect(r.ok).toBe(true);
      expect(r.check?.violations).toEqual([]);
      const radii = new Set<number>();
      for (const f of r.files) {
        const read = readGcode(f.content);
        expect(read.errors).toEqual([]);
        for (const m of read.moves) {
          if (m.arc) radii.add(Math.round(m.arc.radius * 1000) / 1000);
        }
      }
      // outside contour with an 8 mm tool: path radius = part radius + 4
      expect(radii.has(404)).toBe(true);
      expect(radii.has(154)).toBe(true);
    },
  );
});
