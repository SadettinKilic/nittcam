/** Post processor (spec §6.4, §7.2; T017, D-025). Pure code. */
export * from './types';
export {
  postConfigSchema,
  parsePostConfig,
  normalizePostVersion,
  KNOWN_POSTS,
  POST_CONFIG_SCHEMA_VERSION,
} from './config';
export type { PostConfig, PostConfigInput, ParsePostConfigResult, KnownPostId } from './config';
export {
  formatFixed,
  formatFixedCeil,
  formatFixedUp,
  sanitizeComment,
  formatComment,
  transliterateTurkish,
  sanitizeFileStem,
  buildFileName,
  PostFormatError,
} from './format';
export type { CommentFormat } from './format';
export {
  machineFrame,
  toMachine,
  toMachineXY,
  machineArcDirection,
  envelopeViolation,
  zEnvelopeViolation,
} from './frame';
export type { MachineFrame, FrameStock } from './frame';
export { arcGeometry, arcPieces, chordSegments, splitArc, ARC_RADIUS_TOL } from './arcs';
export type { ArcGeometry } from './arcs';
export {
  generateGcode,
  postCommentText,
  UNVERIFIED_HEADER,
  VACUUM_BY_HAND_HEADER,
  vacuumByHand,
} from './generate';
