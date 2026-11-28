/**
 * T353 (§6.3 "V-kanal", analysis §5.5): the V section of a part's V-grooves for the 3D preview, as
 * edge lines in the part frame (z = 0 bottom face, z = T top face): the two groove edges on the
 * machined face (offset ± width / 2 from the fold line), the groove bottom (± tip / 2 at depth)
 * and the V at both ends of an open fold line. Pure.
 */
import {
  contour,
  normalize,
  vGrooveDepth,
  vGrooveLines,
  vGrooveWidth,
  type Part,
  type VGrooveTraits,
} from '@nittcam/core';
import { flatten, flattenOpen } from './outlines';

/** What the 3D needs to draw a groove: the V-bit geometry, the traits and the machined face. */
export interface VGroove3d {
  angleDeg: number;
  tipDiameter: number;
  traits: VGrooveTraits;
  /** `back`: the groove opens on the bottom face (ACM is cut face down, T348). */
  face: 'front' | 'back';
}

type P = { x: number; y: number };

function points(flat: readonly number[]): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i] ?? 0, y: flat[i + 1] ?? 0 });
  return out;
}

/** The chain offset by `d` to its left (miter at the joints; closed chains wrap around). */
export function offsetChain(pts: readonly P[], d: number, closed: boolean): P[] {
  const n = pts.length;
  const normal = (a: P, b: P): P => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
  };
  return pts.map((p, i) => {
    const prev = i > 0 ? pts[i - 1] : closed ? pts[n - 1] : undefined;
    const next = i < n - 1 ? pts[i + 1] : closed ? pts[0] : undefined;
    const n1 = prev ? normal(prev, p) : undefined;
    const n2 = next ? normal(p, next) : undefined;
    const a = n1 ?? n2 ?? { x: 0, y: 0 };
    const b = n2 ?? n1 ?? { x: 0, y: 0 };
    const m = { x: a.x + b.x, y: a.y + b.y };
    const ml = Math.hypot(m.x, m.y);
    if (ml < 1e-9) return { x: p.x + a.x * d, y: p.y + a.y * d };
    const cos = (m.x * a.x + m.y * a.y) / ml;
    const k = d / Math.max(cos, 0.2);
    return { x: p.x + (m.x / ml) * k, y: p.y + (m.y / ml) * k };
  });
}

function chainEdges(out: number[], pts: readonly P[], z: number, closed: boolean): void {
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i] as P;
    const b = pts[(i + 1) % n] as P;
    out.push(a.x, a.y, z, b.x, b.y, z);
  }
}

/** Edge line segments (x, y, z pairs) of every V-groove of the part. */
export function vGrooveEdges(part: Part, thickness: number, v: VGroove3d): number[] {
  const out: number[] = [];
  for (const g of vGrooveLines(part, v.traits)) {
    const depth = Math.min(vGrooveDepth(thickness, g.remaining), thickness);
    if (!(depth > 0)) continue;
    const w = vGrooveWidth(v, depth);
    const pts = points(
      g.closed ? flatten(normalize(contour([...g.vertices]), 'inner')) : flattenOpen(g.vertices),
    );
    if (pts.length < 2) continue;
    const zFace = v.face === 'back' ? 0 : thickness;
    const zBottom = v.face === 'back' ? depth : thickness - depth;
    const tip = v.tipDiameter / 2;
    const left = offsetChain(pts, w / 2, g.closed);
    const right = offsetChain(pts, -w / 2, g.closed);
    const bl = tip > 0 ? offsetChain(pts, tip, g.closed) : pts;
    const br = tip > 0 ? offsetChain(pts, -tip, g.closed) : pts;
    chainEdges(out, left, zFace, g.closed);
    chainEdges(out, right, zFace, g.closed);
    chainEdges(out, bl, zBottom, g.closed);
    if (tip > 0) chainEdges(out, br, zBottom, g.closed);
    if (!g.closed) {
      for (const i of [0, pts.length - 1]) {
        const l = left[i] as P;
        const r = right[i] as P;
        const a = bl[i] as P;
        const b = br[i] as P;
        out.push(l.x, l.y, zFace, a.x, a.y, zBottom, r.x, r.y, zFace, b.x, b.y, zBottom);
      }
    }
  }
  return out;
}
