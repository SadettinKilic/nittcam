/**
 * Controller-family machine library (T181, spec §7.1 "Makine kütüphanesi ... controller ailesi
 * üzerinden kurulur"). A new machine profile is pre-filled from the post config of the chosen
 * controller family, so the program format, tool change and controller limits match the post
 * that will write its G-code. The user still checks the machine-specific values (work envelope,
 * table, spindle, tools) and verifies the machine (§7.3). Pure.
 */
import { defaultMachineProfile } from './defaults';
import type { MachineProfile } from './profile';

/** Tool positions assumed for an automatic changer until the user enters the real count. */
export const AUTO_CHANGER_CAPACITY = 8;

const MB = 1024 * 1024;

/**
 * The post config fields a profile pre-fill reads. Structural (not `PostConfig` from `post/`) so
 * the machine module, which the independent G-code checks reach, does not import the post code.
 */
export interface ControllerPostFields {
  id: string;
  name: string;
  version: string;
  toolChange: { mode: 'auto' | 'manual' | 'none'; lengthOffset: boolean };
  file: { maxNameLength: number; maxSizeBytes: number };
  arcs: { enabled: boolean };
  lineNumbers: { enabled: boolean };
  drill: { cycles: string };
}

/**
 * A new (not example, unnamed) profile for the controller family of `config`: the generic
 * profile's machine values (envelope, spindle, tools, MDF 18 set) plus everything the post config
 * fixes: controller family name, post id + version, tool change mode and G43, file name length,
 * file size, arcs, line numbers and drill cycles. The name is empty (the user fills it), so the
 * result is valid once named.
 */
export function profileFromPostConfig(config: ControllerPostFields): MachineProfile {
  const p = defaultMachineProfile();
  p.example = false;
  p.identity.name = '';
  p.identity.controller = { family: config.name, version: '' };
  p.post = { id: config.id, version: config.version };
  const mode = config.toolChange.mode;
  p.toolChanger = {
    type: mode,
    capacity: mode === 'auto' ? AUTO_CHANGER_CAPACITY : 1,
    lengthCompensation: config.toolChange.lengthOffset,
  };
  p.constraints = {
    maxFileNameLength: config.file.maxNameLength,
    maxFileSizeMb: Math.round((config.file.maxSizeBytes / MB) * 100) / 100,
    arcs: config.arcs.enabled,
    lineNumbers: config.lineNumbers.enabled,
    drillCycles: config.drill.cycles !== 'none',
  };
  return p;
}
