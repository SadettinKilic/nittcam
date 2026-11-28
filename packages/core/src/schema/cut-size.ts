/**
 * Edge-band deduction (spec §4.8, T169). With `settings.dimensionMode === 'finished'` the entered
 * size of a rectangle part is its finished size: the cut size is the finished size minus the band
 * thickness on each banded edge. Nesting, toolpath, validation, the G-code check and every
 * placed-part view read the cut sizes through `toCutSizes(project)`; the grid shows both.
 *
 * Only `rect` parts are deducted (their `params` are entered sizes). A `freeform` outline is drawn
 * geometry and stays as drawn. Features (holes, inner contours, open lines, dimensions) are
 * measured from the finished edge, so they move by the left and bottom band thickness to stay at
 * the same place on the finished part.
 */
import { materialKindOf } from '../machine/material';
import { traitsOf } from '../machine/material-traits';
import { machinedProject } from './machined-face';
import type { DimensionMode, Part, Project, RectParams, Vertex } from './project';

/** Smallest cut side kept when bands are as thick as the part (mm); never zero or negative. */
export const MIN_CUT_SIZE = 1;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Cut size (w, h) of a rectangle part in a dimension mode. */
export function cutSize(
  params: Pick<RectParams, 'w' | 'h'>,
  band: Part['edgeBand'],
  mode: DimensionMode,
): { w: number; h: number } {
  if (mode !== 'finished') return { w: params.w, h: params.h };
  return {
    w: Math.max(MIN_CUT_SIZE, params.w - band.left - band.right),
    h: Math.max(MIN_CUT_SIZE, params.h - band.top - band.bottom),
  };
}

/**
 * Finished size (with the bands) of a rectangle entered as `params` in a dimension mode: in
 * `finished` mode the entered size, in `cut` mode the cut size plus the band on each edge.
 */
export function finishedSize(
  params: Pick<RectParams, 'w' | 'h'>,
  band: Part['edgeBand'],
  mode: DimensionMode,
): { w: number; h: number } {
  if (mode === 'finished') return { w: params.w, h: params.h };
  return {
    w: round3(params.w + band.left + band.right),
    h: round3(params.h + band.top + band.bottom),
  };
}

/**
 * The size to enter for a part whose finished size is known (T316, D-105): in `finished` mode the
 * finished size itself, in `cut` mode the finished size minus the band on each edge (what
 * `cutSize` gives in `finished` mode). Generators (Dolap ekle) produce finished sizes and enter
 * them through this, so the part comes out the same in both modes.
 */
export function enteredSize(
  finished: Pick<RectParams, 'w' | 'h'>,
  band: Part['edgeBand'],
  mode: DimensionMode,
): { w: number; h: number } {
  if (mode === 'finished') return { w: finished.w, h: finished.h };
  const c = cutSize(finished, band, 'finished');
  return { w: round3(c.w), h: round3(c.h) };
}

/** True when the part is cut smaller than entered (finished mode and at least one banded edge). */
export function hasBandDeduction(part: Part, mode: DimensionMode): boolean {
  if (mode !== 'finished' || part.kind !== 'rect') return false;
  const b = part.edgeBand;
  return b.top > 0 || b.right > 0 || b.bottom > 0 || b.left > 0;
}

const shiftVs = (vs: readonly Vertex[], dx: number, dy: number): Vertex[] =>
  vs.map((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));

/** The part as it is cut. Returns the same object when nothing is deducted. */
export function cutPart(part: Part, mode: DimensionMode): Part {
  if (part.kind !== 'rect' || !hasBandDeduction(part, mode)) return part;
  const { w, h } = cutSize(part.params, part.edgeBand, mode);
  const dx = part.edgeBand.left;
  const dy = part.edgeBand.bottom;
  // The cached outline is ignored as a source (deriveOutline); a stale copy is dropped.
  const rest = { ...part };
  delete rest.outline;
  return {
    ...rest,
    params: { w, h, r: Math.min(part.params.r, Math.min(w, h) / 2) },
    holes: part.holes.map((hole) => ({ ...hole, cx: hole.cx - dx, cy: hole.cy - dy })),
    inners: part.inners.map((c) => shiftVs(c, dx, dy)),
    ...(part.lines
      ? { lines: part.lines.map((l) => ({ ...l, vertices: shiftVs(l.vertices, dx, dy) })) }
      : {}),
    ...(part.dims
      ? {
          dims: part.dims.map((d) => ({
            ...d,
            a: { x: d.a.x - dx, y: d.a.y - dy },
            b: { x: d.b.x - dx, y: d.b.y - dy },
          })),
        }
      : {}),
  };
}

/**
 * The project as it is cut: rectangle parts at their cut size (see `cutPart`) and, on a stock
 * machined from its back (T348), every part mirrored (`machinedProject`). Returns the same object
 * when nothing changes, so `cut` mode, unbanded and front-face projects are untouched.
 */
export function toCutSizes(project: Project): Project {
  return machinedProject(toFrontCutSizes(project));
}

/**
 * Cut sizes in the front view (no back-face mirror). The G-code check builds its own mirrored
 * expectation from this (T348), independent of `machinedProject`.
 */
export function toFrontCutSizes(project: Project): Project {
  // Partial projects (tests, older callers) may lack settings: absent = "cut".
  const mode = effectiveDimensionMode(project);
  if (mode !== 'finished' || !project.parts.some((p) => hasBandDeduction(p, mode))) return project;
  return { ...project, parts: project.parts.map((p) => cutPart(p, mode)) };
}

/**
 * T349 (§4.8, analysis §5.2): the dimension mode that applies to the stock. A kind without edge
 * band (`traits.edgeBand`, ACM and aluminium) reads every size as a cut size: the stored mode and
 * band values are kept (switching back restores them exactly) but ignored. Partial projects
 * (tests, older callers) may lack settings or stock: absent = "cut" / today's behaviour.
 */
export function effectiveDimensionMode(
  project: Pick<Project, 'settings' | 'stock'>,
): DimensionMode {
  const settings = project.settings as Project['settings'] | undefined;
  const mode = settings?.dimensionMode ?? 'cut';
  const material = (project.stock as Project['stock'] | undefined)?.material;
  if (mode === 'finished' && material !== undefined && !traitsOf(materialKindOf(material)).edgeBand)
    return 'cut';
  return mode;
}

/** T349: whether the stock's kind ignores edge band values the parts carry (`EDGE_BAND_IGNORED`). */
export function edgeBandIgnored(project: Pick<Project, 'parts' | 'stock'>): boolean {
  const material = (project.stock as Project['stock'] | undefined)?.material;
  if (material === undefined || traitsOf(materialKindOf(material)).edgeBand) return false;
  return project.parts.some(
    (p) =>
      p.edgeBand.top > 0 || p.edgeBand.right > 0 || p.edgeBand.bottom > 0 || p.edgeBand.left > 0,
  );
}
