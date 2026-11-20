'use client';

/**
 * "Montaj görünümü" (T158, spec §3.8): the boards of each generated cabinet standing in their box
 * positions, cabinets side by side with a gap. Boards only, no joinery. Part of the lazy 3D chunk
 * (loaded by `preview3d.tsx` with `next/dynamic` when the view opens).
 * Frame: x right, y up from the floor, z from the back to the front (the generator's frame).
 */
import { Edges, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import { Capture, type CaptureFn } from './capture';
import { NeutralToneMapping } from 'three';
import type { CabinetGroup } from '../../lib/preview3d/assembly';
import type { SceneColors } from './scene';

/** Gap between two cabinets, mm. */
export const CABINET_GAP = 300;
const FOV = 35;

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
          {g.assembly.boxes.map((b, k) => (
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
                opacity={b.role === 'door' ? 0.45 : 1}
                depthWrite={b.role !== 'door'}
              />
              {simple ? null : <Edges color={colors.partStroke} />}
            </mesh>
          ))}
        </group>
      ))}
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
