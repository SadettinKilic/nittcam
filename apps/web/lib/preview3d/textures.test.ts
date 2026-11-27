import { describe, expect, it } from 'vitest';
import { FpsWatch } from './fps';
import {
  MATERIAL_TOKEN,
  TEXTURE_SIZE,
  effectiveGrain,
  hasStripes,
  materialLook,
  materialPixels,
  parseColor,
  surfaceOf,
} from './textures';

/** Mean luminance per row (v) and per column (u) of a texture. */
function profiles(px: Uint8ClampedArray) {
  const N = TEXTURE_SIZE;
  const rows = new Array<number>(N).fill(0);
  const cols = new Array<number>(N).fill(0);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const l = px[(y * N + x) * 4 + 1] ?? 0;
      rows[y] = (rows[y] ?? 0) + l / N;
      cols[x] = (cols[x] ?? 0) + l / N;
    }
  return { rows, cols };
}
const spread = (a: number[]) => Math.max(...a) - Math.min(...a);

describe('procedural material textures (T154)', () => {
  it('maps stock materials to looks; unknown reads as MDF', () => {
    expect(materialLook('plywood')).toBe('plywood');
    expect(materialLook('acrylic')).toBe('acrylic');
    expect(materialLook('marble')).toBe('mdf');
    expect(hasStripes('plywood')).toBe(true);
    expect(hasStripes('mdf')).toBe(false);
    expect(surfaceOf('mdf').roughness).toBeGreaterThan(0.8);
  });

  it('reads the look from the traits with the values it had before (T342)', () => {
    // An alias is not a kind id: it keeps the MDF look, as the old switch did.
    expect(materialLook('melamine-chipboard')).toBe('mdf');
    expect(materialLook('solidWood')).toBe('solidWood');
    expect(MATERIAL_TOKEN).toEqual({
      mdf: '--color-mat-mdf',
      plywood: '--color-mat-plywood',
      melamine: '--color-mat-melamine',
      solidWood: '--color-mat-solid-wood',
      acrylic: '--color-mat-acrylic',
      pvc: '--color-mat-pvc',
    });
    const looks = ['mdf', 'plywood', 'melamine', 'solidWood', 'acrylic', 'pvc'] as const;
    expect(looks.map((l) => surfaceOf(l).roughness)).toEqual([0.92, 0.92, 0.92, 0.92, 0.55, 0.7]);
    expect(looks.filter(hasStripes)).toEqual(['plywood', 'solidWood']);
  });

  it('parses token colours', () => {
    expect(parseColor('#b39a7a')).toEqual([0xb3, 0x9a, 0x7a]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
  });

  it('is deterministic per seed', () => {
    expect(materialPixels('plywood', '#d6c09c', 7)).toEqual(
      materialPixels('plywood', '#d6c09c', 7),
    );
    expect(materialPixels('plywood', '#d6c09c', 7)).not.toEqual(
      materialPixels('plywood', '#d6c09c', 8),
    );
  });

  it('wood stripes run along u (vary across v), MDF and plastics stay even', () => {
    const wood = profiles(materialPixels('plywood', '#d6c09c'));
    expect(spread(wood.rows)).toBeGreaterThan(8 * spread(wood.cols));
    expect(spread(wood.rows)).toBeGreaterThan(10);
    const mdf = profiles(materialPixels('mdf', '#b39a7a'));
    expect(spread(mdf.rows)).toBeLessThan(6);
    const acrylic = profiles(materialPixels('acrylic', '#cbdade'));
    expect(spread(acrylic.rows)).toBeLessThan(2);
  });

  it('keeps the base colour on average (no tinting)', () => {
    const px = materialPixels('melamine', '#e9e7e1');
    let r = 0;
    for (let i = 0; i < px.length; i += 4) r += px[i] ?? 0;
    expect(r / (px.length / 4)).toBeCloseTo(0xe9, -1);
  });

  it('effective grain: fixed parts turn with the part, free parts show the sheet grain', () => {
    const fixed = { grain: { mode: 'fixed' as const, angle: 30 } };
    const free = { grain: { mode: 'free' as const, angle: 30 } };
    expect(effectiveGrain(fixed, 0, 90)).toBe(30);
    expect(effectiveGrain(fixed, 90, 0)).toBe(120);
    expect(effectiveGrain(fixed, 180, 0)).toBe(30);
    expect(effectiveGrain(free, 90, 45)).toBe(45);
    expect(effectiveGrain(free, 0, null)).toBe(0);
  });
});

describe('fps watch (D-033 automatic Basit mod)', () => {
  it('fires once after 3 s below 30 fps', () => {
    const w = new FpsWatch();
    let fired = 0;
    for (let t = 0; t <= 4000; t += 50) if (w.frame(t)) fired++; // 20 fps
    expect(fired).toBe(1);
  });

  it('stays quiet at 60 fps and across idle pauses', () => {
    const w = new FpsWatch();
    for (let t = 0; t <= 5000; t += 16) expect(w.frame(t)).toBe(false);
    const idle = new FpsWatch();
    // Short slow bursts separated by pauses (render on demand) never add up.
    for (let burst = 0; burst < 5; burst++)
      for (let t = 0; t < 1000; t += 50) expect(idle.frame(burst * 5000 + t)).toBe(false);
  });
});
