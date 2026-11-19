/**
 * Geometry tolerances (spec §6.1, geometry-kernel skill). The only tolerances in core: use these
 * instead of literal numbers.
 */

/** Length epsilon in millimetres: two values closer than this are equal. */
export const EPS = 0.001;

/**
 * Floating-point noise in millimetres (T273): the same geometry computed in a different frame (a
 * part alone vs placed on a sheet) differs by far less than this. Exact-fit decisions (does a tab
 * fit exactly between two corners?) allow it, so they never depend on where a part lies. Far
 * below EPS: it never makes something fit that does not.
 */
export const NOISE = 1e-9;

/** Join tolerance in millimetres: open ends closer than this are joined into a closed contour. */
export const JOIN_TOL = 0.05;

/**
 * Bulges smaller than this in magnitude are treated as straight lines. For a 10 m chord the
 * sagitta of such an arc is 5 nm, far below EPS, while the circle through it would be so large
 * that centre ± radius loses precision.
 */
export const MIN_BULGE = 1e-9;

/**
 * Curve approximation tolerance in millimetres (T144): a SPLINE or ELLIPSE converted to line
 * segments deviates from the true curve by at most this much.
 */
export const CURVE_TOL = 0.01;
