import type { SimMachineFrame, SimSheet } from '@nittcam/core';
import { readTokenColors } from '../../lib/canvas-theme';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';

export type SimText = Messages['simulation'];

/** Colours of the simulation drawing, read from the design tokens in `globals.css`. */
export interface SimColors {
  margin: string;
  waste: string;
  edge: string;
  part: string;
  partStroke: string;
  depthTop: string;
  depthBottom: string;
  rapid: string;
  tool: string;
  table: string;
  envelope: string;
  zero: string;
  tab: string;
  badge: string;
  badgeFg: string;
  /** Whole-path ghost at t = 0 (cut = accent 35 %), T196. */
  ghost: string;
  /** Secondary part label line ("W × H"). */
  dim: string;
  text: string;
  /** Sheet grain texture and part grain arrows (T116). */
  grain: string;
}

const TOKENS: Record<keyof SimColors, string> = {
  margin: '--color-sheet-margin',
  waste: '--color-sheet-waste',
  edge: '--color-sheet-edge',
  part: '--color-sim-part',
  partStroke: '--color-sim-part-stroke',
  depthTop: '--color-sim-depth-top',
  depthBottom: '--color-sim-depth-bottom',
  rapid: '--color-sim-rapid',
  tool: '--color-sim-tool',
  table: '--color-sim-table',
  envelope: '--color-sim-envelope',
  zero: '--color-sim-zero',
  tab: '--color-sim-tab',
  badge: '--color-sim-badge',
  badgeFg: '--color-sim-badge-fg',
  text: '--color-fg',
  ghost: '--color-accent',
  dim: '--color-fg-muted',
  grain: '--color-grain',
};

export function readSimColors(): SimColors {
  return readTokenColors(TOKENS, getComputedStyle(document.documentElement));
}

/** Number of depth colour steps (cuts are batched per colour when drawing). */
export const DEPTH_LEVELS = 12;

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = Number.parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The depth ramp: level 0 = material top, last = final depth. */
export function depthRamp(top: string, bottom: string, levels = DEPTH_LEVELS): string[] {
  const a = hexRgb(top);
  const b = hexRgb(bottom);
  return Array.from({ length: levels }, (_, i) => {
    const f = levels > 1 ? i / (levels - 1) : 1;
    const c = a.map((v, k) => Math.round(v + ((b[k] ?? v) - v) * f));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  });
}

/** Depth level of a Z (0 at or above the material top, last at the final depth). */
export function depthLevel(z: number, zBottom: number, levels = DEPTH_LEVELS): number {
  if (zBottom >= 0 || z >= 0) return 0;
  const f = Math.min(1, z / zBottom);
  return Math.min(levels - 1, Math.max(0, Math.round(f * (levels - 1))));
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the view fits: the sheet, the table and the program zero (sheet frame, mm). */
export function simBounds(
  sheet: { width: number; height: number },
  machine: SimMachineFrame | null,
): Bounds {
  let x0 = 0;
  let y0 = 0;
  let x1 = sheet.width;
  let y1 = sheet.height;
  if (machine) {
    // Table and the dashed travel outline both stay inside the fit (T245: never clipped).
    const t = machine.table;
    const e = machine.envelope;
    x0 = Math.min(x0, t.x, e.x, machine.zero.x);
    y0 = Math.min(y0, t.y, e.y, machine.zero.y);
    x1 = Math.max(x1, t.x + t.width, e.x + e.width, machine.zero.x);
    y1 = Math.max(y1, t.y + t.height, e.y + e.height, machine.zero.y);
  }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.02;
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad };
}

const num1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const num0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const num3 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 3 });

export const formatMm = (v: number) => num1.format(v);
export const formatInt = (v: number) => num0.format(v);
export const formatCoord = (v: number) => num3.format(Math.abs(v) < 0.0005 ? 0 : v);

/** "1 sa 5 dk", "12 dk 30 sn", "45 sn". */
export function formatDuration(t: SimText, seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return fill(t.time.hours, { h, m });
  if (m > 0) return fill(t.time.minutes, { m, s: r });
  return fill(t.time.seconds, { s: r });
}

/** Playback clock "mm:ss" (or "h:mm:ss"). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Metres from millimetres, "12,4 m". */
export function formatMeters(t: SimText, mm: number): string {
  return fill(t.meters, { value: num1.format(mm / 1000) });
}

/** Tool diameter of a step's tool, or the first diameter the program uses. */
export function toolDiameterOf(sim: SimSheet, tool: number | null): number | null {
  if (tool !== null && sim.toolDiameters[tool] !== undefined) return sim.toolDiameters[tool];
  const any = Object.values(sim.toolDiameters)[0];
  return any ?? null;
}
