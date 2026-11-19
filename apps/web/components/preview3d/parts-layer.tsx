'use client';

/**
 * Parts and waste of one sheet in the 3D scene (T153). Geometry comes as plain data from
 * `lib/preview3d/sheet-scene.ts`; here it only becomes GPU buffers: one instanced mesh per
 * shared shape, one merged mesh for single copies, the waste slab and one line set for edges.
 * Lives in the sheet frame (the parent group maps it to the world).
 */
import type { Project } from '@nittcam/core';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
  type InstancedMesh,
  type Material,
} from 'three';
import type { MeshData } from '../../lib/preview3d/part-mesh';
import { buildSheetScene, type InstanceRef } from '../../lib/preview3d/sheet-scene';

export interface PartsLayerProps {
  project: Project;
  sheet: number;
  partMaterial: Material;
  wasteMaterial: Material;
  edgeColor: string;
}

export function PartsLayer({
  project,
  sheet,
  partMaterial,
  wasteMaterial,
  edgeColor,
}: PartsLayerProps) {
  const scene = useMemo(() => buildSheetScene(project, sheet), [project, sheet]);
  const edges = useMemo(() => {
    const all = new Float32Array(scene.edges.length + scene.waste.edges.length);
    all.set(scene.edges, 0);
    all.set(scene.waste.edges, scene.edges.length);
    return all;
  }, [scene]);
  return (
    <group>
      <MeshFromData data={scene.waste} material={wasteMaterial} name="waste" />
      {scene.merged ? (
        <MeshFromData data={scene.merged} material={partMaterial} name="parts-merged" />
      ) : null}
      {scene.instanced.map((g) => (
        <Instanced key={g.shape} data={g.mesh} refs={g.instances} material={partMaterial} />
      ))}
      <Lines positions={edges} color={edgeColor} />
    </group>
  );
}

function useGeometry(data: MeshData): BufferGeometry {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new BufferAttribute(data.normals, 3));
    g.setIndex(new BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    return g;
  }, [data]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

function MeshFromData({
  data,
  material,
  name,
}: {
  data: MeshData;
  material: Material;
  name: string;
}) {
  const geometry = useGeometry(data);
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
  const geometry = useGeometry(data);
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

/** Thin edge lines (technical-drawing feel), one draw call. */
function Lines({ positions, color }: { positions: Float32Array; color: string }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.85} />
    </lineSegments>
  );
}
