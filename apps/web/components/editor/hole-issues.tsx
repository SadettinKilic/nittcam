'use client';

import type { ValidationIssue } from '@nittcam/core';
import { createContext, useContext } from 'react';

export { holeErrors } from '../../lib/part-items';

/** Hole index → its blocking validation errors (T275). */
export type PartHoleIssues = ReadonlyMap<number, readonly ValidationIssue[]>;

export interface HoleIssues {
  /** Part id → its holes with errors. */
  byPart: ReadonlyMap<string, PartHoleIssues>;
  /** Tool table of the selected machine ("3 · Ø5"); null without a machine. */
  tools: readonly { number: number; diameter: number; type?: string }[] | null;
  /** The hole "Çizimde aç" asked for; its rows are scrolled into view once. */
  focus?: { partId: string; hole: number } | null;
}

const EMPTY_PART: PartHoleIssues = new Map();
const EMPTY: HoleIssues = { byPart: new Map(), tools: null };

/** The wizard's hole errors and tool table for the drawing board's properties panel (T275). */
export const HoleIssuesContext = createContext<HoleIssues>(EMPTY);

export function useHoleIssues(partId: string): {
  byHole: PartHoleIssues;
  tools: HoleIssues['tools'];
  focus: number | null;
} {
  const ctx = useContext(HoleIssuesContext);
  return {
    byHole: ctx.byPart.get(partId) ?? EMPTY_PART,
    tools: ctx.tools,
    focus: ctx.focus?.partId === partId ? ctx.focus.hole : null,
  };
}
