import {
  summarizeLayout,
  type AppliedCommand,
  type Layout,
  type LayoutSummary,
  type NestingMode,
  type ObjectiveCost,
  type Project,
  type RunNestingParams,
} from '@nittcam/core';

/**
 * Nesting results kept per option set (T163, spec §3.6): switching back to a mode (or gap, margin,
 * rotation) that was already nested reuses its layout without running the placer again. The key
 * is everything the placer reads: the project without its unlocked placements, plus the run
 * params. The placer is deterministic, so a reused layout is exactly what a new run would give,
 * and the log still records a plain `runNesting` (replay gives the same layout).
 */
export function optionSetKey(project: Project, params: RunNestingParams): string {
  // Locked placements with their sheet (the placer keeps them); the sheet count itself is not
  // read, so a layout with only unlocked placements keys like no layout.
  const locked = project.layout.sheets.flatMap((s, sheet) =>
    s.placements.filter((p) => p.locked).map((p) => ({ sheet, ...p })),
  );
  // B44 tester round 1: absent options key like their defaults, so a default project (no
  // `rotation` / `partInHole` written yet) finds the same cache entry as the explicit values.
  const nesting = {
    ...project.nesting,
    rotation: project.nesting.rotation ?? 'free',
    partInHole: project.nesting.partInHole ?? false,
  };
  return JSON.stringify([{ ...project, nesting, layout: locked }, params]);
}

/** The same key with another mode (for the per-mode figures on the mode cards). */
export function optionSetKeyForMode(
  project: Project,
  params: RunNestingParams,
  mode: NestingMode,
): string {
  return optionSetKey({ ...project, nesting: { ...project.nesting, mode } }, params);
}

export interface CachedNesting {
  layout: Layout;
  summary: LayoutSummary;
  /** Objective terms when the placer ran (path, tool changes; B44 mode cards). */
  cost?: ObjectiveCost;
}

/** At most this many option sets are kept (oldest dropped first). */
export const NESTING_CACHE_SIZE = 12;

/** A small insertion-ordered cache; `get` refreshes an entry. */
export class NestingCache {
  private readonly entries = new Map<string, CachedNesting>();

  get(key: string): CachedNesting | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  /** Looks without refreshing (for display). */
  peek(key: string): CachedNesting | undefined {
    return this.entries.get(key);
  }

  set(key: string, layout: Layout, project: Project, cost?: ObjectiveCost): void {
    this.entries.delete(key);
    const summary = summarizeLayout({ ...project, layout });
    this.entries.set(key, cost ? { layout, summary, cost } : { layout, summary });
    while (this.entries.size > NESTING_CACHE_SIZE) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * The `runNesting` result for a cached layout, relative to the current project: one patch that
 * replaces the layout (none when it is already there), exactly as the command would record it.
 */
export function appliedFromCache(
  project: Project,
  params: RunNestingParams,
  layout: Layout,
): Pick<AppliedCommand, 'params' | 'patches' | 'inversePatches'> {
  if (JSON.stringify(layout) === JSON.stringify(project.layout)) {
    return { params, patches: [], inversePatches: [] };
  }
  return {
    params,
    patches: [{ op: 'replace', path: ['layout'], value: layout }],
    inversePatches: [{ op: 'replace', path: ['layout'], value: project.layout }],
  };
}
