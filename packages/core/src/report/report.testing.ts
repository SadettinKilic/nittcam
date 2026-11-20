/** Test fixtures of the report module (T172–T174). Not exported from the package. */
import { nestProject } from '../nesting';
import { parseProject, type Project } from '../schema';
import shelfSet from '../schema/__fixtures__/shelf-set.json';

/** The shelf-set fixture (3 rect parts, 8 copies, banded edges) with a fresh layout. */
export function nestedShelfSet(mutate: (p: Record<string, unknown>) => void = () => {}): Project {
  const src = structuredClone(shelfSet) as Record<string, unknown>;
  mutate(src);
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(`fixture invalid: ${JSON.stringify(parsed.issues)}`);
  return { ...parsed.project, layout: nestProject(parsed.project, { toolDiameter: 8 }).layout };
}
