import { readTokenColors } from '../../lib/canvas-theme';

/** Colours of the drawing board, read from the design tokens (Konva cannot use classes). */
export interface EditorColors {
  gridDot: string;
  gridMajor: string;
  origin: string;
  part: string;
  partStroke: string;
  selection: string;
  selectionFill: string;
  selectionText: string;
  /** Snap guides and glyphs (canvas language: `info`). */
  snap: string;
  /** Drawing tools (D-039): in-progress preview and its chips. */
  accent: string;
  /** Open (not closed) drawn shape: "kapalı değil". */
  warning: string;
  text: string;
  dim: string;
  ruler: string;
  rulerEdge: string;
}

const TOKENS: Record<keyof EditorColors, string> = {
  gridDot: '--color-border-strong',
  gridMajor: '--color-grid',
  origin: '--color-accent-text',
  part: '--color-part',
  partStroke: '--color-part-stroke',
  selection: '--color-selection',
  selectionFill: '--color-accent-subtle',
  selectionText: '--color-accent-fg',
  snap: '--color-info',
  accent: '--color-accent',
  warning: '--color-warning',
  text: '--color-fg',
  dim: '--color-fg-muted',
  ruler: '--color-surface',
  rulerEdge: '--color-border',
};

export function readEditorColors(): EditorColors {
  return readTokenColors(TOKENS, getComputedStyle(document.documentElement));
}
