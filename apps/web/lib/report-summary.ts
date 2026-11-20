/**
 * Project report summary (T177, spec §6.6 "Rapor: fire yüzdesi ve alanı, plaka sayısı, tahmini
 * kesim süresi, parça listesi"): the numbers of the PDF waste report, as data for the project page
 * card and the home page. Formatting is shared with the PDF so both show the same text.
 */
import type { ProjectReport } from '@nittcam/core';
import { fill } from './draft-project';
import { getMessages } from './messages';

const t = getMessages().pdf;

/** GET /api/projects/:id/report?revision=n */
export interface ReportSummary {
  revision: number;
  sheetCount: number;
  wastePercent: number;
  wasteAreaM2: number;
  partAreaM2: number;
  sheetAreaM2: number;
  /** All pieces of the cut list (sum of quantities). */
  totalPieces: number;
  /** Pieces the layout could not place. */
  unplaced: number;
  /** Simulated cut time of the program the export would produce; null when no program passes. */
  cutSeconds: number | null;
}

/** The summary fields of a report (the same object the PDF draws its tiles from). */
export function summaryOf(report: ProjectReport, revision: number): ReportSummary {
  return {
    revision,
    sheetCount: report.sheetCount,
    wastePercent: report.wastePercent,
    wasteAreaM2: report.wasteAreaM2,
    partAreaM2: report.partAreaM2,
    sheetAreaM2: report.sheetAreaM2,
    totalPieces: report.totalPieces,
    unplaced: report.unplaced,
    cutSeconds: report.cutSeconds,
  };
}

const pctFormat = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const areaFormat = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatPercent = (v: number): string => fill(t.percent, { value: pctFormat.format(v) });
export const formatArea = (m2: number): string => fill(t.area, { value: areaFormat.format(m2) });
/** One decimal, Turkish style ("12,3"), as in the per-size notes. */
export const formatPercentNumber = (v: number): string => pctFormat.format(v);

/** "1 sa 5 dk" / "12 dk" (minutes rounded up), or the "not available" text. */
export function formatCutTime(seconds: number | null): string {
  if (seconds === null) return t.cutTimeNone;
  const total = Math.max(1, Math.ceil(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? fill(t.minutes, { h, m }) : fill(t.minutesOnly, { m });
}

/** The six tiles in PDF order: label and value text. */
export function summaryTiles(s: Pick<
  ReportSummary,
  'sheetCount' | 'wastePercent' | 'wasteAreaM2' | 'partAreaM2' | 'totalPieces' | 'cutSeconds'
>): { key: string; label: string; value: string }[] {
  return [
    { key: 'sheets', label: t.sheets, value: String(s.sheetCount) },
    { key: 'waste', label: t.waste, value: formatPercent(s.wastePercent) },
    { key: 'wasteArea', label: t.wasteArea, value: formatArea(s.wasteAreaM2) },
    { key: 'partArea', label: t.partArea, value: formatArea(s.partAreaM2) },
    { key: 'pieces', label: t.pieces, value: String(s.totalPieces) },
    { key: 'cutTime', label: t.cutTime, value: formatCutTime(s.cutSeconds) },
  ];
}
