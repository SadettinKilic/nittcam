/**
 * Geometry tolerances (spec §6.1, geometry-kernel skill). The only tolerances in core: use these
 * instead of literal numbers.
 */

/** Length epsilon in millimetres: two values closer than this are equal. */
export const EPS = 0.001;

/** Join tolerance in millimetres: open ends closer than this are joined into a closed contour. */
export const JOIN_TOL = 0.05;

/**
 * Bulges smaller than this in magnitude are treated as straight lines. For a 10 m chord the
 * sagitta of such an arc is 5 nm, far below EPS, while the circle through it would be so large
 * that centre ± radius loses precision.
 */
export const MIN_BULGE = 1e-9;
