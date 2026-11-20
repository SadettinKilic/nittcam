/**
 * Şablonlar page model (T151, spec §3.4 / §4.7): preview geometry, duplicate and edit drafts.
 * Pure: no React, no fetch.
 */
import { copyOffsets, type TemplateParams, type Vertex } from '@nittcam/core';
import type { TemplateDraft, TemplateItem } from './templates-api';

/** Longest template name the schema accepts. */
const NAME_MAX = 80;

export interface PreviewCircle {
  cx: number;
  cy: number;
  r: number;
}

export interface TemplatePreview {
  circles: PreviewCircle[];
  /** SVG path data of the inner contours and lines (template frame, y up). */
  paths: string[];
  /** Reference edge: the line x = `edgeX` (local +x points into the part). */
  edgeX: number;
  /** View box (template frame, y up): minX, minY, width, height. */
  box: [number, number, number, number];
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** SVG path of a vertex chain; bulges become arcs (sweep for a y-up frame). */
export function vertexPath(vs: readonly Vertex[], dy: number, closed: boolean): string {
  if (vs.length === 0) return '';
  const pts = vs.map((v) => ({ x: v.x, y: v.y + dy, b: v.bulge }));
  const first = pts[0] as (typeof pts)[number];
  let d = `M${fmt(first.x)} ${fmt(first.y)}`;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as (typeof pts)[number];
    const b = pts[(i + 1) % pts.length] as (typeof pts)[number];
    if (a.b === 0) {
      d += ` L${fmt(b.x)} ${fmt(b.y)}`;
    } else {
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const r = (chord * (1 + a.b * a.b)) / (4 * Math.abs(a.b));
      d += ` A${fmt(r)} ${fmt(r)} 0 ${Math.abs(a.b) > 1 ? 1 : 0} ${a.b > 0 ? 1 : 0} ${fmt(b.x)} ${fmt(b.y)}`;
    }
  }
  return closed ? `${d} Z` : d;
}

/**
 * What the thumbnail draws: every copy of the holes (diameter override `d.<id>` applied), inner
 * contours and lines, plus the reference edge, in the template frame, with a margin.
 */
export function templatePreview(item: Pick<TemplateItem, 'geometry' | 'params'>): TemplatePreview {
  const { geometry: g, params } = item;
  const circles: PreviewCircle[] = [];
  const paths: string[] = [];
  let minX = -params.edgeDistance;
  let maxX = -params.edgeDistance;
  let minY = Infinity;
  let maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y0);
    maxY = Math.max(maxY, y1);
  };
  for (const dy of copyOffsets(params)) {
    for (const h of g.holes) {
      const r = (params.d[h.id] ?? h.d) / 2;
      circles.push({ cx: h.cx, cy: h.cy + dy, r });
      grow(h.cx - r, h.cy + dy - r, h.cx + r, h.cy + dy + r);
    }
    for (const inner of g.inners) {
      paths.push(vertexPath(inner.contour, dy, true));
      for (const v of inner.contour) grow(v.x, v.y + dy, v.x, v.y + dy);
    }
    for (const line of g.lines ?? []) {
      paths.push(vertexPath(line.vertices, dy, false));
      for (const v of line.vertices) grow(v.x, v.y + dy, v.x, v.y + dy);
    }
  }
  if (!Number.isFinite(minY)) {
    minY = -10;
    maxY = 10;
  }
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const m = size * 0.1;
  return {
    circles,
    paths,
    edgeX: -params.edgeDistance,
    box: [minX - m, minY - m, maxX - minX + 2 * m, maxY - minY + 2 * m],
  };
}

/** A duplicate: same geometry and params, name from `copyName` ("{name} (kopya)"), max 80 chars. */
export function duplicateDraft(
  item: TemplateItem,
  copyName: (name: string) => string,
): TemplateDraft {
  let name = copyName(item.name);
  if (name.length > NAME_MAX) {
    const extra = name.length - NAME_MAX;
    name = copyName(item.name.slice(0, Math.max(1, item.name.length - extra - 1)) + '…');
  }
  return {
    name: name.slice(0, NAME_MAX),
    geometry: structuredClone(item.geometry),
    params: structuredClone(item.params),
  };
}

/** The next version's draft after editing params (and the name): geometry unchanged. */
export function editedDraft(
  item: TemplateItem,
  name: string,
  params: TemplateParams,
): TemplateDraft {
  return { name: name.trim(), geometry: structuredClone(item.geometry), params };
}

/** Did the edit change anything (a new version is saved only then)? */
export function isChanged(item: TemplateItem, name: string, params: TemplateParams): boolean {
  return name.trim() !== item.name || !sameParams(params, item.params);
}

/** Company templates first (by name), then the ready library (code order). */
export function splitTemplates(items: readonly TemplateItem[]): {
  company: TemplateItem[];
  ready: TemplateItem[];
} {
  return {
    company: items.filter((i) => !i.ready),
    ready: items.filter((i) => i.ready),
  };
}

/** Equal params regardless of key order (jsonb stores keys in its own order). */
export function sameParams(a: TemplateParams, b: TemplateParams): boolean {
  const da = Object.keys(a.d);
  return (
    a.count === b.count &&
    a.spacing === b.spacing &&
    a.edgeDistance === b.edgeDistance &&
    da.length === Object.keys(b.d).length &&
    da.every((k) => a.d[k] === b.d[k])
  );
}

/**
 * P4 (CTO #8): thumbnails of one list are drawn to the same scale. Every viewBox gets the size of
 * the largest box (`span` = the widest width and the tallest height), centred on its own box, so a
 * hinge cup looks small next to a long handle rail, as on the part.
 */
export function commonSpan(boxes: readonly (readonly number[])[]): { w: number; h: number } {
  let w = 1;
  let h = 1;
  for (const b of boxes) {
    w = Math.max(w, b[2] ?? 0);
    h = Math.max(h, b[3] ?? 0);
  }
  return { w, h };
}

/** `box` ([x, y, w, h]) widened to `span`, same centre. */
export function scaledBox(
  box: readonly [number, number, number, number],
  span: { w: number; h: number },
): [number, number, number, number] {
  const [x, y, w, h] = box;
  const W = Math.max(w, span.w);
  const H = Math.max(h, span.h);
  return [x + w / 2 - W / 2, y + h / 2 - H / 2, W, H];
}
