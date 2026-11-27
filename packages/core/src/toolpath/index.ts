/** Toolpath model and builder (spec §6.3, T014, D-021). Pure code. */
export * from './types';
export * from './depth';
export {
  buildToolpath,
  placedOutline,
  placedInners,
  placedLines,
  outerContourPath,
  innerContourPath,
  TOOLPATH_DEFAULTS,
  FASTEST_START_EDGE_FRACTION,
} from './build';
export type { ContourPathResult } from './build';
export { unsecuredSlugs } from './slug-check';
export type { UnsecuredSlug } from './slug-check';
export { toolpathSafetyViolations, operationMoves, toolpathMoves } from './safety';
export { summarizeToolpath, moveLength } from './stats';
export {
  TAB_DEFAULTS,
  TAB_BOUNDS,
  SKIN_BOUNDS,
  maxSkinThickness,
  skinThicknessOk,
  maxTabHeight,
  tabSizeProblem,
  defaultTabHeight,
  holdLimitsOf,
  DEFAULT_HOLD_LIMITS,
  isSmallPart,
  placeTabs,
  evenTabCentres,
  tabCentreIntervals,
  passMovesWithTabs,
} from './tabs';
export type { Interval, HoldLimits } from './tabs';
export {
  cutOrder,
  mustPrecede,
  rapidLength,
  toolChanges,
  CUT_CLASS_RANK,
  CUT_ORDER_DEFAULTS,
} from './order';
export type {
  CutClass,
  CutOrderMode,
  CutOrderOptions,
  CutOrderResult,
  OrderItem,
  OrderedItem,
  SheetOrderStats,
} from './order';
export {
  HOLE_DEFAULTS,
  buildHoleOperation,
  grooveRings,
  holeOperationKind,
  placedHoleCentre,
  pocketRings,
} from './holes';
export { buildOnlineOperation, openSegments, type OnlineInput } from './online';
export { cuttingSettingsOf, inheritedTabs, tabModeOf } from './cutting-settings';
export type { CuttingSettings, TabMode, TabSource } from './cutting-settings';
export {
  CHIP_LOAD_HIGH_FACTOR,
  FEED_HIGH_FACTOR,
  SPINDLE_RPM_BAND,
  SPINDLE_RPM_INPUT_STEP,
  SPINDLE_RPM_PAGE_STEP,
  SPINDLE_RPM_STEP,
  feedAboveRecommendation,
  feedOverride,
  feedOverridesOf,
  jobToolNumbers,
  rpmBand,
  rpmInRange,
  spindleOverride,
  spindleOverridesOf,
  spindleSettingsOf,
  type RpmBand,
  type ToolSpindle,
} from './spindle';
export {
  OPERATION_TOOL_KINDS,
  OPERATION_TOOL_TYPES,
  contourPocketTool,
  contourTool,
  effectiveHoleTool,
  hasContourPocket,
  holeToolKind,
  operationToolChoice,
  operationsInJob,
  recommendedFeeds,
  recommendedRpm,
  type OperationToolKind,
} from './op-tools';
export {
  CONTOUR_POCKET_DEFAULTS,
  buildContourPocketOperation,
  contourPocketRings,
} from './contour-pocket';
export {
  operationToolProblem,
  operationToolsOf,
  type OperationToolProblem,
  type OperationToolRow,
} from './op-tool-choice';
