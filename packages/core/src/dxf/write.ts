/**
 * DXF writer (T175, spec §6.6, §4.6): our own writer, no library. Writes the layout (sheets side
 * by side) or the single parts (each part once, unrotated) as an R12 (AC1009) DXF in millimetres.
 * Contours are POLYLINE entities with bulges, so arcs stay exact arcs; holes are CIRCLE entities.
 * One layer per operation (DIS_KESIM, IC_KESIM, CEP, DELIK, CIZGI) plus PLAKA for the sheet frames.
 * Pure: same project, same text (fixed number format, project order, no clock).
 */
import { bbox, contour, normalize } from '../geometry/polyline';
import type { Polyline } from '../geometry/types';
import type { Hole, Part, Project } from '../schema';
import { innerOperation, outlineOperation } from '../schema/operations';
import { deriveOutline } from '../schema/outline';
import { sheetSizeOf } from '../schema/sheet-size';
import { placedHoleCentre } from '../toolpath/holes';
import { placedInners, placedLines, placedOutline } from '../toolpath/build';
import type { DxfLayerMap } from './layers';

/** Export layers (spec §6.6 "katmanlar işlem türüne göre"). */
export const DXF_EXPORT_LAYERS = {
  /** Outline, through cut outside the line. */
  outside: 'DIS_KESIM',
  /** Inner contour, through cut inside the line. */
  inside: 'IC_KESIM',
  /**
   * Blind holes: pocket and ring groove (circle = pocket diameter / groove centreline), and blind
   * contour pockets (T325, the pocket's closed contour).
   */
  pocket: 'CEP',
  /** Through holes. */
  drill: 'DELIK',
  /** On-line contours and open lines (engraving). */
  online: 'CIZGI',
  /** Sheet frames in the layout file (not cut). */
  sheet: 'PLAKA',
} as const;

/** ACI colours per layer (fixed, so viewers show the operations apart). */
const LAYER_COLOURS: Readonly<Record<string, number>> = {
  DIS_KESIM: 7,
  IC_KESIM: 5,
  CEP: 3,
  DELIK: 1,
  CIZGI: 6,
  PLAKA: 8,
};

/**
 * The import layer mapping that reads our own export back (round trip): the cut layers become the
 * same operations, the sheet frame is ignored.
 */
export const DXF_EXPORT_LAYER_MAP: DxfLayerMap = {
  DIS_KESIM: 'outside',
  IC_KESIM: 'inside',
  CEP: 'pocket',
  DELIK: 'drill',
  CIZGI: 'online',
  PLAKA: 'ignore',
};

/** Gap between sheets in the layout file and between parts in the parts file, mm. */
export const DXF_EXPORT_GAP = 100;
/** Row width at which the parts file starts a new row, mm (a wider part gets a row of its own). */
export const DXF_PARTS_ROW_WIDTH = 3000;

/** One entity to write, already in the file frame (mm). */
export type DxfEntity =
  | { type: 'polyline'; layer: string; poly: Polyline }
  | { type: 'circle'; layer: string; cx: number; cy: number; r: number };

/** Fixed number format: at most 6 decimals, no exponent, no "-0". */
export function dxfNumber(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`DXF number is not finite: ${v}`);
  const s = (Math.round(v * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

function holeLayer(h: Hole): string {
  return h.type === 'through' ? DXF_EXPORT_LAYERS.drill : DXF_EXPORT_LAYERS.pocket;
}

function shift(poly: Polyline, dx: number, dy: number): Polyline {
  return {
    closed: poly.closed,
    vertices: poly.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy, bulge: v.bulge })),
  };
}

/** The entities of one placed part (sheet frame), shifted by (dx, dy). Layers per operation. */
export function partEntities(
  part: Part,
  placement: { x: number; y: number; rot: number },
  dx = 0,
  dy = 0,
): DxfEntity[] {
  const out: DxfEntity[] = [];
  const opLayer = (kind: string, cut: string): string | undefined =>
    kind === 'none'
      ? undefined
      : kind === 'online'
        ? DXF_EXPORT_LAYERS.online
        : // T325: a blind contour pocket goes on the pocket layer, never on a through-cut layer.
          kind === 'pocket'
          ? DXF_EXPORT_LAYERS.pocket
          : cut;
  const outlineLayer = opLayer(outlineOperation(part).kind, DXF_EXPORT_LAYERS.outside);
  if (outlineLayer) {
    out.push({
      type: 'polyline',
      layer: outlineLayer,
      poly: shift(placedOutline(part, placement), dx, dy),
    });
  }
  placedInners(part, placement).forEach((poly, k) => {
    const layer = opLayer(innerOperation(part, k).kind, DXF_EXPORT_LAYERS.inside);
    if (layer) out.push({ type: 'polyline', layer, poly: shift(poly, dx, dy) });
  });
  for (const h of part.holes) {
    const c = placedHoleCentre(part, placement, h);
    out.push({ type: 'circle', layer: holeLayer(h), cx: c.x + dx, cy: c.y + dy, r: h.d / 2 });
  }
  for (const l of placedLines(part, placement)) {
    if (l.op.kind === 'none') continue;
    out.push({ type: 'polyline', layer: DXF_EXPORT_LAYERS.online, poly: shift(l.poly, dx, dy) });
  }
  return out;
}

function rect(layer: string, x: number, y: number, w: number, h: number): DxfEntity {
  return {
    type: 'polyline',
    layer,
    poly: {
      closed: true,
      vertices: [
        { x, y, bulge: 0 },
        { x: x + w, y, bulge: 0 },
        { x: x + w, y: y + h, bulge: 0 },
        { x, y: y + h, bulge: 0 },
      ],
    },
  };
}

/**
 * Layout entities: sheet i sits right of sheet i−1 with `DXF_EXPORT_GAP` between them; its frame
 * on PLAKA, its placed parts in the sheet frame. Placements of unknown parts are skipped.
 */
export function layoutEntities(project: Pick<Project, 'parts' | 'layout' | 'stock'>): DxfEntity[] {
  const byId = new Map(project.parts.map((p) => [p.id, p]));
  const out: DxfEntity[] = [];
  let x0 = 0;
  (project.layout?.sheets ?? []).forEach((sheet, i) => {
    const size = sheetSizeOf(project, i);
    out.push(rect(DXF_EXPORT_LAYERS.sheet, x0, 0, size.width, size.height));
    for (const pl of sheet.placements) {
      const part = byId.get(pl.partId);
      if (part) out.push(...partEntities(part, pl, x0, 0));
    }
    x0 += size.width + DXF_EXPORT_GAP;
  });
  return out;
}

/**
 * Single-part entities: each part once, unrotated, its bounding box from (x, y); left to right in
 * project order, a new row above when the row would pass `DXF_PARTS_ROW_WIDTH`.
 */
export function partsEntities(project: Pick<Project, 'parts'>): DxfEntity[] {
  const out: DxfEntity[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const part of project.parts) {
    const box = bbox(normalize(contour(deriveOutline(part)), 'outer'));
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (x > 0 && x + w > DXF_PARTS_ROW_WIDTH) {
      y += rowHeight + DXF_EXPORT_GAP;
      x = 0;
      rowHeight = 0;
    }
    out.push(...partEntities(part, { x, y, rot: 0 }));
    x += w + DXF_EXPORT_GAP;
    rowHeight = Math.max(rowHeight, h);
  }
  return out;
}

/** Serialises entities as an R12 DXF (mm, `$INSUNITS` 4). */
export function writeDxfEntities(entities: readonly DxfEntity[]): string {
  const lines: string[] = [];
  const g = (code: number, value: string | number): void => {
    lines.push(String(code).padStart(3, ' '), typeof value === 'number' ? dxfNumber(value) : value);
  };
  const layers = Object.values(DXF_EXPORT_LAYERS);

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, 4);
  g(9, '$MEASUREMENT');
  g(70, 1);
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 1);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  g(70, 0);
  g(3, 'Solid line');
  g(72, 65);
  g(73, 0);
  g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length + 1);
  for (const name of ['0', ...layers]) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, LAYER_COLOURS[name] ?? 7);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'BLOCKS');
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const e of entities) {
    if (e.type === 'circle') {
      g(0, 'CIRCLE');
      g(8, e.layer);
      g(10, e.cx);
      g(20, e.cy);
      g(30, 0);
      g(40, e.r);
      continue;
    }
    g(0, 'POLYLINE');
    g(8, e.layer);
    g(66, 1);
    g(10, 0);
    g(20, 0);
    g(30, 0);
    g(70, e.poly.closed ? 1 : 0);
    const n = e.poly.vertices.length;
    e.poly.vertices.forEach((v, i) => {
      g(0, 'VERTEX');
      g(8, e.layer);
      g(10, v.x);
      g(20, v.y);
      g(30, 0);
      // An open polyline's last bulge means nothing (spec §6.1); write 0 there.
      const bulge = !e.poly.closed && i === n - 1 ? 0 : v.bulge;
      if (bulge !== 0) g(42, bulge);
    });
    g(0, 'SEQEND');
    g(8, e.layer);
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return lines.join('\n') + '\n';
}

/** What to write: the layout (sheets side by side) or each part once. */
export type DxfExportKind = 'layout' | 'parts';

/** The DXF text of a project (spec §6.6). A layout export of a project without a layout is empty. */
export function writeProjectDxf(
  project: Pick<Project, 'parts' | 'layout' | 'stock'>,
  kind: DxfExportKind,
): string {
  return writeDxfEntities(kind === 'layout' ? layoutEntities(project) : partsEntities(project));
}
