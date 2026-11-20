/**
 * Estimated cut time of the PDF report (T173, spec §6.6 "tahmini kesim süresi"): the simulation
 * time of the program the export would produce for the saved revision with the profile version the
 * project is bound to. Null when no program passes (no machine, unknown post, failed checks).
 */
import { simulateProject, validateProject } from '@nittcam/core';
import type { CompanyScope, ProjectRow } from '@nittcam/db';
import { POST_CONFIGS } from '@nittcam/machines';
import type { PdfMachine } from './layout-pages';

export async function estimateCutSeconds(
  scope: CompanyScope,
  project: Pick<ProjectRow, 'data' | 'name' | 'revision'>,
): Promise<number | null> {
  const data = project.data;
  if (data.layout.sheets.length === 0) return null;
  const machine = await scope.machines.getProfileVersion(data.machine.machineId, {
    version: data.machine.profileVersion,
  });
  if (!machine) return null;
  const raw = POST_CONFIGS[machine.profile.post.id];
  if (raw === undefined) return null;
  const blocking = validateProject(data, { machine: machine.profile }).some(
    (i) => i.severity === 'error',
  );
  if (blocking) return null;
  const sim = simulateProject(
    data,
    { profile: machine.profile, version: machine.version.version, verification: machine.state },
    raw,
    { projectName: project.name, revision: project.revision },
  );
  return sim.ok && sim.summary ? sim.summary.seconds : null;
}

/** The pinned profile's origin data for the PDF program-zero mark (B51); null = no machine. */
export async function pdfMachine(
  scope: CompanyScope,
  data: ProjectRow['data'],
): Promise<PdfMachine> {
  const machine = await scope.machines.getProfileVersion(data.machine.machineId, {
    version: data.machine.profileVersion,
  });
  if (!machine) return null;
  const { origin, zZero, workEnvelope } = machine.profile;
  return { origin, zZero, workEnvelope };
}
