/**
 * Placing a template on a part (T148, spec §4.7 "hayalet önizleme gelir, kenar ve köşelere
 * yapışır"): the pending placement while the ghost follows the cursor, edge / corner snapping and
 * the ghost geometry. UI state only; the placement becomes one `addTemplate` command.
 */
import {
  defaultTemplateEdge,
  deriveTemplate,
  EDGE_ROTATION,
  type BBox,
  type TemplateEdge,
  type TemplateGeometry,
  type TemplateParams,
  type TemplatePlacement,
  type Vertex,
} from '@nittcam/core';
import type { Pt } from './viewport';

/** A template being placed on a part (before "Yerleştir"). */
export interface PendingTemplate {
  partId: string;
  templateId: string;
  version: number;
  name: string;
  geometry: TemplateGeometry;
  defaults: TemplateParams;
  params: TemplateParams;
  placement: TemplatePlacement;
}

/** Distance from a point (part frame) to each edge of the part box. */
function edgeDistances(p: Pt, b: BBox): Record<TemplateEdge, number> {
  return {
    left: Math.abs(p.x - b.minX),
    right: Math.abs(b.maxX - p.x),
    bottom: Math.abs(p.y - b.minY),
    top: Math.abs(b.maxY - p.y),
  };
}

/** Along-edge coordinate of `p` on `edge` (y for left/right, x for bottom/top). */
const alongOf = (edge: TemplateEdge, p: Pt) => (edge === 'left' || edge === 'right' ? p.y : p.x);

/**
 * The placement for a cursor at `p` (part frame): within `tol` mm of an edge the template anchors
 * to the nearest edge (rotation from the edge, mirror kept); near a corner the along-edge
 * coordinate also snaps to the corner plus the edge distance. Elsewhere it follows the cursor
 * freely with the current rotation.
 */
export function snapPlacement(
  p: Pt,
  box: BBox,
  current: TemplatePlacement,
  edgeDistance: number,
  tol: number,
): TemplatePlacement {
  const d = edgeDistances(p, box);
  const inside = p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
  const edges = (Object.keys(d) as TemplateEdge[]).sort((a, b) => d[a] - d[b]);
  const edge = edges[0] as TemplateEdge;
  if (!inside || d[edge] > tol) {
    return { ...current, x: p.x, y: p.y, edge: null };
  }
  let along = alongOf(edge, p);
  // Corner: the nearest edge across this one is within tolerance too.
  const across = edges.find(
    (e) => (e === 'left' || e === 'right') !== (edge === 'left' || edge === 'right'),
  ) as TemplateEdge;
  if (d[across] <= tol) {
    if (across === 'left') along = box.minX + edgeDistance;
    else if (across === 'right') along = box.maxX - edgeDistance;
    else if (across === 'bottom') along = box.minY + edgeDistance;
    else along = box.maxY - edgeDistance;
  }
  const horizontalEdge = edge === 'bottom' || edge === 'top';
  return {
    x: horizontalEdge ? along : p.x,
    y: horizontalEdge ? p.y : along,
    rot: EDGE_ROTATION[edge],
    mirror: current.mirror,
    edge,
  };
}

/** The along-edge coordinate of a placement (what the "Kenar boyunca" field edits). */
export function placementAlong(pl: TemplatePlacement): number {
  return pl.edge === 'bottom' || pl.edge === 'top' ? pl.x : pl.y;
}

/** Ghost geometry in board mm (part origin at `at`). */
export interface TemplateGhost {
  circles: { x: number; y: number; r: number }[];
  contours: Vertex[][];
  lines: Vertex[][];
}

export function templateGhost(pending: PendingTemplate, box: BBox, at: Pt): TemplateGhost {
  const d = deriveTemplate({ instanceId: 'ghost', ...pending }, box);
  const shift = (vs: readonly Vertex[]) =>
    vs.map((v) => ({ x: v.x + at.x, y: v.y + at.y, bulge: v.bulge }));
  return {
    circles: d.holes.map((h) => ({ x: h.cx + at.x, y: h.cy + at.y, r: h.d / 2 })),
    contours: d.inners.map((i) => shift(i.contour)),
    lines: d.lines.map((l) => shift(l.vertices)),
  };
}

/**
 * A new pending placement, centred along its default edge: the left edge, or for a handle the edge
 * opposite the part's hinges (T286; `templates` = the part's instances).
 */
export function startPlacement(
  partId: string,
  item: {
    id: string;
    name: string;
    version: number;
    geometry: TemplateGeometry;
    params: TemplateParams;
  },
  box: BBox,
  templates: Parameters<typeof defaultTemplateEdge>[1] = [],
): PendingTemplate {
  const edge = defaultTemplateEdge(item.id, templates);
  const e = item.params.edgeDistance;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const at = {
    left: { x: box.minX + e, y: cy },
    right: { x: box.maxX - e, y: cy },
    bottom: { x: cx, y: box.minY + e },
    top: { x: cx, y: box.maxY - e },
  }[edge];
  return {
    partId,
    templateId: item.id,
    version: item.version,
    name: item.name,
    geometry: item.geometry,
    defaults: item.params,
    params: item.params,
    placement: { ...at, rot: EDGE_ROTATION[edge], mirror: false, edge },
  };
}

/** The `addTemplate` params of a pending placement. */
export function addTemplateParams(p: PendingTemplate) {
  return {
    id: p.partId,
    template: {
      templateId: p.templateId,
      version: p.version,
      name: p.name,
      geometry: p.geometry,
      defaults: p.defaults,
      params: p.params,
      placement: p.placement,
    },
  };
}
