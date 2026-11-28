import { holeFixtureProject, goldenProfile } from '../post/golden.testing';
import type { MachineProfile } from '../machine';
import type { Project } from '../schema';

/** Aluminium 6 mm on the golden profile with metal declared; T1 Ø6 2-flute, 0,04 mm/tooth. */
export function aluProfile(
  over: Partial<MachineProfile['materials'][number]> = {},
): MachineProfile {
  const p = goldenProfile('generic');
  p.metal = { enabled: true, rigidity: 'standard' };
  p.tools = [...p.tools, { number: 3, type: 'drill', diameter: 5, fluteLength: 30, flutes: 2 }];
  p.materials = [
    ...p.materials,
    {
      material: 'aluminium',
      thickness: 6,
      feed: 1440,
      plungeFeed: 400,
      rpm: 18000,
      stepDown: 2,
      tool: 1,
      ...over,
    },
  ];
  return p;
}

/** The hole fixture panel on aluminium 6 mm (two copies, fixed placements). */
export function aluProject(
  holes: readonly unknown[],
  part: Partial<Project['parts'][number]> = {},
  material: 'aluminium' | 'mdf' = 'aluminium',
): Project {
  const p = holeFixtureProject(holes);
  return {
    ...p,
    stock: { ...p.stock, material, thickness: 6 },
    parts: p.parts.map((x) => ({ ...x, ...part }) as Project['parts'][number]),
  };
}
