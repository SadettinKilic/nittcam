/**
 * DXF import dialog model (T146, spec §4.6): file checks, report rows, the SVG preview and the
 * `importDxf` params. Pure helpers; the dialog keeps the file text and choices as UI state.
 */
import {
  detectDxfFormat,
  dxfImportParts,
  planDxfImport,
  readDxf,
  type BBox,
  type DxfDrawing,
  type DxfLayerMap,
  type DxfLayerOp,
  type DxfPlan,
  type DxfUnit,
  type Polyline,
} from '@nittcam/core';

/** Largest DXF accepted (the file is parsed in the browser). */
export const MAX_DXF_BYTES = 10 * 1024 * 1024;

export type DxfFileProblem = 'dwg' | 'binary' | 'type' | 'size' | 'empty' | 'parse';

/**
 * Checks a chosen file before parsing: DWG (by name or by its first bytes), wrong type, too big.
 * `head` = the first bytes decoded as text.
 */
export function checkDxfFile(name: string, size: number, head: string): DxfFileProblem | null {
  const lower = name.toLowerCase();
  const format = detectDxfFormat(head);
  if (lower.endsWith('.dwg') || format === 'dwg') return 'dwg';
  if (!lower.endsWith('.dxf')) return 'type';
  if (size > MAX_DXF_BYTES) return 'size';
  if (size === 0) return 'empty';
  if (format === 'binary-dxf') return 'binary';
  return null;
}

export type DxfLoad = { ok: true; drawing: DxfDrawing } | { ok: false; problem: DxfFileProblem };

/** Parses the text with an optional unit chosen by the user. */
export function loadDxf(text: string, unit?: DxfUnit): DxfLoad {
  const r = readDxf(text, unit ? { unit } : {});
  if (r.ok) return { ok: true, drawing: r.value };
  const problem: DxfFileProblem =
    r.error === 'DWG'
      ? 'dwg'
      : r.error === 'BINARY_DXF'
        ? 'binary'
        : r.error === 'EMPTY'
          ? 'empty'
          : 'parse';
  return { ok: false, problem };
}

const sum = (rec: Record<string, number>) => Object.values(rec).reduce((s, n) => s + n, 0);

/** Counts for the report (spec §4.6: supported / converted / ignored, open contours). */
export interface DxfReportSummary {
  supported: number;
  converted: number;
  ignored: number;
  /** "TEXT 3, HATCH 1" style detail of the ignored entities, by type. */
  ignoredTypes: [string, number][];
  skipped: number;
  open: number;
  duplicates: number;
  parts: number;
  inners: number;
  pending: number;
  orphans: number;
}

export function summarize(drawing: DxfDrawing, plan: DxfPlan): DxfReportSummary {
  const r = drawing.report;
  return {
    supported: sum(r.supported),
    converted: sum(r.converted),
    ignored: sum(r.ignored),
    ignoredTypes: Object.entries(r.ignored).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    skipped: sum(r.skipped as Record<string, number>),
    open: plan.open.length,
    duplicates: plan.duplicates,
    parts: plan.parts.length,
    inners: plan.parts.reduce((s, p) => s + p.inners.length, 0),
    pending: plan.pending.length,
    orphans: plan.orphans.length,
  };
}

/** Pieces per layer (for the mapping table), in the drawing's layer order. */
export function layerCounts(drawing: DxfDrawing): { layer: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of drawing.paths) counts.set(p.layer, (counts.get(p.layer) ?? 0) + 1);
  return drawing.layers.map((layer) => ({ layer, count: counts.get(layer) ?? 0 }));
}

/** The mapping the dialog applies: stored company mapping overridden by this import's choices. */
export function effectiveMap(
  stored: Readonly<DxfLayerMap>,
  chosen: Readonly<Record<string, DxfLayerOp>>,
): DxfLayerMap {
  const out: DxfLayerMap = { ...stored };
  for (const [layer, op] of Object.entries(chosen)) out[layer.trim().toUpperCase()] = op;
  return out;
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * SVG path data of a bulge polyline with Y flipped (SVG y grows downwards). Arcs stay arcs:
 * a CCW arc (bulge > 0) is drawn with sweep-flag 0 after the flip.
 */
export function svgPath(poly: Polyline): string {
  const vs = poly.vertices;
  const first = vs[0];
  if (!first) return '';
  let d = `M${n(first.x)} ${n(-first.y)}`;
  const count = poly.closed ? vs.length : vs.length - 1;
  for (let i = 0; i < count; i++) {
    const a = vs[i] ?? first;
    const b = vs[(i + 1) % vs.length] ?? first;
    if (a.bulge === 0) {
      d += `L${n(b.x)} ${n(-b.y)}`;
      continue;
    }
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const r = (chord * (1 + a.bulge * a.bulge)) / (4 * Math.abs(a.bulge));
    const large = Math.abs(a.bulge) > 1 ? 1 : 0;
    const sweep = a.bulge > 0 ? 0 : 1;
    d += `A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(b.x)} ${n(-b.y)}`;
  }
  return poly.closed ? `${d}Z` : d;
}

/** SVG viewBox for a bounding box (Y flipped) with a margin of 3 % of the larger side. */
export function viewBox(box: BBox | undefined): string {
  if (!box) return '0 0 100 100';
  const w = Math.max(box.maxX - box.minX, 1);
  const h = Math.max(box.maxY - box.minY, 1);
  const m = Math.max(w, h) * 0.03;
  return `${n(box.minX - m)} ${n(-box.maxY - m)} ${n(w + 2 * m)} ${n(h + 2 * m)}`;
}

/** Plans the import and builds the `importDxf` params (ids from `newId`, names "<file> 1", ...). */
export function importParams(
  drawing: DxfDrawing,
  map: Readonly<DxfLayerMap>,
  baseName: string,
  newId: () => string,
  holeTool?: number,
): { plan: DxfPlan; parts: ReturnType<typeof dxfImportParts> } {
  const plan = planDxfImport(drawing, map);
  const parts = dxfImportParts(
    plan,
    () => newId(),
    (i) => (plan.parts.length === 1 ? baseName : `${baseName} ${i + 1}`),
    holeTool,
  );
  return { plan, parts };
}

/** File name without the extension, for part names. */
export function baseName(fileName: string): string {
  const name = fileName.replace(/\.[^.]*$/, '').trim();
  return name || 'DXF';
}
