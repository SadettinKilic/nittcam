/**
 * From a converted drawing to `importDxf` params (T145): join → recognise → plain vertex arrays.
 * Also the small circle → hole mapping kept apart until hole objects (B14) are wired in. Pure.
 */
import type { Vertex } from '../geometry/types';
import type { ThroughHole } from '../schema';
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

const copy = (vs: readonly Vertex[]): Vertex[] => vs.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge }));

/** `importDxf` part entries for a plan; ids and names come from the caller (UI). */
export function dxfImportParts(
  plan: Pick<DxfPlan, 'parts'>,
  idFor: (index: number) => string,
  nameFor: (index: number) => string,
): { id: string; name: string; outline: Vertex[]; inners: Vertex[][] }[] {
  return plan.parts.map((p, i) => ({
    id: idFor(i),
    name: nameFor(i),
    outline: copy(p.outline.vertices),
    inners: p.inners.map((inner) => copy(inner.poly.vertices)),
  }));
}

/**
 * A DXF circle as a through hole (spec §4.6 "Daireler delik nesnesine çevrilebilir"). `origin` is
 * the part's lower-left corner in drawing mm (hole centres are part-local). Not used by the import
 * yet: hole objects and their tool choice arrive with B14; until then circles stay inner contours.
 */
export function dxfCircleToHole(
  circle: { cx: number; cy: number; d: number },
  origin: { x: number; y: number },
  id: string,
  tool: number,
): ThroughHole {
  return { type: 'through', id, d: circle.d, cx: circle.cx - origin.x, cy: circle.cy - origin.y, tool };
}
