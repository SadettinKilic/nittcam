/**
 * Project report summary on the server (T177, spec §6.6): the same `projectReport` and cut-time
 * estimate the PDF report uses, so the card and the PDF always show the same values. Also the data
 * source for the home page (T180).
 */
import { projectReport } from '@nittcam/core';
import type { CompanyScope, ProjectRow } from '@nittcam/db';
import { summaryOf, type ReportSummary } from '../report-summary';
import { estimateCutSeconds } from './pdf/cut-time';

export async function reportSummary(
  scope: CompanyScope,
  project: ProjectRow,
): Promise<ReportSummary> {
  const cutSeconds = await estimateCutSeconds(scope, project);
  return summaryOf(projectReport(project.data, cutSeconds), project.revision);
}
