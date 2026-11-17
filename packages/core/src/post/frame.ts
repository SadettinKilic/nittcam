/**
 * Sheet frame → machine frame (spec §6.1, §7.1; D-025). The ONLY place in NittCam where the
 * machine origin, axis directions, sheet placement and Z-zero reference are applied.
 *
 * Sheet frame: origin at the sheet's bottom-left corner seen from the machine front (X right,
 * Y towards the back), Z = 0 at the material top, negative down.
 *
 * Machine frame: program zero at `origin.corner` (seen from the operator at the front). The sheet
 * corner nearest to that corner sits `sheetOffset` mm from it, measured into the table. `+X` and
 * `+Y` point where `xPositive` / `yPositive` say. Z: `materialTop` → Z_m = Z_s; `table` →
 * Z_m = Z_s + thickness. +Z is always up.
 *
 * Envelope (rule 6): program zero is taken as a corner of the travel, so every point must lie
 * within `workEnvelope.x/y` of it, measured into the table, and between the spoilboard allowance
 * below the table surface and `workEnvelope.z` above it.
 */
import type { MachineProfile } from '../machine';

export interface FrameStock {
  thickness: number;
  /** Sheet size along sheet X (width) and sheet Y (height), mm. */
  sheetWidth: number;
  sheetHeight: number;
}

export interface MachineFrame {
  /** Physical sign of "into the table" from program zero: +1 = right / back. */
  inX: 1 | -1;
  inY: 1 | -1;
  /** Machine axis sign relative to physical right / back. */
  axX: 1 | -1;
  axY: 1 | -1;
  /** Physical offset (right, back) of the sheet origin from program zero. */
  originDx: number;
  originDy: number;
  /** Added to sheet Z. */
  zOffset: number;
  /** Arcs change direction when exactly one axis is mirrored. */
  mirrored: boolean;
  thickness: number;
  envelope: { x: number; y: number; z: number };
  spoilboardAllowance: number;
}

export function machineFrame(
  profile: Pick<MachineProfile, 'origin' | 'zZero' | 'workEnvelope'>,
  stock: FrameStock,
): MachineFrame {
  const { corner, xPositive, yPositive, sheetOffset } = profile.origin;
  const inX: 1 | -1 = corner === 'frontLeft' || corner === 'backLeft' ? 1 : -1;
  const inY: 1 | -1 = corner === 'frontLeft' || corner === 'frontRight' ? 1 : -1;
  const axX: 1 | -1 = xPositive === 'right' ? 1 : -1;
  const axY: 1 | -1 = yPositive === 'back' ? 1 : -1;
  return {
    inX,
    inY,
    axX,
    axY,
    // Zero on the left: the sheet's left edge is offset.x to the right. Zero on the right: the
    // sheet's right edge is offset.x to the left, so its left edge is offset.x + width left.
    originDx: inX === 1 ? sheetOffset.x : -(sheetOffset.x + stock.sheetWidth),
    originDy: inY === 1 ? sheetOffset.y : -(sheetOffset.y + stock.sheetHeight),
    zOffset: profile.zZero.reference === 'table' ? stock.thickness : 0,
    mirrored: axX * axY < 0,
    thickness: stock.thickness,
    envelope: { ...profile.workEnvelope },
    spoilboardAllowance: profile.zZero.spoilboardAllowance,
  };
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Sheet-frame point → machine-frame point. */
export function toMachine(frame: MachineFrame, p: Point3): Point3 {
  return {
    x: frame.axX * (p.x + frame.originDx),
    y: frame.axY * (p.y + frame.originDy),
    z: p.z + frame.zOffset,
  };
}

/** Sheet-frame XY → machine-frame XY (arc centres). */
export function toMachineXY(frame: MachineFrame, x: number, y: number): { x: number; y: number } {
  return { x: frame.axX * (x + frame.originDx), y: frame.axY * (y + frame.originDy) };
}

/** Arc direction in the machine frame (a mirrored frame swaps cw and ccw). */
export function machineArcDirection(frame: MachineFrame, direction: 'cw' | 'ccw'): 'cw' | 'ccw' {
  if (!frame.mirrored) return direction;
  return direction === 'cw' ? 'ccw' : 'cw';
}

/** Tolerance of the envelope test, mm. */
const ENVELOPE_EPS = 1e-6;

/**
 * Why a sheet-frame point is outside the work envelope, or null when it is inside (rule 6).
 * Checked with the physical distances into the table, so it holds for every corner and axis sign.
 */
export function envelopeViolation(frame: MachineFrame, p: Point3): string | null {
  const intoX = frame.inX * (p.x + frame.originDx);
  const intoY = frame.inY * (p.y + frame.originDy);
  if (intoX < -ENVELOPE_EPS || intoX > frame.envelope.x + ENVELOPE_EPS) {
    return `X travel: ${intoX.toFixed(3)} mm from program zero, envelope 0–${frame.envelope.x}`;
  }
  if (intoY < -ENVELOPE_EPS || intoY > frame.envelope.y + ENVELOPE_EPS) {
    return `Y travel: ${intoY.toFixed(3)} mm from program zero, envelope 0–${frame.envelope.y}`;
  }
  return zEnvelopeViolation(frame, p.z);
}

/** Z part of the envelope test for a sheet-frame Z (rule 6). */
export function zEnvelopeViolation(frame: MachineFrame, z: number): string | null {
  const aboveTable = z + frame.thickness;
  if (aboveTable < -frame.spoilboardAllowance - ENVELOPE_EPS) {
    return `Z: ${(-aboveTable).toFixed(3)} mm below the table surface, allowance ${frame.spoilboardAllowance}`;
  }
  if (aboveTable > frame.envelope.z + ENVELOPE_EPS) {
    return `Z: ${aboveTable.toFixed(3)} mm above the table surface, Z travel ${frame.envelope.z}`;
  }
  return null;
}
