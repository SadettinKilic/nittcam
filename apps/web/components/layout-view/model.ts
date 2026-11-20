import {
  normalizeGrain,
  partShape,
  rotatedBoxSize,
  type Placement,
  type Project,
  toCutSizes,
} from '@nittcam/core';
import { readTokenColors } from '../../lib/canvas-theme';
import { footprintInners, footprintOutline } from '../../lib/placed-outline';

/** Pixels per mm and the pan of the stage. */
export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

/** Colours of the drawing, read from the design tokens in `globals.css`. */
export interface CanvasColors {
  margin: string;
  waste: string;
  edge: string;
  grid: string;
  part: string;
  partStroke: string;
  partLocked: string;
  partLockedStroke: string;
  selected: string;
  conflict: string;
  conflictFill: string;
  text: string;
  /** Sheet dimension labels and the scale bar (T196). */
  dim: string;
  /** Origin marker. */
  origin: string;
  /** Sheet grain texture (T116). */
  grain: string;
}

/** Token name per colour (CSS custom properties of the Tailwind theme). */
const TOKENS: Record<keyof CanvasColors, string> = {
  margin: '--color-sheet-margin',
  waste: '--color-sheet-waste',
  edge: '--color-sheet-edge',
  grid: '--color-grid',
  part: '--color-part',
  partStroke: '--color-part-stroke',
  partLocked: '--color-part-locked',
  partLockedStroke: '--color-part-locked-stroke',
  selected: '--color-selection',
  conflict: '--color-danger',
  conflictFill: '--color-danger-subtle',
  text: '--color-fg',
  dim: '--color-fg-muted',
  origin: '--color-accent-text',
  grain: '--color-grain',
};

/** Reads the colour tokens from the document (browser only). */
export function readColors(): CanvasColors {
  return readTokenColors(TOKENS, getComputedStyle(document.documentElement));
}

/** Stable key of a part copy. */
export function copyKey(ref: { partId: string; index: number }): string {
  return `${ref.partId}#${ref.index}`;
}

/** One placement as drawn: footprint after rotation, label and flags. */
export interface DrawnPart {
  key: string;
  partId: string;
  index: number;
  /** "row.copy": cut-list row number and copy number, both from 1. */
  label: string;
  name: string;
  x: number;
  y: number;
  /** Footprint after rotation. */
  w: number;
  h: number;
  rot: Placement['rot'];
  locked: boolean;
  /** Sheet-frame angle of a fixed-grain part's grain line ([0, 180), D-034); null = free grain. */
  grainAngle: number | null;
  /** True outline in the footprint frame (Y down), or null when the footprint rectangle is it (T116). */
  outline: number[] | null;
  /** Inner contours (cut-outs, T134) in the same frame; they turn with the part. */
  inners: number[][];
}

type PartRow = { part: Project['parts'][number]; row: number };

function drawPlacement(hit: PartRow, pl: Placement): DrawnPart {
  const size = rotatedBoxSize(partShape(hit.part), pl.rot);
  return {
    key: copyKey(pl),
    partId: pl.partId,
    index: pl.index,
    label: `${hit.row}.${pl.index + 1}`,
    name: hit.part.name,
    x: pl.x,
    y: pl.y,
    w: size.w,
    h: size.h,
    rot: pl.rot,
    locked: pl.locked,
    grainAngle:
      hit.part.grain.mode === 'fixed' ? normalizeGrain(hit.part.grain.angle + pl.rot) : null,
    outline: footprintOutline(hit.part, pl.rot, size.h),
    inners: footprintInners(hit.part, pl.rot, size.h),
  };
}

/** The placements of one sheet, ready to draw. Placements of unknown parts are skipped. */
export function drawnParts(entered: Project, sheet: number): DrawnPart[] {
  const project = toCutSizes(entered);
  const rows = new Map(project.parts.map((p, i) => [p.id, { part: p, row: i + 1 }]));
  const out: DrawnPart[] = [];
  for (const pl of project.layout.sheets[sheet]?.placements ?? []) {
    const hit = rows.get(pl.partId);
    if (hit) out.push(drawPlacement(hit, pl));
  }
  return out;
}

/**
 * A drawn part turned to `rot` around its bottom-left corner (T170: R while dragging or with a
 * pending move). Footprint, outline and grain arrow follow the new angle; x/y stay.
 */
export function turnedPart(entered: Project, part: DrawnPart, rot: number): DrawnPart {
  const project = toCutSizes(entered);
  const row = project.parts.findIndex((p) => p.id === part.partId);
  const hit = project.parts[row];
  if (!hit) return part;
  return drawPlacement(
    { part: hit, row: row + 1 },
    { partId: part.partId, index: part.index, x: part.x, y: part.y, rot, locked: part.locked },
  );
}

/** Scale and pan that show the whole sheet centred with `pad` pixels around it (room for the edge dimensions, T196). */
export function fitView(
  sheet: { width: number; height: number },
  width: number,
  height: number,
  pad = 30,
  /** Extra vertical room (px, top and bottom alike) for floating toolbars, T244. */
  band = 0,
): ViewState {
  const scale = Math.max(
    0.0001,
    Math.min((width - 2 * pad) / sheet.width, (height - 2 * (pad + band)) / sheet.height),
  );
  return {
    scale,
    x: (width - sheet.width * scale) / 2,
    y: (height - sheet.height * scale) / 2,
  };
}

/** Canvas height for a container width: the sheet's aspect ratio, kept between 220 and 640 px. */
export function canvasHeight(sheet: { width: number; height: number }, width: number): number {
  return Math.round(Math.min(640, Math.max(220, (width * sheet.height) / sheet.width)));
}
