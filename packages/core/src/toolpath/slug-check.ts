import { bbox } from '../geometry/polyline';
import type { MachineProfile } from '../machine';
import type { Project } from '../schema';
import { defaultSheet } from '../schema';
import { buildToolpath, placedOutline } from './build';

/** A cut-out whose slug has no room for the 2 tabs that hold it (D-049). */
export interface UnsecuredSlug {
  partId: string;
  /** Index of the part in `project.parts`. */
  part: number;
  /** Index of the inner contour in `part.inners`. */
  inner: number;
}

/** Room around the part on the check's own sheet (mm). */
const ROOM = 50;

/**
 * T270 (D-045, D-049): the cut-outs whose slug the toolpath would refuse with
 * `SMALL_SLUG_UNSECURED`, found before nesting. Each part with inner contours is run through the
 * same `buildToolpath` alone (one copy, unrotated, on a sheet with room around it), so the rule,
 * thresholds and tab placement are exactly the export's. Tabs on a cut-out depend only on the
 * cut-out, the tool and the cutting settings (no leads inside an opening), not on where the part
 * lies. Without cutting parameters nothing is reported (that has its own error). Pure.
 */
export function unsecuredSlugs(project: Project, machine: MachineProfile): UnsecuredSlug[] {
  const out: UnsecuredSlug[] = [];
  const margin = project.nesting.margin;
  project.parts.forEach((part, i) => {
    if (part.inners.length === 0) return;
    const box = bbox(placedOutline(part, { x: 0, y: 0, rot: 0 }));
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    const sheet = {
      ...defaultSheet(project),
      width: Math.max(defaultSheet(project).width, w + 2 * (margin + ROOM)),
      height: Math.max(defaultSheet(project).height, h + 2 * (margin + ROOM)),
    };
    const alone: Project = {
      ...project,
      stock: { ...project.stock, sheet },
      parts: [{ ...part, qty: 1 }],
      layout: {
        sheets: [
          {
            placements: [
              {
                partId: part.id,
                index: 0,
                x: margin + ROOM,
                y: margin + ROOM,
                rot: 0,
                locked: false,
              },
            ],
          },
        ],
      },
    };
    const res = buildToolpath(alone, machine);
    const seen = new Set<number>();
    for (const e of res.errors) {
      if (e.code !== 'SMALL_SLUG_UNSECURED' || e.inner === undefined || seen.has(e.inner)) continue;
      seen.add(e.inner);
      out.push({ partId: part.id, part: i, inner: e.inner });
    }
  });
  return out.sort((a, b) => a.part - b.part || a.inner - b.inner);
}
