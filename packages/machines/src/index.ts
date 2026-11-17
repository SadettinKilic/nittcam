/**
 * @nittcam/machines — post configs, machine library and golden G-code files (spec §6.4, §7.1).
 * The post configs are data (validated by `@nittcam/core`'s `postConfigSchema`); every version
 * has golden NC files under `<post>/v<n>/golden/` (owner approval to change, `needs-human`).
 */
import genericV1 from '../generic/v1/post.json';
import mach3V1 from '../mach3/v1/post.json';

export const MACHINES_PACKAGE = '@nittcam/machines';

/** Raw post configs by id (latest version). Parse with `parsePostConfig` before use. */
export const POST_CONFIGS: Record<string, unknown> = {
  generic: genericV1,
  mach3: mach3V1,
};
