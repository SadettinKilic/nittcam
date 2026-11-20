'use client';

/**
 * Parts and waste of one sheet in the 3D scene (T153). Geometry comes as plain data from
 * `lib/preview3d/sheet-scene.ts`; here it only becomes GPU buffers: one instanced mesh per
 * shared shape, one merged mesh for single copies, the waste slab and one line set for edges.
 * Lives in the sheet frame (the parent group maps it to the world).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  LineBasicMaterial,
  Matrix4,
  Quaternion,
  Vector3,
  type InstancedMesh,
  type Material,
} from 'three';
import type { MeshData } from '../../lib/preview3d/part-mesh';
import { BAND_ATTRIBUTE, GRAIN_ATTRIBUTE, patchLines } from './materials';
import { SLOT_ATTRIBUTE, type SlotUniforms } from './slots';
import type { InstanceRef, SheetScene } from '../../lib/preview3d/sheet-scene';

export interface PartsLayerProps {
  /** Built by the scene from the project and sheet (`buildSheetScene`). */
  scene: SheetScene;
  partMaterial: Material;
  wasteMaterial: Material;
  edgeColor: string;
  slots: SlotUniforms;
  /** "Fireyi gizle" (T155). */
  hideWaste: boolean;
}

export function PartsLayer({
  scene,
  partMaterial,
  wasteMaterial,
  edgeColor,
  slots,
  hideWaste,
}: PartsLayerProps) {
  // Waste edges are left out with the waste (slot -1: never lifted).
  const edges = useMemo(() => {
    const n = scene.edges.length + (hideWaste ? 0 : scene.waste.edges.length);
    const all = new Float32Array(n);
    all.set(scene.edges, 0);
    const slotOf = new Float32Array(n / 3).fill(-1);
    slotOf.set(scene.edgeSlots, 0);
    if (!hideWaste) all.set(scene.waste.edges, scene.edges.length);
    return { positions: all, slots: slotOf };
  }, [scene, hideWaste]);
  return (
    <group>
      {hideWaste ? null : (
        <MeshFromData
          data={scene.waste}
          grain={scene.wasteGrain}
          slots={-1}
          material={wasteMaterial}
          name="waste"
        />
      )}
      {scene.merged ? (
        <MeshFromData
          data={scene.merged}
          grain={scene.mergedGrain ?? 0}
          slots={scene.mergedSlots ?? -1}
          material={partMaterial}
          name="parts-merged"
        />
      ) : null}
      {scene.instanced.map((g) => (
        <Instanced key={g.shape} data={g.mesh} refs={g.instances} material={partMaterial} />
      ))}
      <Lines positions={edges.positions} slots={edges.slots} color={edgeColor} uniforms={slots} />
    </group>
  );
}

const RAD = Math.PI / 180;

/**
 * GPU geometry of a mesh plus the shader attributes of the stock material: the edge-band flag
 * per vertex and the grain direction (degrees in the data, radians on the GPU), either per
 * vertex (`Float32Array`, merged parts), constant (waste) or per instance (`instanced`).
 */
function useGeometry(
  data: MeshData,
  grain: Float32Array | number,
  slots: Float32Array | number,
  instanced?: readonly InstanceRef[],
): BufferGeometry {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new BufferAttribute(data.normals, 3));
    g.setAttribute(BAND_ATTRIBUTE, new BufferAttribute(data.bands, 1));
    if (instanced) {
      const a = new Float32Array(instanced.map((r) => r.grain * RAD));
      g.setAttribute(GRAIN_ATTRIBUTE, new InstancedBufferAttribute(a, 1));
      const sl = new Float32Array(instanced.map((r) => r.slot));
      g.setAttribute(SLOT_ATTRIBUTE, new InstancedBufferAttribute(sl, 1));
    } else {
      const n = data.positions.length / 3;
      const a =
        typeof grain === 'number'
          ? new Float32Array(n).fill(grain * RAD)
          : Float32Array.from(grain, (d) => d * RAD);
      g.setAttribute(GRAIN_ATTRIBUTE, new BufferAttribute(a, 1));
      const sl = typeof slots === 'number' ? new Float32Array(n).fill(slots) : slots;
      g.setAttribute(SLOT_ATTRIBUTE, new BufferAttribute(sl, 1));
    }
    g.setIndex(new BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    return g;
  }, [data, grain, slots, instanced]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

function MeshFromData({
  data,
  grain,
  slots,
  material,
  name,
}: {
  data: MeshData;
  grain: Float32Array | number;
  slots: Float32Array | number;
  material: Material;
  name: string;
}) {
  const geometry = useGeometry(data, grain, slots);
  return <mesh geometry={geometry} material={material} name={name} />;
}

const Z = new Vector3(0, 0, 1);

function Instanced({
  data,
  refs,
  material,
}: {
  data: MeshData;
  refs: InstanceRef[];
  material: Material;
}) {
  const geometry = useGeometry(data, 0, 0, refs);
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const q = new Quaternion();
    const mat = new Matrix4();
    const one = new Vector3(1, 1, 1);
    refs.forEach((r, i) => {
      q.setFromAxisAngle(Z, (r.transform.rot * Math.PI) / 180);
      mat.compose(new Vector3(r.transform.tx, r.transform.ty, 0), q, one);
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [refs]);
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, refs.length]}
      geometry={geometry}
      material={material}
      name="parts-instanced"
      // The count is fixed by args; a new count remounts through the key of the shape group.
      key={refs.length}
    />
  );
}

/** Thin edge lines (technical-drawing feel), one draw call; they rise with their part. */
function Lines({
  positions,
  slots,
  color,
  uniforms,
}: {
  positions: Float32Array;
  slots: Float32Array;
  color: string;
  uniforms: SlotUniforms;
}) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setAttribute(SLOT_ATTRIBUTE, new BufferAttribute(slots, 1));
    return g;
  }, [positions, slots]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => {
    const m = new LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
    patchLines(m, uniforms);
    return m;
  }, [color, uniforms]);
  useEffect(() => () => material.dispose(), [material]);
  return <lineSegments geometry={geometry} material={material} />;
}
