// Pure data (no imports): also read by tools/brand/gen-icons.mjs with plain Node.

/**
 * NittCam brand mark (T194, review #1 §4.1): the letter "N" drawn as one router toolpath.
 * A curved lead-in enters at the bottom left, the tool plunges up the first leg, makes one
 * diagonal pass, climbs the second leg and stops on a filled tool dot.
 * Geometry lives here once; the favicon/app icons are generated from the same numbers.
 */
export const BRAND_MARK = {
  viewBox: 32,
  /** Tile corner radius (app icon / favicon shape). */
  tileRadius: 8,
  stroke: 3,
  /** Lead-in: quarter arc tangent to the first leg. */
  leadIn: 'M5.5 26.5A3.5 3.5 0 0 0 9 23',
  /** The cut: first leg up, diagonal down, second leg up. */
  path: 'M9 23V9L23 23V9',
  dot: { cx: 23, cy: 7.5, r: 2.75 },
  /** Lead-in opacity: the approach is lighter than the cut. */
  leadInOpacity: 0.5,
} as const;
