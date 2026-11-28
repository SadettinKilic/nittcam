/**
 * Stock materials of the 3D scene (T154, spec §3.6, §3.8): a procedural texture per material
 * (generated in code, `lib/preview3d/textures.ts`), mapped along each part's effective grain in
 * the sheet frame, matte surfaces, edge-banded walls in the band colour. "Basit mod": flat
 * Lambert colours without texture (and no shadows in the scene). Part of the lazy 3D chunk.
 */
import {
  Color,
  DataTexture,
  LinearMipmapLinearFilter,
  LinearFilter,
  MeshLambertMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Vector2,
  type Material,
} from 'three';
import {
  TEXTURE_SIZE,
  TILE_MM,
  materialPixels,
  surfaceOf,
  type MaterialLook,
} from '../../lib/preview3d/textures';
import {
  SLOT_FRAGMENT_BODY,
  SLOT_FRAGMENT_HEAD,
  SLOT_VERTEX_BODY,
  SLOT_VERTEX_HEAD,
  type SlotUniforms,
} from './slots';

export interface StockMaterials {
  part: Material;
  waste: Material;
  dispose: () => void;
}

/** Vertex attributes the patched shaders read (set on every part/waste geometry). */
export const GRAIN_ATTRIBUTE = 'aGrain';
export const BAND_ATTRIBUTE = 'aBand';

const VERTEX_HEAD = /* glsl */ `#include <common>
attribute float aGrain;
attribute float aBand;
uniform vec2 uGrainScale;
varying float vBand;`;

// Texture coordinates from the sheet-frame position: u along the grain (aGrain, radians), v
// across; walls also move v with the height so their faces are not a single smeared texel.
const VERTEX_UV = /* glsl */ `#include <uv_vertex>
#ifdef USE_INSTANCING
  vec4 gp = instanceMatrix * vec4(position, 1.0);
#else
  vec4 gp = vec4(position, 1.0);
#endif
float gc = cos(aGrain);
float gs = sin(aGrain);
vec2 gq = vec2(gc * gp.x + gs * gp.y, -gs * gp.x + gc * gp.y);
#ifdef USE_MAP
  vMapUv = gq * uGrainScale + vec2(0.0, gp.z * uGrainScale.y);
#endif
vBand = aBand;`;

const FRAGMENT_HEAD = /* glsl */ `#include <common>
uniform vec3 uBandColor;
varying float vBand;`;

const FRAGMENT_MAP = /* glsl */ `#include <map_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uBandColor, step(0.5, vBand));
${SLOT_FRAGMENT_BODY}`;

function patch(material: Material, band: Color, slots: SlotUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrainScale = { value: new Vector2(1 / TILE_MM.along, 1 / TILE_MM.across) };
    shader.uniforms.uBandColor = { value: band };
    Object.assign(shader.uniforms, slots);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERTEX_HEAD + SLOT_VERTEX_HEAD)
      .replace('#include <begin_vertex>', SLOT_VERTEX_BODY)
      .replace('#include <uv_vertex>', VERTEX_UV);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAGMENT_HEAD + SLOT_FRAGMENT_HEAD)
      .replace('#include <map_fragment>', FRAGMENT_MAP);
  };
  material.customProgramCacheKey = () => 'nittcam-stock';
}

/** Edge lines follow the lift of their part (T155); no highlight on the lines. */
export function patchLines(material: Material, slots: SlotUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, slots);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${SLOT_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', SLOT_VERTEX_BODY);
  };
  material.customProgramCacheKey = () => 'nittcam-edges';
}

function texture(look: MaterialLook, base: string): DataTexture {
  const t = new DataTexture(materialPixels(look, base), TEXTURE_SIZE, TEXTURE_SIZE, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Part and waste materials of one stock. The waste is the same board one step lighter, so the
 * parts read as pieces without leaving the material's colour family.
 */
export function stockMaterials(
  look: MaterialLook,
  base: string,
  bandColor: string,
  simple: boolean,
  slots: SlotUniforms,
): StockMaterials {
  const band = new Color(bandColor);
  const offset = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  if (simple) {
    const part = new MeshLambertMaterial({ color: base, ...offset });
    const waste = new MeshLambertMaterial({
      color: new Color(base).lerp(new Color(1, 1, 1), 0.12),
      ...offset,
    });
    patch(part, band, slots);
    patch(waste, band, slots);
    return {
      part,
      waste,
      dispose: () => {
        part.dispose();
        waste.dispose();
      },
    };
  }
  const map = texture(look, base);
  const { roughness, metalness } = surfaceOf(look);
  const part = new MeshStandardMaterial({ map, roughness, metalness, ...offset });
  const waste = new MeshStandardMaterial({
    map,
    roughness,
    metalness,
    color: new Color(1, 1, 1).multiplyScalar(1.08),
    ...offset,
  });
  patch(part, band, slots);
  patch(waste, band, slots);
  return {
    part,
    waste,
    dispose: () => {
      map.dispose();
      part.dispose();
      waste.dispose();
    },
  };
}
