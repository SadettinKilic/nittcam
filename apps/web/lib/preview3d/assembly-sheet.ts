/**
 * "Montaj föyü" drawing (T389): the visible part copies of the montaj tezgâhı, exploded, as an
 * isometric line drawing (painter's order, hidden faces culled) with a numbered balloon per copy
 * and a numbered part list. Pure and deterministic (same project → same drawing), so the server
 * PDF stays byte-stable.
 */
import type { CabinetPartRole, MaterialKind, Project } from '@nittcam/core';
import { boxSize, cross, dot, norm, qRotate, type V3 } from './assembly-math';
import { benchItems } from './assembly-model';
import { exploded, explodeOffsets } from './assembly-explode';
import { toWorld } from './fit-check';
import { localOutline, ringArea } from './part-mesh';
import { fastenerRows, fastenersOf, type FastenerRow } from './fasteners';

/** Explode amount on the sheet (0–1). */
export const SHEET_EXPLODE = 0.6;
/** Viewing direction (towards the viewer): front-right-top isometric. */
const VIEW: V3 = norm([1, 1, 1]);
const RIGHT: V3 = norm([VIEW[2], 0, -VIEW[0]]);
const UP: V3 = cross(VIEW, RIGHT);

export interface SheetFace {
  /** Screen polygon, mm (x right, y up). */
  pts: [number, number][];
  /** Part number (1-based, the list's). */
  no: number;
  depth: number;
  /** True for the part's large faces (top/bottom), drawn a shade lighter. */
  cap: boolean;
}

export interface SheetRow {
  no: number;
  name: string;
  /** Finished size w × h × t, mm. */
  size: [number, number, number];
  /** Visible copies. */
  qty: number;
  /** T390: the material it is shown in (its own in the assembly, else the stock's). */
  material: MaterialKind;
}

export interface AssemblySheet {
  faces: SheetFace[];
  balloons: { no: number; x: number; y: number }[];
  rows: SheetRow[];
  /** T390: bağlantı elemanları through aligned holes (assembled places, not exploded). */
  fasteners: FastenerRow[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const screen = (p: V3): [number, number] => [dot(p, RIGHT), dot(p, UP)];

/** The sheet of a project's assembly; null when no copy is visible. */
export function assemblySheet(
  project: Project,
  roles: Readonly<Record<CabinetPartRole, string>>,
): AssemblySheet | null {
  const items = benchItems(project, roles).filter((i) => !i.hidden);
  if (items.length === 0) return null;
  const off = explodeOffsets(items, SHEET_EXPLODE);
  const numbers = new Map<string, number>();
  const rows: SheetRow[] = [];
  for (const it of items) {
    let no = numbers.get(it.partId);
    if (no === undefined) {
      no = rows.length + 1;
      numbers.set(it.partId, no);
      const s = boxSize(it.box);
      rows.push({
        no,
        name: it.part.name || it.partId,
        size: [s[0], s[1], s[2]],
        qty: 0,
        material: it.look,
      });
    }
    const row = rows[no - 1];
    if (row) row.qty++;
  }

  const faces: SheetFace[] = [];
  const balloons: AssemblySheet['balloons'] = [];
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = ([x, y]: [number, number]) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const raw of items) {
    const it = exploded(raw, off);
    const no = numbers.get(it.partId) ?? 0;
    const ring = localOutline(it.part);
    const n = ring.length / 2;
    if (n < 3) continue;
    const ccw = ringArea(ring) > 0;
    const z0 = it.box.min[2];
    const z1 = it.box.max[2];
    const lo: V3[] = [];
    const hi: V3[] = [];
    for (let k = 0; k < n; k++) {
      const x = ring[2 * k] ?? 0;
      const y = ring[2 * k + 1] ?? 0;
      lo.push(toWorld(it.pose, it.box, [x, y, z0]));
      hi.push(toWorld(it.pose, it.box, [x, y, z1]));
    }
    const zAxis = qRotate(it.pose.rotation, [0, 0, 1]);
    const push = (pts: V3[], normal: V3, cap: boolean) => {
      if (dot(normal, VIEW) <= 1e-9) return; // facing away
      const depth = pts.reduce((s, p) => s + dot(p, VIEW), 0) / pts.length;
      const flat = pts.map(screen);
      flat.forEach(grow);
      faces.push({ pts: flat, no, depth, cap });
    };
    push(hi, zAxis, true);
    push([...lo].reverse(), [-zAxis[0], -zAxis[1], -zAxis[2]], true);
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const dx = (ring[2 * j] ?? 0) - (ring[2 * k] ?? 0);
      const dy = (ring[2 * j + 1] ?? 0) - (ring[2 * k + 1] ?? 0);
      // Outward normal of the edge in the local frame (ring winding decides the side).
      const local: V3 = ccw ? [dy, -dx, 0] : [-dy, dx, 0];
      const normal = qRotate(it.pose.rotation, local);
      const a = lo[k];
      const c = lo[j];
      const d = hi[j];
      const e = hi[k];
      if (a && c && d && e) push([a, c, d, e], normal, false);
    }
    const centre = screen(it.pose.position);
    balloons.push({ no, x: centre[0], y: centre[1] });
  }
  faces.sort((p, q) => p.depth - q.depth || p.no - q.no);
  return { faces, balloons, rows, fasteners: fastenerRows(fastenersOf(items)), bounds: b };
}
