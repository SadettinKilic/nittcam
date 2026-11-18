/**
 * Sheet grain texture (T116, D-034): parallel lines at the grain angle across a W × H sheet,
 * clipped to the sheet analytically (no canvas clip). Sheet frame, Y up, mm.
 * Returns [x1, y1, x2, y2] per line; empty for a null grain or an empty sheet.
 */
export function grainLines(
  width: number,
  height: number,
  angle: number | null,
  spacing: number,
): [number, number, number, number][] {
  if (angle === null || width <= 0 || height <= 0 || !(spacing > 0)) return [];
  const a = (angle * Math.PI) / 180;
  const d = { x: Math.cos(a), y: Math.sin(a) };
  const n = { x: -d.y, y: d.x };
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x = 0, y = 0]) => x * n.x + y * n.y);
  const lo = Math.min(...corners);
  const hi = Math.max(...corners);
  const reach = Math.hypot(width, height);
  const out: [number, number, number, number][] = [];
  // Lines are centred on the sheet so the texture does not jump when the sheet size changes.
  const mid = (lo + hi) / 2;
  const first = mid - Math.floor((mid - lo) / spacing) * spacing;
  for (let t = first; t < hi; t += spacing) {
    const seg = clip(
      t * n.x - reach * d.x,
      t * n.y - reach * d.y,
      d.x * 2 * reach,
      d.y * 2 * reach,
      width,
      height,
    );
    if (seg) out.push(seg);
    if (out.length > 2000) break;
  }
  return out;
}

/** Liang–Barsky: segment p + s·v, s ∈ [0, 1], clipped to [0, W] × [0, H]. */
function clip(
  px: number,
  py: number,
  vx: number,
  vy: number,
  w: number,
  h: number,
): [number, number, number, number] | null {
  let s0 = 0;
  let s1 = 1;
  const edges: [number, number][] = [
    [-vx, px],
    [vx, w - px],
    [-vy, py],
    [vy, h - py],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) s0 = Math.max(s0, r);
    else s1 = Math.min(s1, r);
    if (s0 > s1) return null;
  }
  if (s1 - s0 < 1e-9) return null;
  return [px + s0 * vx, py + s0 * vy, px + s1 * vx, py + s1 * vy];
}

/**
 * End points of a part's two-headed grain arrow inside its footprint (canvas frame, Y down,
 * relative to the footprint's top-left): centred, shifted below a label of `lines` lines,
 * half the footprint side it runs along (max 80 mm).
 */
export function grainArrowPoints(
  angle: number,
  w: number,
  h: number,
  font: number,
  lines: number,
): [number, number, number, number] {
  const rad = (angle * Math.PI) / 180;
  const dx = angle === 90 ? 0 : Math.cos(rad);
  const dy = angle === 0 ? 0 : Math.sin(rad);
  const len = Math.min(Math.abs(dx) >= Math.abs(dy) ? w : h, 160) * 0.5;
  const cx = w / 2;
  const cy = h / 2 + font * (lines * 0.65 + 0.3);
  return [cx - (dx * len) / 2, cy + (dy * len) / 2, cx + (dx * len) / 2, cy - (dy * len) / 2];
}
