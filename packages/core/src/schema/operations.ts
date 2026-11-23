/**
 * Per-contour operations (T142, spec §4.6, §6.3): the effective operation of a part's outline,
 * inner contours and open lines, with the defaults filled in. Pure.
 */
import type { ContourOperation, ContourOperationKind, Part } from './project';

/** A contour of a part: its outline, inner contour `index`, or open line `index`. */
export type ContourRef =
  { type: 'outline' } | { type: 'inner'; index: number } | { type: 'line'; index: number };

/** Kinds allowed on each contour type (T142). */
export const ALLOWED_OPERATIONS: Readonly<
  Record<ContourRef['type'], readonly ContourOperationKind[]>
> = {
  outline: ['outside', 'online', 'none'],
  inner: ['inside', 'online', 'pocket', 'none'],
  line: ['online', 'none'],
};

export const OUTLINE_DEFAULT: ContourOperation = { kind: 'outside' };
export const INNER_DEFAULT: ContourOperation = { kind: 'inside' };

/** The outline's operation (default: through cut outside the line). */
export function outlineOperation(part: Pick<Part, 'ops'>): ContourOperation {
  return part.ops?.outline ?? OUTLINE_DEFAULT;
}

/** Inner contour `k`'s operation (default: through cut inside the line). */
export function innerOperation(part: Pick<Part, 'ops'>, k: number): ContourOperation {
  return part.ops?.inners?.[k] ?? INNER_DEFAULT;
}

/** The operation of any contour; `undefined` when the contour does not exist. */
export function contourOperation(part: Part, ref: ContourRef): ContourOperation | undefined {
  switch (ref.type) {
    case 'outline':
      return outlineOperation(part);
    case 'inner':
      return ref.index < part.inners.length ? innerOperation(part, ref.index) : undefined;
    case 'line':
      return part.lines?.[ref.index]?.op;
  }
}
