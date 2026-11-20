/**
 * Toolpath overlay and cutting playback of the 3D preview (T156, T157, spec §3.8, §6.5). Built
 * from the **read** program (`SimSheet`, the same data the 2D simulation plays), never from the
 * toolpath model. Pure: flat buffers in the sheet frame (Z 0 = material top), no `three` import,
 * so it is unit-tested and stays out of the lazy 3D chunk's logic.
 */
import { simPlayheadAt, type SimSheet } from '@nittcam/core';
import { DEPTH_LEVELS, depthLevel } from '../../components/simulation/model';

/** Linear RGB triple, 0..1. */
export type Rgb = readonly [number, number, number];

type SimPath = Pick<SimSheet, 'points' | 'steps' | 'zBottom'>;

export interface ToolpathBuffers {
  /** Cut segments: xyz pairs (2 vertices per segment), sheet frame, mm. */
  cut: Float32Array;
  /** Per cut vertex: RGB by depth (the 2D simulation's ramp, material top → final depth). */
  cutColor: Float32Array;
  /** Rapid segments: xyz pairs (drawn dashed). */
  rapid: Float32Array;
  /** Vertex count of `cut` / `rapid` after step i (playback draw ranges). */
  cutEnd: Uint32Array;
  rapidEnd: Uint32Array;
}

/** Depth ramp: level 0 = material top, last = final depth (same steps as the 2D canvas). */
export function depthColors(top: Rgb, bottom: Rgb, levels = DEPTH_LEVELS): Rgb[] {
  return Array.from({ length: levels }, (_, i) => {
    const f = levels > 1 ? i / (levels - 1) : 1;
    const mix = (a: number, b: number) => a + (b - a) * f;
    return [mix(top[0], bottom[0]), mix(top[1], bottom[1]), mix(top[2], bottom[2])] as const;
  });
}

/**
 * Segments of every read move. A step that starts from a position the program never set skips
 * its first segment (the 2D canvas draws it without its XY too).
 */
export function buildToolpath3d(sim: SimPath, top: Rgb, bottom: Rgb): ToolpathBuffers {
  const { steps, points } = sim;
  const ramp = depthColors(top, bottom);
  let cuts = 0;
  let rapids = 0;
  for (const s of steps) {
    const n = Math.max(0, s.p1 - s.p0 - (s.known ? 0 : 1));
    if (s.kind === 'cut') cuts += n;
    else rapids += n;
  }
  const cut = new Float32Array(cuts * 6);
  const cutColor = new Float32Array(cuts * 6);
  const rapid = new Float32Array(rapids * 6);
  const cutEnd = new Uint32Array(steps.length);
  const rapidEnd = new Uint32Array(steps.length);
  let c = 0;
  let r = 0;
  steps.forEach((s, i) => {
    const isCut = s.kind === 'cut';
    const out = isCut ? cut : rapid;
    const rgb = ramp[depthLevel(s.zMin, sim.zBottom)] ?? top;
    for (let k = s.p0 + (s.known ? 0 : 1); k < s.p1; k += 1) {
      let o = isCut ? c : r;
      for (const p of [k, k + 1]) {
        out[o] = points[3 * p] ?? 0;
        out[o + 1] = points[3 * p + 1] ?? 0;
        out[o + 2] = points[3 * p + 2] ?? 0;
        if (isCut) {
          cutColor[o] = rgb[0];
          cutColor[o + 1] = rgb[1];
          cutColor[o + 2] = rgb[2];
        }
        o += 3;
      }
      if (isCut) c = o;
      else r = o;
    }
    cutEnd[i] = c / 3;
    rapidEnd[i] = r / 3;
  });
  return { cut, cutColor, rapid, cutEnd, rapidEnd };
}

/**
 * Vertices of each buffer drawn at time t: every finished step, plus the finished share of the
 * step in progress (whole segments; the tool model shows the exact point). `null` = all.
 */
export function drawCounts(
  buf: Pick<ToolpathBuffers, 'cutEnd' | 'rapidEnd'>,
  sim: Pick<SimSheet, 'steps'>,
  t: number | null,
): { cut: number; rapid: number } {
  const n = buf.cutEnd.length;
  if (t === null || n === 0) {
    return { cut: buf.cutEnd[n - 1] ?? 0, rapid: buf.rapidEnd[n - 1] ?? 0 };
  }
  const ph = simPlayheadAt(sim.steps, t);
  let cut = buf.cutEnd[ph.done - 1] ?? 0;
  let rapid = buf.rapidEnd[ph.done - 1] ?? 0;
  if (ph.active >= 0) {
    const i = ph.active;
    const partial = (end: Uint32Array, start: number) => {
      const segs = ((end[i] ?? start) - start) / 2;
      return Math.floor(segs * Math.min(1, Math.max(0, ph.fraction))) * 2;
    };
    cut += partial(buf.cutEnd, cut);
    rapid += partial(buf.rapidEnd, rapid);
  }
  return { cut, rapid };
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Time at which each copy's outer contour ends (T157: the part lifts slightly then), by slot.
 * The outer contour of a copy is the smallest through-cut contour (one reaching the final depth)
 * whose path box holds the copy's footprint box; repeated passes of the same box take the latest
 * end. `Infinity` = no such contour (the copy never lifts).
 */
export function partLiftTimes(
  sim: Pick<SimSheet, 'points' | 'steps' | 'zBottom'>,
  outlines: readonly Box[],
  tolerance = 0.5,
): Float64Array {
  const boxes = new Map<number, Box & { zMin: number; end: number }>();
  for (const s of sim.steps) {
    if (s.kind !== 'cut' || s.contour <= 0) continue;
    let b = boxes.get(s.contour);
    if (!b) {
      b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, zMin: 0, end: 0 };
      boxes.set(s.contour, b);
    }
    for (let k = s.p0 + (s.known ? 0 : 1); k <= s.p1; k += 1) {
      const x = sim.points[3 * k] ?? 0;
      const y = sim.points[3 * k + 1] ?? 0;
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
    }
    b.zMin = Math.min(b.zMin, s.zMin);
    b.end = Math.max(b.end, s.t1);
  }
  const through = [...boxes.values()].filter((b) => b.zMin <= sim.zBottom + 0.01);
  return Float64Array.from(outlines, (o) => {
    let area = Infinity;
    let end = Infinity;
    for (const b of through) {
      if (
        b.minX > o.minX + tolerance ||
        b.minY > o.minY + tolerance ||
        b.maxX < o.maxX - tolerance ||
        b.maxY < o.maxY - tolerance
      )
        continue;
      const a = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (a < area * 0.999) {
        area = a;
        end = b.end;
      } else if (a <= area * 1.001) {
        end = Math.max(end === Infinity ? 0 : end, b.end);
        area = Math.min(area, a);
      }
    }
    return end;
  });
}

/** How many of the ascending `sorted` end times are reached at time t. */
export function endsReached(sorted: Float64Array, t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? Infinity) <= t + 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Per-slot lift at time t: `amount` once the copy's outer contour has ended, else 0. */
export function liftsAt(times: Float64Array, t: number, amount: number): Float32Array {
  return Float32Array.from(times, (end) => (t + 1e-9 >= end ? amount : 0));
}
