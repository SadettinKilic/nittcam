/**
 * Explode and section for the montaj tezgâhı (T389, D-131). Pure, display only: the exploded
 * poses are never stored. Cabinet boards move out along the box axes (each along the axis it sits
 * farthest out on: sides sideways, top and bottom up and down, back backwards, shelves forward);
 * loose parts spread out from their common centre.
 */
import { add, worldBounds, type LocalBox, type Pose, type V3 } from './assembly-math';

export interface ExplodeItem {
  id: string;
  pose: Pose;
  box: LocalBox;
  /** Cabinet group (boards of one cabinet); absent = a loose part. */
  group?: string | undefined;
}

/** Extra travel at full explode, as a share of the group's half size along the axis. */
const PAD = 0.35;
/** A board this close to the centre (share of half size) on every axis slides forward. */
const CENTRE = 0.05;

export interface Bounds {
  min: V3;
  max: V3;
}

/** World bounds of a set of placed parts (null when empty). */
export function boundsOf(items: readonly { pose: Pose; box: LocalBox }[]): Bounds | null {
  if (items.length === 0) return null;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const it of items) {
    const b = worldBounds(it.pose, it.box);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, b.min[k] as number);
      max[k] = Math.max(max[k] as number, b.max[k] as number);
    }
  }
  return { min, max };
}

/** World offset of every item at explode amount `k` (0 = assembled, 1 = fully exploded). */
export function explodeOffsets(items: readonly ExplodeItem[], k: number): Map<string, V3> {
  const out = new Map<string, V3>();
  if (k <= 0) return out;
  const groups = new Map<string, ExplodeItem[]>();
  for (const it of items) {
    const key = it.group === undefined ? '' : `g:${it.group}`;
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
  }
  for (const [key, list] of groups) {
    const b = boundsOf(list);
    if (!b) continue;
    const c: V3 = [0, 1, 2].map((i) => ((b.min[i] as number) + (b.max[i] as number)) / 2) as V3;
    const h: V3 = [0, 1, 2].map((i) =>
      Math.max(1, ((b.max[i] as number) - (b.min[i] as number)) / 2),
    ) as V3;
    for (const it of list) {
      const rel: V3 = [0, 1, 2].map(
        (i) => (it.pose.position[i] as number) - (c[i] as number),
      ) as V3;
      if (key === '') {
        out.set(it.id, [rel[0] * k, rel[1] * k, rel[2] * k]);
        continue;
      }
      let axis = 2;
      let best = -1;
      for (let i = 0; i < 3; i++) {
        const n = Math.abs(rel[i] as number) / (h[i] as number);
        if (n > best) {
          best = n;
          axis = i;
        }
      }
      const sign = best < CENTRE ? 1 : Math.sign(rel[axis] as number) || 1;
      if (best < CENTRE) axis = 2;
      const off: V3 = [0, 0, 0];
      off[axis] = sign * k * (Math.abs(rel[axis] as number) + PAD * (h[axis] as number));
      out.set(it.id, off);
    }
  }
  return out;
}

/** The item at its exploded pose (same object when it does not move). */
export function exploded<T extends { id: string; pose: Pose }>(
  item: T,
  offsets: ReadonlyMap<string, V3>,
): T {
  const off = offsets.get(item.id);
  if (!off || (off[0] === 0 && off[1] === 0 && off[2] === 0)) return item;
  return {
    ...item,
    pose: { position: add(item.pose.position, off), rotation: item.pose.rotation },
  };
}

/** Section plane (T389): keeps the side below `at` along `axis` (above when flipped). */
export interface Section {
  axis: 0 | 1 | 2;
  at: number;
  flip: boolean;
}

/** three.js Plane parameters: points with normal · p + constant ≥ 0 stay visible. */
export function sectionPlane(s: Section): { normal: V3; constant: number } {
  const normal: V3 = [0, 0, 0];
  normal[s.axis] = s.flip ? 1 : -1;
  return { normal, constant: s.flip ? -s.at : s.at };
}
