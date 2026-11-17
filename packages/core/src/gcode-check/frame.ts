/**
 * Machine frame → sheet frame for the checks (T019, D-027). Written here from the profile fields
 * (spec §6.1, §7.1), independently of the post processor's forward conversion (`post/frame`), so
 * a frame bug in the generator cannot cancel itself out in the check.
 *
 * Sheet frame: origin at the sheet's bottom-left corner seen from the front, X right, Y towards
 * the back, Z 0 = material top. Machine frame: program zero at `origin.corner`; the sheet corner
 * nearest to it sits `sheetOffset` mm from it, into the table; `xPositive`/`yPositive` say where
 * +X/+Y point physically; Z zero is the material top or the table surface.
 */
import type { MachineProfile } from '../machine';

export interface CheckFrame {
  /** Physical "right" of a machine X value: right = sx · X. */
  sx: 1 | -1;
  sy: 1 | -1;
  /** "Into the table" from program zero, as a physical sign (right/back = +1). */
  intoX: 1 | -1;
  intoY: 1 | -1;
  /** Physical position (right, back) of the sheet's bottom-left corner relative to program zero. */
  sheetX: number;
  sheetY: number;
  /** Sheet Z = machine Z − zShift. */
  zShift: number;
  /** One axis mirrored: G2 in the machine frame is CCW in the sheet frame. */
  mirrored: boolean;
}

export function checkFrame(
  profile: Pick<MachineProfile, 'origin' | 'zZero'>,
  stock: { thickness: number; sheetWidth: number; sheetHeight: number },
): CheckFrame {
  const o = profile.origin;
  const left = o.corner === 'frontLeft' || o.corner === 'backLeft';
  const front = o.corner === 'frontLeft' || o.corner === 'frontRight';
  const sx: 1 | -1 = o.xPositive === 'right' ? 1 : -1;
  const sy: 1 | -1 = o.yPositive === 'back' ? 1 : -1;
  // Zero at the left: the sheet's left edge is offset.x to its right. Zero at the right: the
  // sheet's right edge is offset.x to its left, so the left edge is offset.x + width to the left.
  const sheetX = left ? o.sheetOffset.x : -(o.sheetOffset.x + stock.sheetWidth);
  const sheetY = front ? o.sheetOffset.y : -(o.sheetOffset.y + stock.sheetHeight);
  return {
    sx,
    sy,
    intoX: left ? 1 : -1,
    intoY: front ? 1 : -1,
    sheetX,
    sheetY,
    zShift: profile.zZero.reference === 'table' ? stock.thickness : 0,
    mirrored: sx !== sy,
  };
}

/** Machine XY → sheet XY. */
export function sheetXY(f: CheckFrame, x: number, y: number): { x: number; y: number } {
  return { x: f.sx * x - f.sheetX, y: f.sy * y - f.sheetY };
}

/** Machine point → sheet point. */
export function sheetPoint(
  f: CheckFrame,
  p: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return { ...sheetXY(f, p.x, p.y), z: p.z - f.zShift };
}

/** Arc direction in the sheet frame. */
export function sheetDirection(f: CheckFrame, d: 'cw' | 'ccw'): 'cw' | 'ccw' {
  if (!f.mirrored) return d;
  return d === 'cw' ? 'ccw' : 'cw';
}

/** Distance of a machine point from program zero measured into the table, per axis. */
export function intoTable(f: CheckFrame, x: number, y: number): { x: number; y: number } {
  return { x: f.intoX * f.sx * x, y: f.intoY * f.sy * y };
}

/** Height above the table surface of a machine Z (sheet Z + thickness). */
export function aboveTable(f: CheckFrame, z: number, thickness: number): number {
  return z - f.zShift + thickness;
}
