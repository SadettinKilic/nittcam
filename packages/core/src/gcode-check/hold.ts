/**
 * T338 (CTO #13 M1, D-129): rule PART_NOT_HELD, read from the program text. Independent of the
 * generator's tab code (`toolpath/tab-hold.ts`): it rebuilds the material from the read moves.
 *
 * A tab is a run along a part's outline where the material behind it stays: for every point of
 * the run the "spoke" from just outside the outline outward through the kerf (tool Ø) and 3 mm
 * beyond lies on the sheet, and no read move that reaches the material bottom (z below
 * −thickness + 0.5) passes within its cutter radius. The own contour rises over a tab, so its
 * deep moves block everything but the tabs; a neighbour's pass, a lead or a ramp through the web
 * blocks the tab as well. Runs of at least 2.9 mm count as holding tabs.
 *
 * Needed per through-cut outline: a small part without thin skin at least 2, every other part at
 * least the tab count of the model operation (none = nothing to check). A part whose kerf tool is
 * unknown (no model operation) cannot be decided: error. Every file of the sheet counts.
 */
import type { Derived } from './derive';
import type { SheetMove } from './path';
import type { Push } from './rules';
import type { ExpectedPart } from './types';

/** Material beyond the kerf a tab needs, mm (D-129; the checker's own copy of the 3 mm). */
const WEB = 3;
/** Shortest run that counts as a tab, mm (tabs are at least 3 mm wide, sampling slack). */
const MIN_RUN = 2.9;
/** Sample step along the outline, mm. */
const STEP = 0.25;
/** Depth above the material bottom a move must reach to cut a tab's web through, mm. */
const DEEP = 0.5;
const CELL = 25;

/** A deep read move in the sheet frame (arcs as chords), with its cutter radius. */
export interface DeepCut {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

/**
 * The read moves of one file that reach within 0.5 mm of the material bottom. `tools`: the active
 * tool of every move (`activeTools`); an unknown tool takes the largest radius of the job.
 */
export function deepCuts(
  sm: readonly SheetMove[],
  tools: readonly (number | null)[],
  d: Derived,
): DeepCut[] {
  const ops = d.ctx.toolpath.operations;
  const largest = Math.max(0, ...ops.map((o) => o.toolDiameter / 2));
  const radius = (t: number | null | undefined) => {
    const op = t === null || t === undefined ? undefined : ops.find((o) => o.tool === t);
    return op ? op.toolDiameter / 2 : largest;
  };
  const limit = -d.ctx.stock.thickness + DEEP;
  const out: DeepCut[] = [];
  sm.forEach((m, i) => {
    if (Math.min(m.from.z, m.to.z) >= limit) return;
    const r = radius(tools[i]);
    if (m.kind === 'arc' && m.arc) {
      const a = m.arc;
      const n = Math.max(1, Math.ceil(a.sweep / 0.05));
      const a0 = Math.atan2(m.from.y - a.cy, m.from.x - a.cx);
      const sign = a.dir === 'ccw' ? 1 : -1;
      // chord sagitta ≤ r·(1 − cos 0.025) < 3.2e-4 · r: added to the cutter radius
      const slack = a.r * (1 - Math.cos(0.025));
      let px = m.from.x;
      let py = m.from.y;
      for (let k = 1; k <= n; k++) {
        const ang = a0 + (sign * a.sweep * k) / n;
        const qx = k === n ? m.to.x : a.cx + a.r * Math.cos(ang);
        const qy = k === n ? m.to.y : a.cy + a.r * Math.sin(ang);
        out.push({ ax: px, ay: py, bx: qx, by: qy, r: r + slack });
        px = qx;
        py = qy;
      }
    } else {
      out.push({ ax: m.from.x, ay: m.from.y, bx: m.to.x, by: m.to.y, r });
    }
  });
  return out;
}

function grid(cuts: readonly DeepCut[]): Map<string, DeepCut[]> {
  const cells = new Map<string, DeepCut[]>();
  for (const c of cuts) {
    const i0 = Math.floor((Math.min(c.ax, c.bx) - c.r) / CELL);
    const i1 = Math.floor((Math.max(c.ax, c.bx) + c.r) / CELL);
    const j0 = Math.floor((Math.min(c.ay, c.by) - c.r) / CELL);
    const j1 = Math.floor((Math.max(c.ay, c.by) + c.r) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = `${i},${j}`;
        const list = cells.get(k);
        if (list) list.push(c);
        else cells.set(k, [c]);
      }
  }
  return cells;
}

function pointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance between two segments (0 when they cross). */
function segSeg(a: DeepCut, b: { ax: number; ay: number; bx: number; by: number }): number {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(a.ax, a.ay, a.bx, a.by, b.ax, b.ay);
  const d2 = o(a.ax, a.ay, a.bx, a.by, b.bx, b.by);
  const d3 = o(b.ax, b.ay, b.bx, b.by, a.ax, a.ay);
  const d4 = o(b.ax, b.ay, b.bx, b.by, a.bx, a.by);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    pointSeg(a.ax, a.ay, b.ax, b.ay, b.bx, b.by),
    pointSeg(a.bx, a.by, b.ax, b.ay, b.bx, b.by),
    pointSeg(b.ax, b.ay, a.ax, a.ay, a.bx, a.by),
    pointSeg(b.bx, b.by, a.ax, a.ay, a.bx, a.by),
  );
}

/** Lengths of the holding runs along a closed polygon (wrap-around joined). */
export function holdingRuns(
  outline: readonly { x: number; y: number }[],
  kerf: number,
  cuts: readonly DeepCut[],
  sheet: { width: number; height: number },
): number[] {
  const n = outline.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = outline[i] as { x: number; y: number };
    const b = outline[(i + 1) % n] as { x: number; y: number };
    area += a.x * b.y - b.x * a.y;
  }
  const ccw = area > 0;
  const cells = grid(cuts);
  const reach = kerf + WEB - 0.05;
  const held: boolean[] = [];
  const len: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = outline[i] as { x: number; y: number };
    const b = outline[(i + 1) % n] as { x: number; y: number };
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-9) continue;
    // outward normal: right of travel on a CCW polygon
    const nx = (ccw ? b.y - a.y : a.y - b.y) / l;
    const ny = (ccw ? a.x - b.x : b.x - a.x) / l;
    const k = Math.max(1, Math.round(l / STEP));
    for (let j = 0; j < k; j++) {
      const px = a.x + ((b.x - a.x) * (j + 0.5)) / k;
      const py = a.y + ((b.y - a.y) * (j + 0.5)) / k;
      const spoke = {
        ax: px + nx * 0.02,
        ay: py + ny * 0.02,
        bx: px + nx * reach,
        by: py + ny * reach,
      };
      let ok = [spoke.ax, spoke.bx].every((x) => x >= -1e-3 && x <= sheet.width + 1e-3);
      ok &&= [spoke.ay, spoke.by].every((y) => y >= -1e-3 && y <= sheet.height + 1e-3);
      if (ok) {
        const seen = new Set<DeepCut>();
        const i0 = Math.floor(Math.min(spoke.ax, spoke.bx) / CELL);
        const i1 = Math.floor(Math.max(spoke.ax, spoke.bx) / CELL);
        const j0 = Math.floor(Math.min(spoke.ay, spoke.by) / CELL);
        const j1 = Math.floor(Math.max(spoke.ay, spoke.by) / CELL);
        for (let ci = i0; ci <= i1 && ok; ci++)
          for (let cj = j0; cj <= j1 && ok; cj++)
            for (const c of cells.get(`${ci},${cj}`) ?? []) {
              if (seen.has(c)) continue;
              seen.add(c);
              if (segSeg(c, spoke) < c.r - 0.005) {
                ok = false;
                break;
              }
            }
      }
      held.push(ok);
      len.push(l / k);
    }
  }
  const m = held.length;
  if (m === 0) return [];
  if (held.every(Boolean)) return [len.reduce((s, x) => s + x, 0)];
  // start right after a blocked sample so runs never wrap
  const first = held.findIndex((h) => !h);
  const runs: number[] = [];
  let run = 0;
  for (let t = 1; t <= m; t++) {
    const k = (first + t) % m;
    if (held[k]) run += len[k] as number;
    else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

/** Rule PART_NOT_HELD over one sheet's expected parts and every deep read move of the sheet. */
export function partHoldRule(
  layout: readonly ExpectedPart[],
  cuts: readonly DeepCut[],
  d: Derived,
  push: Push,
): void {
  const sheet = { width: d.ctx.stock.sheetWidth, height: d.ctx.stock.sheetHeight };
  for (const e of layout) {
    if (e.outlineCut === false || !e.outline) continue;
    if (e.small && e.skin) continue; // held by the thin skin (T143)
    const op = d.ctx.toolpath.operations.find(
      (o) =>
        o.kind === 'outerContour' &&
        o.sheet === d.ctx.sheet &&
        o.partId === e.partId &&
        o.copy === e.copy,
    );
    const name = `Part ${e.partId} copy ${e.copy}`;
    if (!op) {
      push(
        'LAYOUT',
        'PART_NOT_HELD',
        0,
        `${name}: no contour in the job, so whether its tabs hold cannot be decided.`,
      );
      continue;
    }
    const need = e.small ? Math.max(2, op.tabs.length) : op.tabs.length;
    if (need === 0) continue;
    const tabs = holdingRuns(e.outline, op.toolDiameter, cuts, sheet).filter(
      (r) => r >= MIN_RUN,
    ).length;
    if (tabs >= need) continue;
    push(
      'LAYOUT',
      'PART_NOT_HELD',
      0,
      `${name}: ${tabs} of ${need} tabs hold in the program; a cut through the ${WEB} mm web behind them or the sheet edge leaves the part loose.`,
    );
  }
}
