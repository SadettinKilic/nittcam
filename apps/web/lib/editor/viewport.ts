/**
 * Drawing-board viewport (T124, spec §4.2): board millimetres with Y up, drawn on a screen with
 * Y down. screen.x = x · scale + view.x, screen.y = view.y − y · scale. Pure helpers.
 */

export interface Viewport {
  /** Pixels per millimetre. */
  scale: number;
  /** Screen position of the board origin, px. */
  x: number;
  y: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 50;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function toScreen(v: Viewport, p: Pt): Pt {
  return { x: p.x * v.scale + v.x, y: v.y - p.y * v.scale };
}

export function toWorld(v: Viewport, s: Pt): Pt {
  return { x: (s.x - v.x) / v.scale, y: (v.y - s.y) / v.scale };
}

/** Zoom by `factor` keeping the screen point `at` over the same board point. */
export function zoomAt(v: Viewport, factor: number, at: Pt): Viewport {
  const scale = clampScale(v.scale * factor);
  const w = toWorld(v, at);
  return { scale, x: at.x - w.x * scale, y: at.y + w.y * scale };
}

export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { scale: v.scale, x: v.x + dx, y: v.y + dy };
}

/** Insets of the screen area kept free of the drawing by floating controls, px. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** View that shows `box` centred in a `width` × `height` screen with `insets` free. */
export function fitBox(
  box: Box | undefined,
  width: number,
  height: number,
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 },
  /** Screen padding around the box, px (T243: 48). Without it the box fills 90 %. */
  padding?: number,
): Viewport {
  const b = box ?? { minX: 0, minY: -1000, maxX: 2000, maxY: 0 };
  const bw = Math.max(b.maxX - b.minX, 1);
  const bh = Math.max(b.maxY - b.minY, 1);
  const aw = Math.max(width - insets.left - insets.right, 1);
  const ah = Math.max(height - insets.top - insets.bottom, 1);
  const scale = clampScale(
    padding === undefined
      ? Math.min(aw / bw, ah / bh) * 0.9
      : Math.min(Math.max(aw - 2 * padding, 1) / bw, Math.max(ah - 2 * padding, 1) / bh),
  );
  const cx = insets.left + aw / 2;
  const cy = insets.top + ah / 2;
  return {
    scale,
    x: cx - ((b.minX + b.maxX) / 2) * scale,
    y: cy + ((b.minY + b.maxY) / 2) * scale,
  };
}

/** Board area visible on the screen. */
export function visibleBox(v: Viewport, width: number, height: number): Box {
  const a = toWorld(v, { x: 0, y: height });
  const b = toWorld(v, { x: width, y: 0 });
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/** Grid levels of the adaptive millimetre grid. */
export const GRID_STEPS = [1, 10, 100, 1000] as const;
/** Smallest on-screen distance between grid dots, px. */
const GRID_MIN_PX = 8;

/**
 * Adaptive grid (1 / 10 / 100 mm): `fine` is the finest step at least 8 px apart on screen
 * (drawn as dots), `major` the next level (drawn as lines). `major` is undefined at the top.
 */
export function gridLevels(scale: number): { fine: number; major: number | undefined } {
  const fine = GRID_STEPS.find((s) => s * scale >= GRID_MIN_PX) ?? 1000;
  const i = GRID_STEPS.indexOf(fine);
  return { fine, major: GRID_STEPS[i + 1] };
}

/** "Nice" ruler step (1, 2, 5 × 10^k mm) at least `minPx` apart on screen. */
export function rulerStep(scale: number, minPx = 64): number {
  const raw = minPx / scale;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** Tick positions (mm) of a ruler covering [min, max] with `step`. */
export function rulerTicks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max && out.length < 500; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Zoom as a percentage of the 1 px = 1 mm scale, rounded. */
export function zoomPercent(scale: number): number {
  return Math.round(scale * 100);
}
