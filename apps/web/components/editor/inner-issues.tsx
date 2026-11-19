'use client';

import type { Project, ValidationIssue } from '@nittcam/core';
import { createContext, useContext } from 'react';

/** Part id → indexes of its cut-outs whose slug has no room for 2 tabs (T270). */
export type InnerIssues = ReadonlyMap<string, ReadonlySet<number>>;

const EMPTY: InnerIssues = new Map();

/** T270: the `INNER_SLUG_UNSECURED` validation errors by part id and cut-out index. */
export function unsecuredInners(project: Project, issues: readonly ValidationIssue[]): InnerIssues {
  const out = new Map<string, Set<number>>();
  for (const i of issues) {
    if (i.code !== 'INNER_SLUG_UNSECURED') continue;
    const m = /^parts\[(\d+)\]\.inners\[(\d+)\]/.exec(i.path);
    const part = m ? project.parts[Number(m[1])] : undefined;
    if (!m || !part) continue;
    const set = out.get(part.id) ?? new Set<number>();
    set.add(Number(m[2]));
    out.set(part.id, set);
  }
  return out;
}

/** The wizard's cut-out errors for the drawing board's properties panel (T270). */
export const InnerIssuesContext = createContext<InnerIssues>(EMPTY);

export function useInnerIssues(partId: string): ReadonlySet<number> {
  return useContext(InnerIssuesContext).get(partId) ?? new Set<number>();
}
