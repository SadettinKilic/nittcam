/**
 * Per-copy state the patched shaders read (T155, T157): a lift in mm per copy slot (a float
 * texture, so playback can raise single parts without rebuilding buffers), a common "ayır/kaldır"
 * lift, and the hovered / selected slot for the highlight. One instance per scene; the uniform
 * objects are shared by reference with every material that is patched with them.
 */
import { Color, DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';

/** Texture row width; slots wrap to the next row. */
export const SLOT_ROW = 256;

export interface SlotUniforms {
  uSlotTex: { value: DataTexture };
  uExplode: { value: number };
  uHover: { value: number };
  uSelect: { value: number };
  uHiColor: { value: Color };
}

export class SlotState {
  readonly uniforms: SlotUniforms;
  private data: Float32Array;

  constructor(count: number, highlight: string) {
    const rows = Math.max(1, Math.ceil(count / SLOT_ROW));
    this.data = new Float32Array(SLOT_ROW * rows * 4);
    const tex = new DataTexture(this.data, SLOT_ROW, rows, RGBAFormat, FloatType);
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.needsUpdate = true;
    this.uniforms = {
      uSlotTex: { value: tex },
      uExplode: { value: 0 },
      uHover: { value: -1 },
      uSelect: { value: -1 },
      uHiColor: { value: new Color(highlight) },
    };
  }

  /** Common lift (mm) and the selected slot. */
  setView(explode: number, selected: number): void {
    this.uniforms.uExplode.value = explode;
    this.uniforms.uSelect.value = selected;
  }

  setHover(slot: number): void {
    this.uniforms.uHover.value = slot;
  }

  /** Lift (mm) of one slot; returns true when it changed. */
  setLift(slot: number, mm: number): boolean {
    const i = slot * 4;
    if (i < 0 || i >= this.data.length || this.data[i] === mm) return false;
    this.data[i] = mm;
    this.uniforms.uSlotTex.value.needsUpdate = true;
    return true;
  }

  /** Lifts of all slots at once (playback); missing entries are 0. */
  setLifts(lifts: ArrayLike<number> | null): void {
    let changed = false;
    const n = this.data.length / 4;
    for (let s = 0; s < n; s++) {
      const v = lifts?.[s] ?? 0;
      if (this.data[s * 4] !== v) {
        this.data[s * 4] = v;
        changed = true;
      }
    }
    if (changed) this.uniforms.uSlotTex.value.needsUpdate = true;
  }

  dispose(): void {
    this.uniforms.uSlotTex.value.dispose();
  }
}

/** Vertex attribute with the copy slot (-1 = not a part, e.g. the waste). */
export const SLOT_ATTRIBUTE = 'aSlot';

/** Declarations for a vertex shader that lifts by slot. */
export const SLOT_VERTEX_HEAD = /* glsl */ `
attribute float aSlot;
uniform sampler2D uSlotTex;
uniform float uExplode;
uniform float uHover;
uniform float uSelect;
varying float vHi;
float slotLift() {
  if (aSlot < 0.0) return 0.0;
  int s = int(aSlot + 0.5);
  return texelFetch(uSlotTex, ivec2(s % ${SLOT_ROW}, s / ${SLOT_ROW}), 0).r + uExplode;
}`;

/** After `begin_vertex`: raise the vertex by its slot lift and pass the highlight. */
export const SLOT_VERTEX_BODY = /* glsl */ `#include <begin_vertex>
transformed.z += slotLift();
vHi = aSlot < 0.0 ? 0.0 : max(abs(aSlot - uSelect) < 0.5 ? 1.0 : 0.0, abs(aSlot - uHover) < 0.5 ? 0.55 : 0.0);`;

export const SLOT_FRAGMENT_HEAD = /* glsl */ `
uniform vec3 uHiColor;
varying float vHi;`;

/** After the colour is known: tint toward the highlight colour. */
export const SLOT_FRAGMENT_BODY = /* glsl */ `
diffuseColor.rgb = mix(diffuseColor.rgb, uHiColor, 0.45 * vHi);`;
