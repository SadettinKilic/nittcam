/**
 * From a converted drawing to `importDxf` params (T145): join → recognise → plain vertex arrays.
 * Circles on a `drill` layer can become hole objects. Pure.
 */
import type { Vertex } from '../geometry/types';
import type { Hole, ThroughHole } from '../schema';
import { joinPaths, type DxfJoinResult } from './join';
import type { DxfLayerMap } from './layers';
import { recognizeParts, type DxfRecognition } from './recognize';
import type { DxfDrawing } from './types';

export interface DxfPlan extends DxfRecognition {
  /** Pieces dropped as exact duplicates. */
  duplicates: number;
}

/** Joins and recognises a converted drawing under a layer mapping. */
export function planDxfImport(drawing: DxfDrawing, map: Readonly<DxfLayerMap> = {}): DxfPlan {
  const joined: DxfJoinResult = joinPaths(drawing.paths);
  return { ...recognizeParts(joined, map), duplicates: joined.duplicates };
}

const copy = (vs: readonly Vertex[]): Vertex[] =>
  vs.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge }));

/** One `importDxf` part entry (drawing millimetres). */
export interface DxfImportPart {
  id: string;
  name: string;
  outline: Vertex[];
  inners: Vertex[][];
  holes: Hole[];
}

/**
 * `importDxf` part entries for a plan; ids and names come from the caller (UI). With
 * `holeTool` (tool number), circles on a `drill` layer become through holes (spec §4.6
 * "Daireler delik nesnesine çevrilebilir"); without it, or for any other circle, they stay inner
 * contours.
 */
export function dxfImportParts(
  plan: Pick<DxfPlan, 'parts'>,
  idFor: (index: number) => string,
  nameFor: (index: number) => string,
  holeTool?: number,
): DxfImportPart[] {
  return plan.parts.map((p, i) => {
    const inners: Vertex[][] = [];
    const holes: Hole[] = [];
    for (const inner of p.inners) {
      if (holeTool !== undefined && inner.drill && inner.circle) {
        holes.push(dxfCircleToHole(inner.circle, `h${holes.length + 1}`, holeTool));
      } else {
        inners.push(copy(inner.poly.vertices));
      }
    }
    return { id: idFor(i), name: nameFor(i), outline: copy(p.outline.vertices), inners, holes };
  });
}

/**
 * A DXF circle as a through hole, centre in drawing mm (`importDxf` makes it part-local). The
 * one place that decides how a circle becomes a hole object.
 */
export function dxfCircleToHole(
  circle: { cx: number; cy: number; d: number },
  id: string,
  tool: number,
): ThroughHole {
  return { type: 'through', id, d: circle.d, cx: circle.cx, cy: circle.cy, tool };
}
