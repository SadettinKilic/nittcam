/**
 * Where a part label goes (B44, CTO #8 / #9): a letter "O" or a frame with an opening had its
 * label centred over the opening, an "L" over the empty corner where another part may sit. The
 * spot is a point inside the material, as far from every edge (outline, cut-outs, holes) as the
 * sampling finds, with the room around it the label may use. Plain rectangles keep the centre.
 * Footprint frame: origin top left, Y down (as `DrawnPart`).
 */

export interface LabelShape {
  w: number;
  h: number;
  /** Closed outline as flat [x, y, ...], or null for the footprint rectangle. */
  outline: readonly number[] | null;
  inners: readonly (readonly number[])[];
  holes: readonly { x: number; y: number; r: number }[];
}

/** Centre of the label and the box (w × h) it may fill. */
export interface LabelSpot {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const GRID = 24;

function inRing(px: number, py: number, ring: readonly number[]): boolean {
  let inside = false;
  const n = ring.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i] ?? 0;
    const yi = ring[2 * i + 1] ?? 0;
    const xj = ring[2 * j] ?? 0;
    const yj = ring[2 * j + 1] ?? 0;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringDistance(px: number, py: number, ring: readonly number[]): number {
  let best = Infinity;
  const n = ring.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[2 * j] ?? 0;
    const ay = ring[2 * j + 1] ?? 0;
    const bx = ring[2 * i] ?? 0;
    const by = ring[2 * i + 1] ?? 0;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/** Distance from (px, py) to the nearest edge when the point is in the material, else -1. */
export function clearance(shape: LabelShape, px: number, py: number): number {
  const { w, h, outline, inners, holes } = shape;
  let d: number;
  if (outline) {
    if (!inRing(px, py, outline)) return -1;
    d = ringDistance(px, py, outline);
  } else {
    if (px <= 0 || py <= 0 || px >= w || py >= h) return -1;
    d = Math.min(px, py, w - px, h - py);
  }
  for (const ring of inners) {
    if (inRing(px, py, ring)) return -1;
    d = Math.min(d, ringDistance(px, py, ring));
  }
  for (const c of holes) {
    const e = Math.hypot(px - c.x, py - c.y) - c.r;
    if (e <= 0) return -1;
    d = Math.min(d, e);
  }
  return d;
}

/**
 * The label spot. The centre stays when it is clearly in the material (clearance ≥ 35 % of the
 * short side, so a door with hinge cups at its edge keeps its centred label); otherwise the
 * sampled point with the largest clearance d wins, with a 1.6d × d box (inside the d circle).
 */
export function labelSpot(shape: LabelShape): LabelSpot {
  const { w, h, outline, inners, holes } = shape;
  const whole: LabelSpot = { cx: w / 2, cy: h / 2, w, h };
  if (!outline && inners.length === 0 && holes.length === 0) return whole;
  if (clearance(shape, w / 2, h / 2) >= 0.35 * Math.min(w, h)) return whole;
  let best = { x: w / 2, y: h / 2, d: -1 };
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++) {
      const x = ((i + 0.5) / GRID) * w;
      const y = ((j + 0.5) / GRID) * h;
      const d = clearance(shape, x, y);
      // Ties go to the point nearer the centre, so symmetric shapes stay balanced.
      const nearer = Math.hypot(x - w / 2, y - h / 2) < Math.hypot(best.x - w / 2, best.y - h / 2);
      if (d > best.d + 1e-9 || (Math.abs(d - best.d) <= 1e-9 && nearer)) best = { x, y, d };
    }
  if (best.d <= 0) return whole;
  return { cx: best.x, cy: best.y, w: 1.6 * best.d, h: best.d };
}
