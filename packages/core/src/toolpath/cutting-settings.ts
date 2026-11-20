/**
 * T288 (CTO #10 E1, K3): the cutting settings a project's toolpath uses, resolved the same way
 * `buildToolpath` resolves them (D-022: project override > material set > built-in default), so
 * the Simülasyon "Kesim ayarları" panel and the G-code header read what is really cut. Pure.
 */
import { findMaterialParams, type MachineProfile } from '../machine';
import type { Project } from '../schema';
import { TAB_DEFAULTS, defaultTabHeight } from './tabs';

export type TabMode = 'all' | 'small' | 'off';
/** Where a tab value comes from. */
export type TabSource = 'project' | 'material' | 'default';

export interface CuttingSettings {
  /** `all` = every part, `small` = small parts only (safety rule), `off` = none, skin instead. */
  tabMode: TabMode;
  tabs: {
    count: number;
    width: number;
    height: number;
    source: { count: TabSource; width: TabSource; height: TabSource };
  };
  /** Thin skin under small parts, mm; null = tabs hold them. */
  skin: number | null;
  leadIn: 'arc' | 'line';
  direction: 'climb' | 'conventional';
}

/** `all` when tabs are on for every part; else `off` with a thin skin, `small` without. */
export function tabModeOf(project: Project): TabMode {
  if (project.cutting.tabs.auto) return 'all';
  return project.cutting.skin ? 'off' : 'small';
}

export function cuttingSettingsOf(project: Project, machine?: MachineProfile): CuttingSettings {
  const set = machine ? findMaterialParams(machine, project.stock) : undefined;
  const pt = project.cutting.tabs;
  const pick = (
    own: number | undefined,
    mat: number | undefined,
    builtIn: number,
  ): [number, TabSource] =>
    own !== undefined
      ? [own, 'project']
      : mat !== undefined
        ? [mat, 'material']
        : [builtIn, 'default'];
  const [count, countSrc] = pick(pt.count, set?.tabs?.count, TAB_DEFAULTS.count);
  const [width, widthSrc] = pick(pt.width, set?.tabs?.width, TAB_DEFAULTS.width);
  const [height, heightSrc] = pick(
    pt.height,
    set?.tabs?.height,
    defaultTabHeight(project.stock.thickness),
  );
  return {
    tabMode: tabModeOf(project),
    tabs: { count, width, height, source: { count: countSrc, width: widthSrc, height: heightSrc } },
    skin: project.cutting.skin?.thickness ?? null,
    leadIn: project.cutting.leadIn,
    direction: project.cutting.direction,
  };
}
