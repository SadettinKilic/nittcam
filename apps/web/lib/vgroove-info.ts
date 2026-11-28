import {
  hasVGeometry,
  vGrooveToolOf,
  vGrooveTraitsOf,
  type MachineProfile,
  type Project,
  type Tool,
  type VGrooveTraits,
} from '@nittcam/core';

/**
 * T352 (§6.3 "V-kanal"): what the drawing board needs to offer and draw V-grooves: the stock's
 * V-groove row (`null` = the material does not fold, the operation is not offered), the machine's
 * V-bits with an angle, the V-bit the grooves cut with and the thickness.
 */
export interface VGrooveInfo {
  traits: VGrooveTraits | null;
  vBits: readonly Tool[];
  tool: Tool | undefined;
  thickness: number;
}

export const NO_VGROOVE: VGrooveInfo = { traits: null, vBits: [], tool: undefined, thickness: 0 };

export function vGrooveInfoOf(project: Project, profile: MachineProfile | null): VGrooveInfo {
  const traits = vGrooveTraitsOf(project.stock.material);
  if (!traits) return { ...NO_VGROOVE, thickness: project.stock.thickness };
  return {
    traits,
    vBits: profile ? profile.tools.filter(hasVGeometry) : [],
    tool: profile ? vGrooveToolOf(project, profile) : undefined,
    thickness: project.stock.thickness,
  };
}
