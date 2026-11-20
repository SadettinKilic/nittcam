/** View-only interaction rules of the 3D preview (T155); pure. */

/** Upper end of the "ayır/kaldır" slider: lift in mm (at least 40, else 3 × thickness). */
export function explodeMax(thickness: number): number {
  return Math.max(40, thickness * 3);
}

/** Keeps the dragged sheet near the table (view only): at most one sheet size off centre. */
export function clampOffset(
  o: readonly [number, number],
  sheet: { width: number; height: number },
): [number, number] {
  return [
    Math.max(-sheet.width, Math.min(sheet.width, o[0])),
    Math.max(-sheet.height, Math.min(sheet.height, o[1])),
  ];
}
