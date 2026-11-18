/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * T117 (spec §11, D-034): a fixed-grain part nested at 30° goes through toolpath, post and the
 * independent reader; the read outer contour at full depth must follow the 30°-rotated outline at
 * tool radius. The expected outline is rotated here with its own cos/sin (not `placedOutline`).
 */
import { describe, expect, it } from 'vitest';
import { exportNc } from '../export/export';
import { golden, postConfig } from '../gcode-check/check.testing';
import { readGcode, sampleGcodeMove } from '../gcode-reader';
import { machineFrame, toMachineXY } from '../post';
import type { Project } from '../schema';

const TOOL_RADIUS = 4; // golden projects use an 8 mm tool
const TOL = 0.02;

type P = { x: number; y: number };

function segDist(p: P, a: P, b: P): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function polyDist(p: P, poly: readonly P[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++)
    d = Math.min(d, segDist(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return d;
}

/** w × h rectangle turned by `deg` CCW about its origin, then its bbox moved to (x, y). */
function turnedRect(w: number, h: number, deg: number, x: number, y: number): P[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  return pts.map((p) => ({ x: p.x - minX + x, y: p.y - minY + y }));
}

describe.each(['generic', 'mach3'] as const)('T117 %s: 30° part read back from G-code', (post) => {
  const g = golden(post, 'shelf-set');
  const part = g.project.parts[0]!;
  if (part.kind !== 'rect') throw new Error('shelf-set part 0 must be a rectangle');
  const size = part.params;
  const at = { x: 200, y: 150 };

  function run(rot: number) {
    const project: Project = {
      ...g.project,
      parts: [{ ...part, qty: 1, grain: { mode: 'fixed', angle: 0 } }],
      stock: { ...g.project.stock, sheet: { ...g.project.stock.sheet, grain: rot % 180 } },
      layout: {
        sheets: [{ placements: [{ partId: part.id, index: 0, ...at, rot, locked: false }] }],
      },
    };
    const pv = { profile: g.context.profile, version: 1, verification: 'draft' as const };
    const r = exportNc(project, pv, postConfig(post));
    expect(r.ok).toBe(true);
    expect(r.check?.violations).toEqual([]);
    const read = readGcode(r.files[0]!.content);
    expect(read.ok).toBe(true);
    const cuts = read.moves.filter((m) => m.type !== 'rapid');
    const zMin = Math.min(...cuts.map((m) => m.to.z));
    const deepest = cuts.filter(
      (m) => Math.abs(m.from.z - zMin) < 1e-6 && Math.abs(m.to.z - zMin) < 1e-6,
    );
    const points = deepest.flatMap((m) => [m.from, ...sampleGcodeMove(m, 0.005)]);
    const frame = machineFrame(g.context.profile, {
      thickness: project.stock.thickness,
      sheetWidth: project.stock.sheet.width,
      sheetHeight: project.stock.sheet.height,
    });
    const outline = turnedRect(size.w, size.h, rot, at.x, at.y).map((p) =>
      toMachineXY(frame, p.x, p.y),
    );
    return { points, outline };
  }

  it('every full-depth cut point keeps the tool radius; the contour hugs the turned outline', () => {
    const { points, outline } = run(30);
    expect(points.length).toBeGreaterThan(8);
    const d = points.map((p) => polyDist(p, outline));
    // Never inside the part (safety), and the contour (all but the lead) runs at tool radius.
    for (const v of d) expect(v).toBeGreaterThanOrEqual(TOOL_RADIUS - TOL);
    const onContour = d.filter((v) => Math.abs(v - TOOL_RADIUS) <= TOL).length;
    expect(onContour / d.length).toBeGreaterThan(0.8);
    // The cut goes all the way round: each turned corner has a cut point at tool radius.
    for (const c of outline) {
      const near = Math.min(...points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
      expect(near).toBeLessThanOrEqual(TOOL_RADIUS + TOL);
    }
  });

  it('the same G-code does not match the outline turned the other way (−30°)', () => {
    const { points } = run(30);
    const { outline: wrong } = run(330);
    const off = points.filter((p) => Math.abs(polyDist(p, wrong) - TOOL_RADIUS) > 1).length;
    expect(off / points.length).toBeGreaterThan(0.3);
  });
});
