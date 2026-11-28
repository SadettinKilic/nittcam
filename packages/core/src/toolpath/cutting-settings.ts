/**
 * T288 (CTO #10 E1, K3): the cutting settings a project's toolpath uses, resolved the same way
 * `buildToolpath` resolves them (D-022: project override > material set > built-in default), so
 * the Simülasyon "Kesim ayarları" panel and the G-code header read what is really cut. Pure.
 */
import { findMaterialParams, type MachineProfile } from '../machine';
import type { Project } from '../schema';
import { defaultTabHeight, holdLimitsOf } from './tabs';

export type TabMode = 'all' | 'small' | 'off';
/** Where a tab value comes from. */
export type TabSource = 'project' | 'material' | 'default';

export interface CuttingSettings {
  /** `all` = every part, `small` = small parts only (safety rule), `off` = none, skin instead. */
  tabMode: TabMode;
  tabs: {
    /** Per part. */
    count: number;
    /** T294: what a small part really gets: at least the traits' `smallPartMinCount`. */
    smallCount: number;
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
  // T343: built-in defaults of the stock's traits row
  const limits = holdLimitsOf(project.stock.material);
  const td = limits.tabs.defaults;
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
  const [count, countSrc] = pick(pt.count, set?.tabs?.count, td.count);
  const [width, widthSrc] = pick(pt.width, set?.tabs?.width, td.width);
  const [height, heightSrc] = pick(
    pt.height,
    set?.tabs?.height,
    defaultTabHeight(project.stock.thickness, limits),
  );
  return {
    tabMode: tabModeOf(project),
    tabs: {
      count,
      smallCount: Math.max(count, td.smallPartMinCount),
      width,
      height,
      source: { count: countSrc, width: widthSrc, height: heightSrc },
    },
    skin: project.cutting.skin?.thickness ?? null,
    leadIn: project.cutting.leadIn,
    direction: project.cutting.direction,
  };
}

/**
 * The tab sizes the project gets without its own values (T302, CTO #12 E3): the machine's material
 * set when it has them, else the built-in default. What "Malzeme ayarına dön" goes back to.
 */
export function inheritedTabs(
  project: Project,
  machine?: MachineProfile,
): { count: number; width: number; height: number; source: 'material' | 'default' } {
  const { count, width, height } = project.cutting.tabs;
  const own = count !== undefined || width !== undefined || height !== undefined;
  const base = own
    ? {
        ...project,
        cutting: {
          ...project.cutting,
          tabs: { ...project.cutting.tabs, count: undefined, width: undefined, height: undefined },
        },
      }
    : project;
  const tabs = cuttingSettingsOf(base as Project, machine).tabs;
  return {
    count: tabs.count,
    width: tabs.width,
    height: tabs.height,
    source: tabs.source.count === 'material' ? 'material' : 'default',
  };
}
