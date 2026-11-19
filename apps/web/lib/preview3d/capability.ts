/**
 * WebGL2 capability check of the 3D preview (T152, D-033): without WebGL2 the view falls back to
 * the 2D layout with a Turkish note. Kept out of the 3D chunk so the check costs nothing.
 */

let cached: boolean | null = null;

/** True when the browser can create a WebGL2 context (cached after the first call). */
export function hasWebGL2(doc: Pick<Document, 'createElement'> | null = globalDocument()): boolean {
  if (cached !== null) return cached;
  cached = probe(doc);
  return cached;
}

/** Uncached probe (tests). */
export function probe(doc: Pick<Document, 'createElement'> | null): boolean {
  if (!doc) return false;
  try {
    const canvas = doc.createElement('canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    // Free the probe context right away; browsers cap live contexts.
    (gl as WebGL2RenderingContext).getExtension?.('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Test hook: forget the cached result. */
export function resetWebGL2Cache(): void {
  cached = null;
}

function globalDocument(): Document | null {
  return typeof document === 'undefined' ? null : document;
}
