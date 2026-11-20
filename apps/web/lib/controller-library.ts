/**
 * Controller-family library (T181, spec §7.1): the families NittCam ships a post config for. A new
 * machine profile picks one and is pre-filled from that post config (`profileFromPostConfig`).
 */
import {
  KNOWN_POSTS,
  parsePostConfig,
  profileFromPostConfig,
  type MachineProfile,
} from '@nittcam/core';
import { POST_CONFIGS } from '@nittcam/machines';

export interface ControllerFamily {
  id: string;
  name: string;
}

export const CONTROLLER_LIBRARY: readonly ControllerFamily[] = KNOWN_POSTS.map((k) => ({
  id: k.id,
  name: k.name,
}));

/**
 * The profile of family `id`, keeping what the user already typed in Kimlik (name, brand, model,
 * notes). `null` for an unknown id or an invalid post config.
 */
export function controllerProfile(id: string, keep?: MachineProfile): MachineProfile | null {
  const parsed = parsePostConfig(POST_CONFIGS[id]);
  if (!parsed.ok) return null;
  const p = profileFromPostConfig(parsed.config);
  if (keep) {
    const { name, brand, model, notes } = keep.identity;
    p.identity = { ...p.identity, name, brand, model, notes };
  }
  return p;
}
