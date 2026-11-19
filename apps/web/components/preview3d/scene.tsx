'use client';

/**
 * The 3D preview scene (T152, spec §3.8, D-033). This module and everything it imports (`three`,
 * `@react-three/fiber`, `@react-three/drei`) form the lazy 3D chunk: only `preview3d.tsx` loads it,
 * through `next/dynamic`, when the user opens the 3D view.
 *
 * Studio look (Fable review #1): transparent canvas over a token gradient, neutral tone mapping,
 * soft hemisphere + key light, a fading ground grid, a contact shadow under the sheet and thin
 * edge lines on the parts. Render on demand: no frames while nothing moves.
 */
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Project } from '@nittcam/core';
import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { MeshStandardMaterial, NeutralToneMapping, type PerspectiveCamera } from 'three';
type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;
import {
  INTRO_MS,
  PRESET_MS,
  easeOut,
  interpolatePose,
  presetPose,
  sheetFrameBox,
  type CameraPose,
  type ViewPreset,
} from '../../lib/preview3d/camera';
import { PartsLayer } from './parts-layer';
import { TABLE_THICKNESS, buildStage, type TableSpec } from '../../lib/preview3d/stage';

/** Colours of the scene, read from the design tokens (never hard-coded; ui-conventions). */
export interface SceneColors {
  sheet: string;
  sheetEdge: string;
  part: string;
  partStroke: string;
  table: string;
  grid: string;
  gridSection: string;
  shadow: string;
}

export interface CameraCommand {
  preset: ViewPreset;
  /** Changes for every request, so the same preset can be asked twice. */
  nonce: number;
  /** Ease from the current pose (false = jump; always false with reduced motion). */
  animate: boolean;
  /** First open: start from this preset and ease to `preset` (T152: top → isometric). */
  from?: ViewPreset;
}

export interface SceneProps {
  project: Project;
  sheet: number;
  table: TableSpec | null;
  colors: SceneColors;
  reduced: boolean;
  command: CameraCommand;
  /** Every camera change: the world-inverse matrix (view cube) and the pose (read-outs). */
  onCamera: (viewInverse: ArrayLike<number>, pose: CameraPose) => void;
  /** Draw calls of the last frame (for perf checks; data attribute on the host). */
  onStats?: (drawCalls: number) => void;
}

const FOV = 35;

export default function Scene(props: SceneProps) {
  const { project, sheet, table, colors } = props;
  const stock = project.stock;
  const stage = useMemo(
    () => buildStage(stock.sheet, stock.thickness, table),
    [stock.sheet, stock.thickness, table],
  );
  const materials = useMemo(
    () => ({ part: matte(colors.part), waste: matte(colors.sheet) }),
    [colors.part, colors.sheet],
  );
  useEffect(
    () => () => {
      materials.part.dispose();
      materials.waste.dispose();
    },
    [materials],
  );
  const { width: W, height: H } = stage.sheet;
  const T = stage.thickness;
  const tb = stage.table;
  const span = Math.max(W, H, tb.w, tb.h);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      camera={{ fov: FOV, near: 1, far: span * 40, position: [0, span * 2, 1] }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping;
        gl.setClearColor(0x000000, 0);
      }}
      data-testid="preview3d-canvas"
    >
      <hemisphereLight args={['#ffffff', colors.table, 1.6]} />
      <directionalLight position={[-span * 0.6, span * 1.2, span * 0.8]} intensity={1.4} />
      <directionalLight position={[span * 0.8, span * 0.5, -span * 0.6]} intensity={0.35} />

      {/* Sheet frame (X right, Y back, Z up) → world (x, z, -y), sheet centre at the origin. */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <group position={[-W / 2, -H / 2, 0]}>
          <mesh position={[tb.x + tb.w / 2, tb.y + tb.h / 2, -TABLE_THICKNESS / 2]}>
            <boxGeometry args={[tb.w, tb.h, TABLE_THICKNESS]} />
            <meshStandardMaterial color={colors.table} roughness={0.95} metalness={0} />
          </mesh>
          <PartsLayer
            project={project}
            sheet={sheet}
            partMaterial={materials.part}
            wasteMaterial={materials.waste}
            edgeColor={colors.partStroke}
          />
        </group>
      </group>

      <Grid
        position={[0, -TABLE_THICKNESS - 1, 0]}
        args={[10, 10]}
        infiniteGrid
        cellSize={100}
        cellThickness={0.6}
        cellColor={colors.grid}
        sectionSize={1000}
        sectionThickness={1}
        sectionColor={colors.gridSection}
        fadeDistance={span * 4}
        fadeStrength={1.5}
        followCamera={false}
      />
      <ContactShadows
        key={`${W}x${H}x${T}`}
        position={[0, 0.5, 0]}
        scale={[W * 1.15, H * 1.15]}
        far={Math.max(T * 4, 60)}
        blur={2.2}
        opacity={0.45}
        resolution={512}
        frames={1}
        color={colors.shadow}
      />
      <Rig {...props} box={sheetFrameBox(stage.sheet, T)} />
    </Canvas>
  );
}

/** Matte, non-glossy surface; pushed back a hair so the edge lines draw on top. */
function matte(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/**
 * Camera rig: orbit controls (damping off with reduced motion), preset requests with a short
 * ease, the first-open ease from top to isometric, and the camera reports to the host.
 */
function Rig({
  command,
  reduced,
  onCamera,
  onStats,
  box,
}: SceneProps & { box: ReturnType<typeof sheetFrameBox> }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const controls = useRef<OrbitControlsImpl>(null);
  const anim = useRef<{ from: CameraPose; to: CameraPose; start: number; ms: number } | null>(null);
  const aspect = size.width / Math.max(1, size.height);

  function currentPose(): CameraPose {
    const t = controls.current?.target;
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: t ? [t.x, t.y, t.z] : [0, 0, 0],
    };
  }
  function report() {
    onCamera(camera.matrixWorldInverse.elements, currentPose());
  }
  function apply(pose: CameraPose) {
    camera.position.set(...pose.position);
    const c = controls.current;
    if (c) {
      c.target.set(...pose.target);
      c.update();
    } else camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
    report();
  }

  // Preset requests (and the first-open ease). A new canvas size (the first real measure, a
  // panel toggle) re-frames the current preset only while the user has not moved the camera.
  const handled = useRef<number | null>(null);
  const touched = useRef(false);
  const ready = size.width > 0 && size.height > 0;
  const aspectKey = Math.round(aspect * 100);
  useEffect(() => {
    if (!ready) return;
    const fresh = handled.current !== command.nonce;
    if (!fresh && touched.current) return;
    handled.current = command.nonce;
    touched.current = false;
    const to = presetPose(command.preset, box, FOV, aspect);
    const running = anim.current;
    if (!fresh) {
      if (running) running.to = to;
      else apply(to);
      invalidate();
      return;
    }
    const from = command.from ? presetPose(command.from, box, FOV, aspect) : currentPose();
    if (command.animate && !reduced) {
      if (command.from) apply(from);
      anim.current = {
        from,
        to,
        start: performance.now(),
        ms: command.from ? INTRO_MS : PRESET_MS,
      };
    } else {
      anim.current = null;
      apply(to);
    }
    invalidate();
    // Only a new request (nonce), a new sheet size or a new aspect re-frames the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, command.nonce, box.hx, box.hy, box.hz, aspectKey]);

  useFrame(() => {
    const a = anim.current;
    if (a) {
      const k = Math.min(1, (performance.now() - a.start) / a.ms);
      apply(interpolatePose(a.from, a.to, easeOut(k)));
      if (k < 1) invalidate();
      else anim.current = null;
    }
    onStats?.(gl.info.render.calls);
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={!reduced}
      dampingFactor={0.12}
      minDistance={50}
      maxDistance={box.hx * 40 + 2000}
      maxPolarAngle={Math.PI * 0.49}
      onStart={() => {
        anim.current = null;
        touched.current = true;
      }}
      onChange={report}
    />
  );
}
