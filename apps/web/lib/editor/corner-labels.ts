/**
 * Stable corner numbers in the properties panel (B52, D-092, CTO #5): after "Köşe ekle", a fillet
 * or a dogbone the existing corners keep their number and the new ones take the number before
 * them with a letter (3a, 3b). Session memory only: a reload numbers the corners 1…n again.
 */
import type { Pt } from './viewport';

const SAME = 1e-6;

/** Default numbers 1…n. */
function plain(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

/**
 * Labels for `next` given the previous outline and its labels. Same corner count = an edit that
 * moved corners: labels stay by index. Otherwise corners at an unchanged position keep their
 * label, new ones get the preceding kept label plus a letter.
 */
export function relabel(
  prev: { outline: readonly Pt[]; labels: readonly string[] } | null,
  next: readonly Pt[],
  /** Labels seen earlier at a position ("x,y"): an undo gives a corner its old number back. */
  known?: ReadonlyMap<string, string>,
): string[] {
  if (!prev || prev.labels.length !== prev.outline.length) return plain(next.length);
  if (prev.outline.length === next.length) return [...prev.labels];
  const used = new Set<number>();
  const kept: (string | null)[] = next.map((p) => {
    const i = prev.outline.findIndex(
      (q, k) => !used.has(k) && Math.abs(q.x - p.x) < SAME && Math.abs(q.y - p.y) < SAME,
    );
    if (i < 0) return null;
    used.add(i);
    return prev.labels[i] ?? null;
  });
  const taken = new Set(kept.filter((l): l is string => l !== null));
  next.forEach((p, i) => {
    const old = kept[i] === null ? known?.get(posKey(p)) : undefined;
    if (old !== undefined && !taken.has(old)) {
      kept[i] = old;
      taken.add(old);
    }
  });
  if (kept.every((l) => l === null)) return plain(next.length);
  const out: string[] = [];
  // Start after a kept corner so every new one has a kept corner before it (wrapping around).
  const n = next.length;
  const start = kept.findIndex((l) => l !== null);
  let base = kept[start] as string;
  for (let s = 0; s < n; s++) {
    const i = (start + s) % n;
    const l = kept[i];
    if (l !== null && l !== undefined) {
      base = l;
      out[i] = l;
      continue;
    }
    let c = 0;
    let name = '';
    do {
      name = c < 26 ? base + String.fromCharCode(97 + c) : `${base}.${c + 1}`;
      c++;
    } while (taken.has(name));
    taken.add(name);
    out[i] = name;
  }
  return out;
}

/** Position key of a corner (to 1e-6 mm). */
function posKey(p: Pt): string {
  return `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
}

const memory = new Map<
  string,
  { outline: readonly Pt[]; labels: string[]; known: Map<string, string> }
>();

/** The corner labels of part `id` with this outline, remembered for the session. */
export function cornerLabels(id: string, outline: readonly Pt[]): string[] {
  const prev = memory.get(id) ?? null;
  if (prev && prev.outline === outline) return prev.labels;
  const known = prev?.known ?? new Map<string, string>();
  const labels = relabel(prev, outline, known);
  outline.forEach((p, i) => {
    const l = labels[i];
    if (l !== undefined) known.set(posKey(p), l);
  });
  memory.set(id, { outline, labels, known });
  return labels;
}

/** Test hook. */
export function forgetCornerLabels(): void {
  memory.clear();
}
