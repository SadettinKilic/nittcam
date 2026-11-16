import type { ViewState } from './model';

const MIN_SCALE = 0.02;
const MAX_SCALE = 20;

/** Keeps the zoom between 0.02 and 20 px per mm. */
export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Zoom by `factor` keeping the screen point (px, py) fixed. */
export function zoomAt(view: ViewState, factor: number, px: number, py: number): ViewState {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}
