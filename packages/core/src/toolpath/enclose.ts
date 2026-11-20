/**
 * Part-in-hole hosts (T166, spec §6.2): which placed copy sits inside an inner cutout of another
 * copy on the same sheet. Cutting that inner contour frees the slug the guest is cut from, so the
 * guest must be cut completely first (`OrderItem.within`). Pure.
 */
import { bbox } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Point, Polyline } from '../geometry/types';

/** One placed copy in the sheet frame. */
export interface PlacedCopy {
  /** Copy key `<partId>#<copy>`. */
  key: string;
  outline: Polyline;
  inners: readonly Polyline[];
}

function ring(poly: Polyline): Point[] {
  const out: Point[] = [];
  const vs = poly.vertices;
  vs.forEach((a, i) => {
    const b = vs[(i + 1) % vs.length] as typeof a;
    out.push(...sampleSegment(a, b, a.bulge, 16).slice(0, -1));
  });
  return out;
}

function inside(p: Point, r: readonly Point[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i] as Point;
    const b = r[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/**
 * Guest copy key → host copy key, for every copy whose outline lies inside an inner contour of
 * another copy (bbox inside the inner's bbox and its first vertex inside the inner). Copies
 * without such a host are absent. Cheap when no copy has inners.
 */
export function partInHoleHosts(copies: readonly PlacedCopy[]): Map<string, string> {
  const hosts = new Map<string, string>();
  const zones = copies.flatMap((c) =>
    c.inners.map((inner) => ({ key: c.key, box: bbox(inner), inner, pts: null as Point[] | null })),
  );
  if (zones.length === 0) return hosts;
  for (const c of copies) {
    const b = bbox(c.outline);
    const p = c.outline.vertices[0];
    if (!p) continue;
    for (const z of zones) {
      if (z.key === c.key) continue;
      if (b.minX < z.box.minX || b.minY < z.box.minY || b.maxX > z.box.maxX || b.maxY > z.box.maxY)
        continue;
      z.pts ??= ring(z.inner);
      if (inside(p, z.pts)) {
        hosts.set(c.key, z.key);
        break;
      }
    }
  }
  return hosts;
}
