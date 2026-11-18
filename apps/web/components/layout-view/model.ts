import { partBoxSize, type Placement, type Project } from '@nittcam/core';
import { readTokenColors } from '../../lib/canvas-theme';

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
  grainLock: boolean;
}

/** The placements of one sheet, ready to draw. Placements of unknown parts are skipped. */
export function drawnParts(project: Project, sheet: number): DrawnPart[] {
  const rows = new Map(project.parts.map((p, i) => [p.id, { part: p, row: i + 1 }]));
  const out: DrawnPart[] = [];
  for (const pl of project.layout.sheets[sheet]?.placements ?? []) {
    const hit = rows.get(pl.partId);
    if (!hit) continue;
    const size = partBoxSize(hit.part);
    const turned = pl.rot === 90 || pl.rot === 270;
    out.push({
      key: copyKey(pl),
      partId: pl.partId,
      index: pl.index,
      label: `${hit.row}.${pl.index + 1}`,
      name: hit.part.name,
      x: pl.x,
      y: pl.y,
      w: turned ? size.h : size.w,
      h: turned ? size.w : size.h,
      rot: pl.rot,
      locked: pl.locked,
      grainLock: hit.part.grainLock,
    });
  }
  return out;
}

/** Scale and pan that show the whole sheet centred with `pad` pixels around it. */
export function fitView(
  sheet: { width: number; height: number },
  width: number,
  height: number,
  pad = 12,
): ViewState {
  const scale = Math.max(
    0.0001,
    Math.min((width - 2 * pad) / sheet.width, (height - 2 * pad) / sheet.height),
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
