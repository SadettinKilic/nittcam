import { materialKindOf } from '../machine/material';
import { traitsOf } from '../machine/material-traits';
import type { GrainOfSheet } from '../geometry/grain';
import { defaultSheet, type Project } from '../schema';

/**
 * The project's sheet as the grain rule reads it (T347): the sheet direction plus whether the
 * material is directed (ACM film arrow, traits `direction.kind === 'directed'`). Axial materials
 * (wood, aluminium) and unknown kinds give `directed: false`, so their placements are unchanged.
 */
export function grainSheetOf(project: Pick<Project, 'stock'>): GrainOfSheet {
  const sheet = defaultSheet(project as Project);
  const directed = traitsOf(materialKindOf(project.stock.material)).direction.kind === 'directed';
  return directed ? { grain: sheet.grain, directed: true } : { grain: sheet.grain };
}
