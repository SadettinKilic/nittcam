/**
 * Test helpers for the toolpath (T014): project/profile builders and an invariant checker written
 * independently of the builder (own outline construction, the offset test oracle's distance
 * function). Not exported from the package.
 */
import { EPS } from '../geometry/constants';
import { distanceTo } from '../geometry/offset.testing';
import { bbox, forEachSegment, orientation } from '../geometry/polyline';
import { arcOf, sampleSegment } from '../geometry/segment';
import type { Point, Polyline, Vertex } from '../geometry/types';
import { defaultMachineProfile, type MachineProfile } from '../machine';
import { parseProject, type Project } from '../schema';
import { rectOutline } from '../schema/outline';
import type { Move, Operation, ToolpathResult } from './types';

export interface RectSpec {
  id: string;
  w: number;
  h: number;
  r?: number;
  qty?: number;
}

export interface ProjectSpec {
  parts: RectSpec[];
  sheet?: { width: number; height: number };
  thickness?: number;
  gap?: number;
  margin?: number;
  placements?: { partId: string; index: number; x: number; y: number; rot: number }[][];
  leadIn?: 'arc' | 'line';
  direction?: 'climb' | 'conventional';
  /** Thin skin thickness, mm (absent = tabs). D-129: with skin the stored gap and margin count. */
  skin?: number;
}

export function projectOf(spec: ProjectSpec): Project {
  const r = parseProject({
    schemaVersion: 2,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: spec.thickness ?? 18,
      sheet: { ...(spec.sheet ?? { width: 2440, height: 1220 }), grain: 0 },
      useOffcuts: false,
    },
    parts: spec.parts.map((p) => ({
      id: p.id,
      name: p.id,
      qty: p.qty ?? 1,
      grain: { mode: 'free', angle: 0 },
      kind: 'rect',
      params: { w: p.w, h: p.h, r: p.r ?? 0 },
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    })),
    nesting: { mode: 'minWaste', gap: spec.gap ?? 4, margin: spec.margin ?? 10 },
    layout: {
      sheets: (spec.placements ?? []).map((pls) => ({
        placements: pls.map((p) => ({ ...p, locked: false })),
      })),
    },
    cutting: {
      tabs: { auto: false },
      leadIn: spec.leadIn ?? 'arc',
      direction: spec.direction ?? 'climb',
      ...(spec.skin === undefined ? {} : { skin: { thickness: spec.skin } }),
    },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

export interface MachineSpec {
  toolDiameter?: number;
  fluteLength?: number;
  spoilboard?: number;
  passDepth?: number;
  thickness?: number;
  safeZ?: number;
  feed?: number;
  plungeFeed?: number;
}

/** The example profile with one tool T1 and one MDF parameter set. */
export function machineOf(spec: MachineSpec = {}): MachineProfile {
  const m = defaultMachineProfile();
  return {
    ...m,
    safeZ: spec.safeZ ?? 20,
    zZero: { ...m.zZero, spoilboardAllowance: spec.spoilboard ?? 0.3 },
    tools: [
      {
        number: 1,
        type: 'flatEndMill',
        diameter: spec.toolDiameter ?? 6,
        fluteLength: spec.fluteLength ?? 50,
        flutes: 2,
      },
    ],
    materials: [
      {
        material: 'mdf',
        thickness: spec.thickness ?? 18,
        feed: spec.feed ?? 6000,
        plungeFeed: spec.plungeFeed ?? 1500,
        rpm: 18000,
        stepDown: spec.passDepth ?? 6.1,
        tool: 1,
      },
    ],
  };
}

/**
 * The part outline in the sheet frame, built independently of the builder: a rect outline is
 * symmetric under quarter turns, so the rotated part is the outline of the swapped size moved
 * to (x, y).
 */
export function sheetOutline(
  project: Project,
  op: Pick<Operation, 'partId' | 'copy' | 'sheet'>,
): Polyline {
  const part = project.parts.find((p) => p.id === op.partId);
  const pl = project.layout.sheets[op.sheet]?.placements.find(
    (p) => p.partId === op.partId && p.index === op.copy,
  );
  if (!part || part.kind !== 'rect' || !pl) throw new Error(`no rect placement for ${op.partId}`);
  const { w, h, r } = part.params;
  if (pl.rot % 90 !== 0) {
    // Any other angle (T113): rotate the rect outline with its own cos/sin (not the builder's
    // transform), then move its arc-aware bounding-box minimum to (x, y).
    const rad = (pl.rot * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const turnedOutline: Polyline = {
      closed: true,
      vertices: rectOutline({ w, h, r }).map((v) => ({
        x: v.x * c - v.y * s,
        y: v.x * s + v.y * c,
        bulge: v.bulge,
      })),
    };
    const box = bbox(turnedOutline);
    return {
      closed: true,
      vertices: turnedOutline.vertices.map((v) => ({
        x: v.x - box.minX + pl.x,
        y: v.y - box.minY + pl.y,
        bulge: v.bulge,
      })),
    };
  }
  const turned = pl.rot === 90 || pl.rot === 270;
  const vs = rectOutline({ w: turned ? h : w, h: turned ? w : h, r });
  return {
    closed: true,
    vertices: vs.map((v) => ({ x: v.x + pl.x, y: v.y + pl.y, bulge: v.bulge })),
  };
}

/**
 * Strictly inside an outline at any rotation: ray casting over the outline sampled into chords
 * (32 per arc). The sliver between a chord and its arc is thinner than the tool radius, which the
 * caller's distance test covers.
 */
function insideOutline(p: Point, outline: Polyline): boolean {
  const pts: Point[] = [];
  forEachSegment(outline, (a, b, bulge) => {
    pts.push(...sampleSegment(a, b, bulge, 32).slice(0, -1));
  });
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as Point;
    const b = pts[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside && distanceTo(p, outline) > EPS;
}

/** Strictly inside a (rounded) rectangle outline: closer than r to the rectangle shrunk by r. */
function insideRectOutline(p: Point, outline: Polyline): boolean {
  const axisAligned = outline.vertices.every((v, i) => {
    const n = outline.vertices[(i + 1) % outline.vertices.length] as Vertex;
    return v.bulge !== 0 || Math.abs(v.x - n.x) <= EPS || Math.abs(v.y - n.y) <= EPS;
  });
  if (!axisAligned) return insideOutline(p, outline);
  const xs = outline.vertices.map((v) => v.x);
  const ys = outline.vertices.map((v) => v.y);
  const n = outline.vertices.length;
  let r = 0;
  outline.vertices.forEach((v, i) => {
    const arc = arcOf(v, outline.vertices[(i + 1) % n] as Vertex, v.bulge);
    if (arc) r = arc.radius;
  });
  const x0 = Math.min(...xs) + r;
  const x1 = Math.max(...xs) - r;
  const y0 = Math.min(...ys) + r;
  const y1 = Math.max(...ys) - r;
  const dx = Math.max(x0 - p.x, 0, p.x - x1);
  const dy = Math.max(y0 - p.y, 0, p.y - y1);
  if (r === 0) return p.x > x0 + EPS && p.x < x1 - EPS && p.y > y0 + EPS && p.y < y1 - EPS;
  return Math.hypot(dx, dy) < r - EPS;
}

/** XY sample points of a move starting at `from` (9 on lines, 33 on arcs). */
export function sampleMove(from: Point, m: Move): Point[] {
  if (m.kind === 'arc' && arcOf(from, m, m.bulge)) return sampleSegment(from, m, m.bulge, 32);
  return Array.from({ length: 9 }, (_, i) => ({
    x: from.x + ((m.x - from.x) * i) / 8,
    y: from.y + ((m.y - from.y) * i) / 8,
  }));
}

/** The contour moves (flat, at the pass depth) of a pass as a closed polyline. */
export function passLoop(op: Operation, passIndex: number): Polyline {
  const seg = op.segments.find((s) => s.role === 'pass' && s.pass === passIndex);
  if (!seg) throw new Error('no pass');
  // Loop moves are flat at the pass depth (start and end); ramps/plunges are not.
  const flat: { from: Point; m: Move }[] = [];
  let prev: { x: number; y: number; z: number } | null = null;
  const depth = seg.depth ?? 0;
  const all = op.segments.flatMap((s) => s.moves.map((m) => ({ m, seg: s })));
  for (const { m, seg: s } of all) {
    const isFlat = prev !== null && Math.abs(prev.z - depth) <= EPS && Math.abs(m.z - depth) <= EPS;
    if (s === seg && prev && isFlat && (m.kind === 'linear' || m.kind === 'arc')) {
      flat.push({ from: prev, m });
    }
    prev = { x: m.x, y: m.y, z: m.z };
  }
  const vertices: Vertex[] = flat.map(({ from, m }) => ({
    x: from.x,
    y: from.y,
    bulge: m.kind === 'arc' ? m.bulge : 0,
  }));
  return { closed: true, vertices };
}

export interface CheckOptions {
  /** Expected pass count / depths. */
  passDepth: number;
  thickness: number;
  spoilboard: number;
  toolDiameter: number;
  safeZ: number;
  plungeFeed: number;
  direction: 'climb' | 'conventional';
}

/**
 * Every invariant of the toolpath as a list of violations (empty = fine). Written without the
 * builder's helpers.
 */
export function toolpathViolations(
  project: Project,
  res: ToolpathResult,
  c: CheckOptions,
): string[] {
  const out: string[] = [];
  const tr = c.toolDiameter / 2;
  const target = -(c.thickness + c.spoilboard);
  const total = c.thickness + c.spoilboard;
  const nExpected = Math.max(1, Math.ceil((total - EPS) / c.passDepth));
  const W = project.stock.sheet.width;
  const H = project.stock.sheet.height;

  for (const op of res.toolpath.operations) {
    const outline = sheetOutline(project, op);
    const neighbours = res.toolpath.operations
      .filter((o) => o.sheet === op.sheet && o.id !== op.id)
      .map((o) => sheetOutline(project, o));
    // pass depths
    if (op.passDepths.length !== nExpected)
      out.push(`${op.id}: ${op.passDepths.length} passes, want ${nExpected}`);
    op.passDepths.forEach((z, i) => {
      const want = (-total * (i + 1)) / nExpected;
      if (Math.abs(z - want) > 1e-9) out.push(`${op.id}: pass ${i} at ${z}, want ${want}`);
    });
    if (op.passDepths[op.passDepths.length - 1] !== target)
      out.push(`${op.id}: last pass not exactly the target`);
    const step = total / nExpected;
    if (step > c.passDepth + EPS) out.push(`${op.id}: pass step ${step} > ${c.passDepth}`);

    const xs = outline.vertices.map((v) => v.x);
    const ys = outline.vertices.map((v) => v.y);
    const bounds = {
      minX: Math.min(0, Math.min(...xs) - tr),
      minY: Math.min(0, Math.min(...ys) - tr),
      maxX: Math.max(W, Math.max(...xs) + tr),
      maxY: Math.max(H, Math.max(...ys) + tr),
    };

    let prev = { x: NaN, y: NaN, z: c.safeZ };
    op.segments.forEach((seg) => {
      seg.moves.forEach((m, mi) => {
        const where = `${op.id} ${seg.role}${seg.pass ?? ''}[${mi}]`;
        const first = Number.isNaN(prev.x);
        if (first) {
          if (m.kind !== 'rapid' || Math.abs(m.z - c.safeZ) > EPS)
            out.push(`${where}: first move not a rapid at safe Z`);
          prev = { x: m.x, y: m.y, z: c.safeZ };
        }
        if (m.z < target - EPS) out.push(`${where}: below target (${m.z})`);
        const xy = Math.hypot(m.x - prev.x, m.y - prev.y) > EPS;
        if (m.kind === 'rapid') {
          if (xy && (Math.abs(prev.z - c.safeZ) > EPS || Math.abs(m.z - c.safeZ) > EPS))
            out.push(`${where}: XY rapid not at safe Z`);
          if (m.z <= 0) out.push(`${where}: rapid into the material`);
        } else {
          if (m.kind === 'plunge' && m.feed !== c.plungeFeed)
            out.push(`${where}: plunge feed ${m.feed}`);
          if (m.z < prev.z - EPS && m.feed !== c.plungeFeed)
            out.push(`${where}: descends at ${m.feed}`);
          if ((m.kind === 'linear' || m.kind === 'arc') && m.z > EPS)
            out.push(`${where}: cutting move above Z 0`);
          const pts = sampleMove(prev, m);
          if (seg.role === 'pass') {
            for (const q of pts) {
              const d = distanceTo(q, outline);
              if (Math.abs(d - tr) > EPS)
                out.push(`${where}: point ${d} from the part, want ${tr}`);
            }
          } else if (seg.role === 'leadIn' || seg.role === 'leadOut' || seg.role === 'approach') {
            for (const q of pts) {
              if (insideRectOutline(q, outline) || distanceTo(q, outline) < tr - EPS)
                out.push(`${where}: lead touches the part`);
              for (const nb of neighbours) {
                if (insideRectOutline(q, nb) || distanceTo(q, nb) < tr - EPS)
                  out.push(`${where}: lead touches a neighbour`);
              }
              if (
                q.x < bounds.minX - EPS ||
                q.x > bounds.maxX + EPS ||
                q.y < bounds.minY - EPS ||
                q.y > bounds.maxY + EPS
              ) {
                out.push(`${where}: lead leaves the sheet`);
              }
            }
          }
        }
        prev = { x: m.x, y: m.y, z: m.z };
      });
    });
    if (Math.abs(prev.z - c.safeZ) > EPS) out.push(`${op.id}: does not end at safe Z`);
    // travel direction (climb = CW for an outer contour with a CW spindle)
    const want = c.direction === 'climb' ? 'cw' : 'ccw';
    const got = orientation(passLoop(op, op.passDepths.length - 1));
    if (got !== want) out.push(`${op.id}: travels ${got}, want ${want}`);
  }
  return out;
}

/** Deep copy of JSON data (core has no DOM/Node lib, so no structuredClone). */
export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
