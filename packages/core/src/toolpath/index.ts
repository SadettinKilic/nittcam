/** Toolpath model and builder (spec §6.3, T014, D-021). Pure code. */
export * from './types';
export * from './depth';
export {
  buildToolpath,
  placedOutline,
  placedInners,
  outerContourPath,
  innerContourPath,
  TOOLPATH_DEFAULTS,
  FASTEST_START_EDGE_FRACTION,
} from './build';
export type { ContourPathResult } from './build';
export { toolpathSafetyViolations, operationMoves, toolpathMoves } from './safety';
export { summarizeToolpath, moveLength } from './stats';
export {
  TAB_DEFAULTS,
  defaultTabHeight,
  isSmallPart,
  placeTabs,
  evenTabCentres,
  tabCentreIntervals,
  passMovesWithTabs,
} from './tabs';
export type { Interval } from './tabs';
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
