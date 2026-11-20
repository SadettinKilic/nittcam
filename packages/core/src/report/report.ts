/**
 * Project report (T173, spec §6.6 "Rapor", §4.8): the numbered part list with finished and cut
 * sizes and banded edges, the waste report and the sheet count. Pure; the estimated cut time comes
 * from the caller (the server runs the simulation of the exported program).
 */
import { normalizeGrain } from '../geometry/grain';
import { partShape } from '../nesting/fit';
import { summarizeLayout } from '../nesting/nest';
import { cutSize } from '../schema/cut-size';
import type { EdgeBand, Part, Project } from '../schema/project';

export const BAND_EDGES = ['top', 'right', 'bottom', 'left'] as const;
export type BandEdge = (typeof BAND_EDGES)[number];

/** One cut-list row of the part list. */
export interface ReportPartRow {
  /** Cut-list row number from 1 (copies are numbered `row.1` … `row.qty`). */
  row: number;
  partId: string;
  name: string;
  qty: number;
  /** Copies on the layout. */
  placed: number;
  kind: Part['kind'];
  /**
   * Finished size (with edge bands), mm. `finished` mode: the entered size. `cut` mode: the cut size
   * plus the band on each banded edge. A freeform part: its bounding box (bands are not added).
   */
  finished: { w: number; h: number };
  /** Cut size, mm (bounding box for a freeform part). */
  cut: { w: number; h: number };
  /** Part-frame grain angle, degrees [0, 180); null = free grain. */
  grain: number | null;
  /** Band thickness per edge, mm (0 = no band). */
  band: EdgeBand;
  /** Banded edges in the order top, right, bottom, left. */
  bandedEdges: BandEdge[];
  note?: string;
  group?: string;
}

export interface ReportSizeRow {
  width: number;
  height: number;
  sheets: number;
  wastePercent: number;
}

export interface ProjectReport {
  /** How entered sizes are read (§4.8). */
  dimensionMode: Project['settings']['dimensionMode'];
  parts: ReportPartRow[];
  /** Sum of `qty`. */
  totalPieces: number;
  /** Copies with no placement on the layout. */
  unplaced: number;
  sheetCount: number;
  /** Footprint area of the placed parts, m² (as the Dizilim step counts it). */
  partAreaM2: number;
  sheetAreaM2: number;
  wasteAreaM2: number;
  wastePercent: number;
  bySize: ReportSizeRow[];
  /** Estimated machining time of all sheet programs, s; null = not available (no passing program). */
  cutSeconds: number | null;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const M2 = 1e6;

function sizes(part: Part, mode: Project['settings']['dimensionMode']) {
  if (part.kind !== 'rect') {
    const box = partShape(part);
    const s = { w: round3(box.w), h: round3(box.h) };
    return { finished: s, cut: s };
  }
  const cut = cutSize(part.params, part.edgeBand, mode);
  const b = part.edgeBand;
  const finished =
    mode === 'finished'
      ? { w: part.params.w, h: part.params.h }
      : { w: round3(cut.w + b.left + b.right), h: round3(cut.h + b.top + b.bottom) };
  return { finished, cut: { w: round3(cut.w), h: round3(cut.h) } };
}

/** The report of a project's saved layout. */
export function projectReport(project: Project, cutSeconds: number | null = null): ProjectReport {
  const mode = project.settings.dimensionMode;
  const summary = summarizeLayout(project);
  const placed = new Map<string, number>();
  for (const sheet of project.layout.sheets) {
    for (const pl of sheet.placements) placed.set(pl.partId, (placed.get(pl.partId) ?? 0) + 1);
  }
  const parts = project.parts.map((part, i): ReportPartRow => {
    const { finished, cut } = sizes(part, mode);
    return {
      row: i + 1,
      partId: part.id,
      name: part.name,
      qty: part.qty,
      placed: placed.get(part.id) ?? 0,
      kind: part.kind,
      finished,
      cut,
      grain: part.grain.mode === 'fixed' ? normalizeGrain(part.grain.angle) : null,
      band: { ...part.edgeBand },
      bandedEdges: BAND_EDGES.filter((e) => part.edgeBand[e] > 0),
      ...(part.note ? { note: part.note } : {}),
      ...(part.group ? { group: part.group } : {}),
    };
  });
  return {
    dimensionMode: mode,
    parts,
    totalPieces: parts.reduce((s, p) => s + p.qty, 0),
    unplaced: summary.unplaced.length,
    sheetCount: summary.sheetCount,
    partAreaM2: summary.partArea / M2,
    sheetAreaM2: summary.sheetArea / M2,
    wasteAreaM2: (summary.sheetArea - summary.partArea) / M2,
    wastePercent: summary.wastePercent,
    bySize: summary.bySize.map((s) => ({
      width: s.width,
      height: s.height,
      sheets: s.sheets,
      wastePercent: s.wastePercent,
    })),
    cutSeconds,
  };
}
