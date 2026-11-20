// B44 "fit to job": the default 2D / 3D view of a small job frames its parts, not the whole sheet.

/** A box in the sheet frame (mm, origin front left, Y up). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * "Fit to job" (B44): on a small job the parts sit in a corner of a large sheet and read as a few
 * pixels. Returns the parts' box with a margin when fitting it zooms in at least `minGain` times
 * over the whole sheet, else null (the sheet fit stays the default view).
 */
export function jobBox(
  parts: readonly { x: number; y: number; w: number; h: number }[],
  sheet: { width: number; height: number },
  minGain = 1.6,
): Box | null {
  if (parts.length === 0 || sheet.width <= 0 || sheet.height <= 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.w);
    y1 = Math.max(y1, p.y + p.h);
  }
  // Margin: room for the labels and the lead-ins; never past the sheet edge.
  const m = Math.max(20, 0.08 * Math.max(x1 - x0, y1 - y0));
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(sheet.width, x1 + m);
  y1 = Math.min(sheet.height, y1 + m);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const gain = Math.min(sheet.width / w, sheet.height / h);
  return gain >= minGain ? { x: x0, y: y0, width: w, height: h } : null;
}

/**
 * Scale and pan that show the whole sheet centred with `pad` pixels around it (room for the edge
 * dimensions, T196); with `box`, that part of the sheet instead (fit to job, B44).
 */
export function fitView(
  sheet: { width: number; height: number },
  width: number,
  height: number,
  pad = 30,
  /** Extra vertical room (px, top and bottom alike) for floating toolbars, T244. */
  band = 0,
  box: Box | null = null,
): { scale: number; x: number; y: number } {
  const b = box ?? { x: 0, y: 0, width: sheet.width, height: sheet.height };
  const scale = Math.max(
    0.0001,
    Math.min((width - 2 * pad) / b.width, (height - 2 * (pad + band)) / b.height),
  );
  // Screen y grows down: the box top sits (sheet.height - b.y - b.height) mm below the sheet top.
  const top = sheet.height - b.y - b.height;
  return {
    scale,
    x: (width - b.width * scale) / 2 - b.x * scale,
    y: (height - b.height * scale) / 2 - top * scale,
  };
}
