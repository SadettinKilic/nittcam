/**
 * Procedural material textures of the 3D preview (T154, spec §3.8, D-033): generated in code
 * from the material's token colour, no image downloads. Deterministic (seeded) RGBA pixels, so
 * the same material always looks the same and the generator is unit-testable without a canvas.
 *
 * Texture space: u runs along the grain, v across it; the scene maps u onto the effective grain
 * direction of every part. Tileable in both directions (integer frequencies only).
 */

export type MaterialLook = 'mdf' | 'plywood' | 'melamine' | 'solidWood' | 'acrylic' | 'pvc';

/** Texture size in pixels (power of two: mipmaps, repeat wrapping). */
export const TEXTURE_SIZE = 256;

/** Millimetres covered by one texture tile along and across the grain. */
export const TILE_MM = { along: 1200, across: 300 } as const;

/** Look of a stock material id (`project.stock.material`); unknown kinds read as MDF. */
export function materialLook(material: string): MaterialLook {
  switch (material) {
    case 'plywood':
    case 'melamine':
    case 'solidWood':
    case 'acrylic':
    case 'pvc':
      return material;
    default:
      return 'mdf';
  }
}

/** Token custom property of a look's base colour (`packages/ui/src/tokens.css`). */
export const MATERIAL_TOKEN: Record<MaterialLook, string> = {
  mdf: '--color-mat-mdf',
  plywood: '--color-mat-plywood',
  melamine: '--color-mat-melamine',
  solidWood: '--color-mat-solid-wood',
  acrylic: '--color-mat-acrylic',
  pvc: '--color-mat-pvc',
};

/** True when the look carries visible grain stripes. */
export function hasStripes(look: MaterialLook): boolean {
  return look === 'plywood' || look === 'solidWood';
}

/** Surface parameters: matte everywhere (no glossy "game" look), acrylic a little smoother. */
export function surfaceOf(look: MaterialLook): { roughness: number } {
  return { roughness: look === 'acrylic' ? 0.55 : look === 'pvc' ? 0.7 : 0.92 };
}

/** Parses `#rgb`, `#rrggbb` or `rgb(r, g, b)`; unknown → mid grey. */
export function parseColor(css: string): [number, number, number] {
  const s = css.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1] ?? '';
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [136, 136, 136];
}

/** Small seeded PRNG (mulberry32): same seed, same texture. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * RGBA pixels (TEXTURE_SIZE²) of a material: wood looks get soft, slightly wavy stripes along
 * u (darker late-wood lines), MDF a fine fibre noise, melamine / plastics an almost flat tone.
 */
export function materialPixels(look: MaterialLook, base: string, seed = 1): Uint8ClampedArray {
  const N = TEXTURE_SIZE;
  const [r0, g0, b0] = parseColor(base);
  const out = new Uint8ClampedArray(N * N * 4);
  const rand = rng(seed);
  const noiseAmp = look === 'mdf' ? 0.045 : hasStripes(look) ? 0.02 : 0.008;
  // Stripe layers: integer frequencies across (v) keep the tile seamless; waviness along u too.
  const layers = hasStripes(look)
    ? Array.from({ length: 4 }, (_, i) => ({
        freq: [7, 13, 23, 41][i] ?? 7,
        amp: [0.07, 0.05, 0.035, 0.02][i] ?? 0.02,
        phase: rand() * Math.PI * 2,
        wave: 1 + Math.floor(rand() * 3),
        wavePhase: rand() * Math.PI * 2,
      }))
    : [];
  for (let y = 0; y < N; y++) {
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const u = x / N;
      let shade = 1;
      for (const l of layers) {
        const vv = v + 0.012 * Math.sin(2 * Math.PI * l.wave * u + l.wavePhase);
        const s = 0.5 + 0.5 * Math.sin(2 * Math.PI * l.freq * vv + l.phase);
        shade -= l.amp * s ** 3;
      }
      shade += (rand() - 0.5) * 2 * noiseAmp;
      const i = (y * N + x) * 4;
      out[i] = r0 * shade;
      out[i + 1] = g0 * shade;
      out[i + 2] = b0 * shade;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Effective grain angle of a placed part in the sheet frame (degrees, D-034): a fixed part
 * keeps its own grain turned with it; a free part shows the sheet's grain (it is cut from it);
 * no sheet grain → 0 (texture along X). */
export function effectiveGrain(
  part: { grain: { mode: 'free' | 'fixed'; angle: number } },
  rot: number,
  sheetGrain: number | null,
): number {
  const raw = part.grain.mode === 'fixed' ? part.grain.angle + rot : (sheetGrain ?? 0);
  return ((raw % 180) + 180) % 180;
}
