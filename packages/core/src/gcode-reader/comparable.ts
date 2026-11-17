/**
 * Adapter from the read path to a neutral move shape (T018, D-026) that T019 compares with the
 * toolpath model (D-021) within tolerance.
 *
 * Defined **independently** of `toolpath/types` (the reader must not import it, §6.5), but with
 * the same field names (`kind`, `x`, `y`, `z`, `cx`, `cy`, `direction`, `feed`), so a toolpath
 * move maps to it with one line (`plunge` → `linear`). Coordinates are in the program frame; the
 * frame conversion (machine origin, Z zero, sheet offset) belongs to the comparison in T019.
 */
import type { GcodeMove, GcodePoint } from './types';

export interface ComparableMove {
  kind: 'rapid' | 'linear' | 'arc';
  /** End point (absolute, mm). */
  x: number;
  y: number;
  z: number;
  /** Arc centre (arcs only). */
  cx?: number;
  cy?: number;
  /** `cw` = G2, `ccw` = G3 (arcs only). */
  direction?: 'cw' | 'ccw';
  /** mm/min; `null` for rapids or an undefined feed. */
  feed: number | null;
  /** Source line of the G-code (absent on moves that come from the toolpath model). */
  line?: number;
}

export interface ComparablePath {
  /** Where the first move starts (the reader's position before it). */
  start: GcodePoint | null;
  moves: ComparableMove[];
}

/** Maps read moves to the neutral comparison shape. */
export function toComparablePath(moves: readonly GcodeMove[]): ComparablePath {
  const out: ComparableMove[] = [];
  for (const m of moves) {
    const { x, y, z } = m.to;
    if (m.arc) {
      out.push({
        kind: 'arc',
        x,
        y,
        z,
        cx: m.arc.cx,
        cy: m.arc.cy,
        direction: m.arc.direction,
        feed: m.feed,
        line: m.line,
      });
    } else {
      out.push({
        kind: m.type === 'rapid' ? 'rapid' : 'linear',
        x,
        y,
        z,
        feed: m.feed,
        line: m.line,
      });
    }
  }
  const first = moves[0];
  return { start: first ? { ...first.from } : null, moves: out };
}
