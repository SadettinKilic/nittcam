'use client';

/**
 * "Montaj görünümü" (T158, spec §3.8): the boards of each generated cabinet standing in their box
 * positions, cabinets side by side with a gap. Boards only, no joinery. Part of the lazy 3D chunk
 * (loaded by `preview3d.tsx` with `next/dynamic` when the view opens).
 * Frame: x right, y up from the floor, z from the back to the front (the generator's frame).
 */
import { Edges, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Capture, type CaptureFn } from './capture';
import { BufferAttribute, BufferGeometry, Matrix4, NeutralToneMapping } from 'three';
import type { AssemblyBox, Part } from '@nittcam/core';
import {
  assemblyFaceMatrix,
  hasFaceFeatures,
  type CabinetGroup,
} from '../../lib/preview3d/assembly';
import { cachedPartMesh } from '../../lib/preview3d/sheet-scene';
import type { MeshData } from '../../lib/preview3d/part-mesh';
import type { SceneColors } from './scene';
import { fittedPosition, type Vec3 } from '../../lib/preview3d/camera';
import { installThreeConsole } from '../../lib/preview3d/three-console';

// B44 (D-080): drop fiber's THREE.Clock deprecation warning; all other three messages stay.
installThreeConsole();

/** Gap between two cabinets, mm. */
export const CABINET_GAP = 300;
const FOV = 35;
/** First view: isometric from the front left (B44: distance fitted to the whole row). */
const VIEW_DIR: Vec3 = [-0.45, 0.45, 0.77];
/** Door: opaque enough to read closed, the shelves behind still show (B44). */
const DOOR_OPACITY = 0.7;

export interface AssemblySceneProps {
  groups: readonly CabinetGroup[];
  colors: SceneColors;
  base: string;
  simple: boolean;
  onCapture?: (fn: CaptureFn | null) => void;
}

/** x offset of each cabinet and the overall size (cabinets in a row, bottoms on the floor). */
export function rowLayout(groups: readonly CabinetGroup[]) {
  let x = 0;
  const offsets: number[] = [];
  let h = 0;
  let d = 0;
  for (const g of groups) {
    offsets.push(x);
    x += g.assembly.width + CABINET_GAP;
    h = Math.max(h, g.assembly.height);
    d = Math.max(d, g.assembly.depth);
  }
  return { offsets, width: Math.max(0, x - CABINET_GAP), height: h, depth: d };
}

export default function AssemblyScene({
  groups,
  colors,
  base,
  simple,
  onCapture,
}: AssemblySceneProps) {
  const row = useMemo(() => rowLayout(groups), [groups]);
  const span = Math.max(row.width, row.height, row.depth, 1);
  const target: [number, number, number] = [row.width / 2, row.height / 2, row.depth / 2];
  // Isometric from the front left, far enough to see the whole row.
  const dist = (span / 2 / Math.tan(((FOV / 2) * Math.PI) / 180)) * 1.5;
  const position: [number, number, number] = [
    target[0] - dist * 0.45,
    target[1] + dist * 0.45,
    target[2] + dist * 0.77,
  ];
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      camera={{ fov: FOV, near: 1, far: span * 40, position }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping;
        gl.setClearColor(0x000000, 0);
      }}
      data-testid="preview3d-assembly-canvas"
    >
      <hemisphereLight args={['#ffffff', colors.table, 1.6]} />
      <directionalLight position={[-span, span * 1.5, span]} intensity={1.4} />
      <directionalLight position={[span, span * 0.5, -span]} intensity={0.35} />
      <mesh position={[row.width / 2, -1, row.depth / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[row.width + 2 * CABINET_GAP, row.depth + 2 * CABINET_GAP]} />
        <meshStandardMaterial color={colors.table} roughness={0.95} />
      </mesh>
      {groups.map((g, i) => (
        <group key={g.group} position={[row.offsets[i] ?? 0, 0, 0]} name={g.group}>
          {g.assembly.boxes.map((b, k) => {
            const part = g.parts.get(b.id);
            if (part && hasFaceFeatures(part))
              return (
                <FeaturedBoard
                  key={`${b.id}-${k}`}
                  box={b}
                  part={part}
                  width={g.assembly.width}
                  base={base}
                  stroke={colors.partStroke}
                  simple={simple}
                />
              );
            return (
              <mesh
                key={`${b.id}-${k}`}
                position={[b.x + b.sx / 2, b.y + b.sy / 2, b.z + b.sz / 2]}
                name={b.role}
              >
                <boxGeometry args={[b.sx, b.sy, b.sz]} />
                <meshStandardMaterial
                  color={base}
                  roughness={simple ? 1 : 0.7}
                  // Doors see-through, so the shelves behind them stay visible.
                  transparent={b.role === 'door'}
                  opacity={b.role === 'door' ? DOOR_OPACITY : 1}
                  depthWrite={b.role !== 'door'}
                />
                {simple && b.role !== 'door' ? null : <Edges color={colors.partStroke} />}
              </mesh>
            );
          })}
        </group>
      ))}
      <FitCamera target={target} row={row} />
      <Capture onCapture={onCapture} />
      <OrbitControls
        makeDefault
        target={target}
        minDistance={100}
        maxDistance={span * 10}
        maxPolarAngle={Math.PI * 0.49}
      />
    </Canvas>
  );
}

/**
 * B44: the first camera fits the whole row of cabinets for the canvas aspect (the bottom was
 * clipped with the fixed distance). Re-fits on a new aspect or a new row size only.
 */
function FitCamera({
  target,
  row,
}: {
  target: [number, number, number];
  row: { width: number; height: number; depth: number };
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as {
    target?: { set: (...v: number[]) => void };
    update?: () => void;
  } | null;
  const invalidate = useThree((s) => s.invalidate);
  const aspect = size.width / Math.max(1, size.height);
  const aspectKey = Math.round(aspect * 100);
  const [tx, ty, tz] = target;
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    const box = { hx: row.width / 2, hy: row.height / 2, hz: row.depth / 2 };
    const pos = fittedPosition([tx, ty, tz], VIEW_DIR, box, FOV, aspect);
    camera.position.set(...pos);
    camera.lookAt(tx, ty, tz);
    controls?.target?.set(tx, ty, tz);
    controls?.update?.();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fit on values, not identities
  }, [aspectKey, row.width, row.height, row.depth, controls]);
  return null;
}

/** Geometry of a part mesh (T153 data), shared by every box of the same shape (cache below). */
const geometries = new WeakMap<MeshData, { mesh: BufferGeometry; edges: BufferGeometry }>();

function geometryOf(data: MeshData) {
  const hit = geometries.get(data);
  if (hit) return hit;
  const mesh = new BufferGeometry();
  mesh.setAttribute('position', new BufferAttribute(data.positions, 3));
  mesh.setAttribute('normal', new BufferAttribute(data.normals, 3));
  mesh.setIndex(new BufferAttribute(data.indices, 1));
  mesh.computeBoundingSphere();
  const edges = new BufferGeometry();
  edges.setAttribute('position', new BufferAttribute(data.edges, 3));
  const out = { mesh, edges };
  geometries.set(data, out);
  return out;
}

/**
 * A board with openings, holes, pockets or template instances (T285): the T153 part mesh (cached
 * per part shape, so 300 parts stay within the T159 budget) turned onto its assembled box with the
 * machined face where the work is done (`assemblyFaceMatrix`). Doors stay see-through; the
 * contour lines (holes included) are drawn opaque so the hinge cups read through the door.
 */
function FeaturedBoard({
  box,
  part,
  width,
  base,
  stroke,
  simple,
}: {
  box: AssemblyBox;
  part: Part;
  width: number;
  base: string;
  stroke: string;
  simple: boolean;
}) {
  const thickness = boardThickness(box);
  const data = useMemo(() => cachedPartMesh(part, thickness), [part, thickness]);
  const geo = useMemo(() => geometryOf(data), [data]);
  const matrix = useMemo(
    () => new Matrix4().fromArray(assemblyFaceMatrix(box, width)),
    [box, width],
  );
  const door = box.role === 'door';
  return (
    <group matrixAutoUpdate={false} matrix={matrix} name={box.role}>
      <mesh geometry={geo.mesh} userData={{ t285: true }}>
        <meshStandardMaterial
          color={base}
          roughness={simple ? 1 : 0.7}
          transparent={door}
          opacity={door ? DOOR_OPACITY : 1}
          depthWrite={!door}
        />
      </mesh>
      {simple && !door ? null : (
        // A door's lines (outline, hinge cups on the inner face) draw over the door itself, so
        // the cups read through it (B44); renderOrder puts them after the see-through board.
        <lineSegments geometry={geo.edges} renderOrder={door ? 1 : 0}>
          <lineBasicMaterial color={stroke} depthTest={!door} />
        </lineSegments>
      )}
    </group>
  );
}

/** The board thickness of a box: its size across the board (sides along x, decks along y). */
export function boardThickness(box: AssemblyBox): number {
  if (box.role === 'side') return box.sx;
  if (box.role === 'top' || box.role === 'bottom' || box.role === 'shelf') return box.sy;
  return box.sz;
}
