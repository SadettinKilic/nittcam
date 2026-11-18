/**
 * Canvas visual language v1 (T196, spec §2.4, §3.6, §6.5): pure rules for what a part label
 * shows at the current zoom, the sheet's edge dimensions and a "nice" scale bar. Shared by the
 * layout and the simulation canvases so both follow the same fallback rule.
 */

const MM = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** Turkish millimetre number: 2800 → "2.800", 12.5 → "12,5". */
export function formatMm(v: number): string {
  return MM.format(v);
}

/** "W × H" in Turkish digits (no unit; the canvas legend says mm). */
export function sizeText(w: number, h: number): string {
  return `${formatMm(w)} × ${formatMm(h)}`;
}

/** Approximate advance of one mono glyph, as a fraction of the font size. */
export const MONO_ADVANCE = 0.62;
/** Line height as a fraction of the font size. */
export const LINE_HEIGHT = 1.25;
/** Inner padding of a label inside the part, px on screen. */
const PAD_PX = 6;
/** On-screen font size range for part labels, px. */
const FONT_MIN_PX = 10;
const FONT_MAX_PX = 13;
/** Smallest readable number-only label, px. */
const NUMBER_MIN_PX = 8;

export type PartLabelLevel = 'full' | 'number' | 'none';

export interface PartLabel {
  level: PartLabelLevel;
  /** Lines top to bottom: full = [number + name, "W × H"], number = [number], none = []. */
  lines: string[];
  /** Font size in canvas units (mm): px on screen / scale. */
  font: number;
}

function fitsWidth(text: string, fontPx: number, boxPx: number): boolean {
  return text.length * fontPx * MONO_ADVANCE <= boxPx - 2 * PAD_PX;
}

/** Cuts `text` with "…" so it fits `boxPx`; null when not even one glyph + "…" fits. */
function truncate(text: string, fontPx: number, boxPx: number): string | null {
  if (fitsWidth(text, fontPx, boxPx)) return text;
  const max = Math.floor((boxPx - 2 * PAD_PX) / (fontPx * MONO_ADVANCE)) - 1;
  if (max < 1) return null;
  return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * Label of a part drawn `w × h` mm at `scale` px/mm: number + name and "W × H" when the part is
 * large enough on screen, else the number only, else nothing. Text never overflows the part.
 */
export function partLabel(input: {
  number: string;
  name: string;
  w: number;
  h: number;
  scale: number;
}): PartLabel {
  const { number, name, w, h, scale } = input;
  const wPx = w * scale;
  const hPx = h * scale;
  const fontPx = Math.max(FONT_MIN_PX, Math.min(FONT_MAX_PX, Math.min(wPx, hPx) * 0.16));
  const size = sizeText(w, h);
  const title = name.trim() ? truncate(`${number} ${name.trim()}`, fontPx, wPx) : number;
  const twoLines = 2 * fontPx * LINE_HEIGHT <= hPx - 2 * PAD_PX;
  if (
    twoLines &&
    title !== null &&
    title.length > number.length + 2 &&
    fitsWidth(size, fontPx, wPx)
  ) {
    return { level: 'full', lines: [title, size], font: fontPx / scale };
  }
  const numPx = Math.max(NUMBER_MIN_PX, Math.min(FONT_MAX_PX, Math.min(wPx, hPx) * 0.3));
  if (numPx * LINE_HEIGHT <= hPx - 4 && number.length * numPx * MONO_ADVANCE <= wPx - 4) {
    return { level: 'number', lines: [number], font: numPx / scale };
  }
  return { level: 'none', lines: [], font: numPx / scale };
}

/** Scale bar: a 1/2/5 × 10ⁿ mm length whose on-screen size is close to `targetPx`. */
export function scaleBar(scale: number, targetPx = 96): { mm: number; px: number; text: string } {
  const raw = targetPx / Math.max(scale, 1e-9);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 5, 10].map((k) => k * pow);
  let mm = steps[0] ?? pow;
  for (const s of steps) if (Math.abs(s - raw) < Math.abs(mm - raw)) mm = s;
  return { mm, px: mm * scale, text: `${formatMm(mm)} mm` };
}

/** Space the sheet dimension labels need around the sheet, px on screen. */
export const DIMENSION_GUTTER_PX = 22;

/** Axis-aligned box in sheet millimetres, Y up. */
export interface MmBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Box a centred part label occupies (sheet mm, Y up); null when the label is empty. */
export function labelBox(
  part: { x: number; y: number; w: number; h: number },
  label: PartLabel,
): MmBox | null {
  if (label.lines.length === 0) return null;
  const longest = Math.max(...label.lines.map((l) => l.length));
  const w = longest * label.font * MONO_ADVANCE;
  const h = label.lines.length * label.font * LINE_HEIGHT;
  const cx = part.x + part.w / 2;
  const cy = part.y + part.h / 2;
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

function circleHitsBox(c: { x: number; y: number }, r: number, b: MmBox): boolean {
  const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1));
  const dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
  return dx * dx + dy * dy < r * r;
}

/**
 * Centre of a cut-order badge of radius `r` (mm) for a contour starting at `start` (T199b).
 * Default: up-left of the start point. When that would cover a part label, the badge moves to
 * the nearest corner of the part the contour belongs to (inside the corner, else just outside),
 * so markers never hide a label.
 */
export function badgeCentre(
  start: { x: number; y: number },
  r: number,
  parts: readonly { x: number; y: number; w: number; h: number }[],
  labels: readonly (MmBox | null)[],
): { x: number; y: number } {
  const hits = (c: { x: number; y: number }) =>
    labels.some((b) => b !== null && circleHitsBox(c, r, b));
  const preferred = { x: start.x - r * 0.9, y: start.y + r * 0.9 };
  if (!hits(preferred)) return preferred;
  const tol = 2 * r;
  const own = parts.find(
    (p) =>
      start.x >= p.x - tol &&
      start.x <= p.x + p.w + tol &&
      start.y >= p.y - tol &&
      start.y <= p.y + p.h + tol,
  );
  if (!own) return preferred;
  const left = start.x - own.x <= own.x + own.w - start.x;
  const bottom = start.y - own.y <= own.y + own.h - start.y;
  const cx = left ? own.x : own.x + own.w;
  const cy = bottom ? own.y : own.y + own.h;
  const sx = left ? 1 : -1;
  const sy = bottom ? 1 : -1;
  const inside = { x: cx + sx * r * 1.1, y: cy + sy * r * 1.1 };
  if (!hits(inside)) return inside;
  return { x: cx - sx * r * 1.1, y: cy - sy * r * 1.1 };
}
