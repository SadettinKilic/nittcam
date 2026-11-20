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
import { sheetSizeOf, type Project, type SimSheet } from '@nittcam/core';
import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { NeutralToneMapping, Plane, Vector3, type PerspectiveCamera } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { buildSheetScene, pickSlot, type SheetScene } from '../../lib/preview3d/sheet-scene';
import { SlotState } from './slots';
import { FpsWatch } from '../../lib/preview3d/fps';
import { materialLook, type MaterialLook } from '../../lib/preview3d/textures';
import { stockMaterials } from './materials';
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
import { ToolpathLayer } from './toolpath-layer';
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
  /** Edge band colour (T154). */
  band: string;
  /** Base tone per stock material (T154). */
  materials: Record<MaterialLook, string>;
  /** Tool and rapid colours shared with the 2D simulation (T154; used by T156/T157). */
  simTool: string;
  simRapid: string;
  simDepthTop: string;
  simDepthBottom: string;
  /** Hover / selection tint of a part (T155). */
  highlight: string;
}

/** View-only interaction state of the host (T155); never written to the project. */
export interface SceneInteraction {
  /** Common lift of every part, mm ("ayır/kaldır"). */
  explode: number;
  hideWaste: boolean;
  /** Dragging on the sheet moves it on the table instead of orbiting. */
  moveSheet: boolean;
  /** Sheet offset on the table, sheet frame mm (view only). */
  offset: readonly [number, number];
  onOffset: (offset: [number, number]) => void;
  /** Selected copy slot (-1 = none). */
  selected: number;
  onSelect: (slot: number) => void;
  onHover?: (slot: number) => void;
  /** Per-slot extra lift, mm (cutting playback, T157). */
  lifts?: ArrayLike<number> | null;
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
  /** "Basit mod" (T154): flat colours, no texture, no shadows. */
  simple: boolean;
  /** The frame rate stayed under 30 fps for 3 s (D-033): the host turns on Basit mod. */
  onSlow?: () => void;
  command: CameraCommand;
  /** Every camera change: the world-inverse matrix (view cube) and the pose (read-outs). */
  onCamera: (viewInverse: ArrayLike<number>, pose: CameraPose) => void;
  /** Draw calls of the last frame (for perf checks; data attribute on the host). */
  onStats?: (drawCalls: number) => void;
  interaction: SceneInteraction;
  /** Toolpath overlay from the read program (T156) and the playback state (T157). */
  toolpath?: SceneToolpath | null;
}

export interface SceneToolpath {
  sim: SimSheet;
  /** Playback time, s; null = the whole program, no tool model. */
  time: number | null;
  /** Draw the path lines (the "Takım yolu" toggle); the tool model stays. Default true. */
  path?: boolean;
  tool?: { x: number; y: number; z: number; diameter: number } | null;
}

const FOV = 35;

export default function Scene(props: SceneProps) {
  const { project, sheet, table, colors, simple } = props;
  const stock = project.stock;
  // each layout sheet has its own size with several stock sizes (T164)
  const size = sheetSizeOf(project, sheet);
  const stage = useMemo(
    () => buildStage(size, stock.thickness, table),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the size's values, not its identity
    [size.width, size.height, size.grain, stock.thickness, table],
  );
  const look = materialLook(stock.material);
  const base = colors.materials[look];
  const sheetScene = useMemo(() => buildSheetScene(project, sheet), [project, sheet]);
  const slots = useMemo(
    () => new SlotState(sheetScene.parts, colors.highlight),
    [sheetScene.parts, colors.highlight],
  );
  useEffect(() => () => slots.dispose(), [slots]);
  const materials = useMemo(
    () => stockMaterials(look, base, colors.band, simple, slots.uniforms),
    [look, base, colors.band, simple, slots],
  );
  useEffect(() => () => materials.dispose(), [materials]);
  const ia = props.interaction;
  const [ox, oy] = ia.offset;
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
          <group position={[ox, oy, 0]}>
            <PartsLayer
              scene={sheetScene}
              partMaterial={materials.part}
              wasteMaterial={materials.waste}
              edgeColor={colors.partStroke}
              slots={slots.uniforms}
              hideWaste={ia.hideWaste}
            />
            <PickPlane
              scene={sheetScene}
              slots={slots}
              width={W}
              height={H}
              top={T}
              interaction={ia}
            />
            {props.toolpath ? (
              <ToolpathLayer
                sim={props.toolpath.sim}
                top={T}
                time={props.toolpath.time}
                tool={props.toolpath.tool}
                path={props.toolpath.path !== false}
                colors={{
                  depthTop: colors.simDepthTop,
                  depthBottom: colors.simDepthBottom,
                  rapid: colors.simRapid,
                  tool: colors.simTool,
                }}
              />
            ) : null}
          </group>
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
      {simple ? null : (
        <ContactShadows
          key={`${W}x${H}x${T}`}
          position={[ox, 0.5, -oy]}
          scale={[W * 1.15, H * 1.15]}
          far={Math.max(T * 4, 60)}
          blur={2.2}
          opacity={0.45}
          resolution={512}
          frames={1}
          color={colors.shadow}
        />
      )}
      <Rig {...props} box={sheetFrameBox(stage.sheet, T)} />
    </Canvas>
  );
}

/** Orbit controls off while the sheet is dragged (outside the component: no hook value mutation). */
function setEnabled(controls: { enabled: boolean } | null, on: boolean): void {
  if (controls) controls.enabled = on;
}

/**
 * Picking and sheet dragging (T155) on an invisible plane at the sheet top: a 2-triangle ray cast
 * per pointer event, then a 2D point-in-outline test (`pickSlot`). Also pushes the interaction
 * state into the slot uniforms and asks for a frame when it changes (render on demand).
 */
function PickPlane({
  scene,
  slots,
  width,
  height,
  top,
  interaction: ia,
}: {
  scene: SheetScene;
  slots: SlotState;
  width: number;
  height: number;
  top: number;
  interaction: SceneInteraction;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const drag = useRef<{ plane: Plane; start: Vector3; offset: readonly [number, number] } | null>(
    null,
  );
  const hover = useRef(-1);

  useEffect(() => {
    slots.setView(ia.explode, ia.selected);
    slots.setLifts(ia.lifts ?? null);
    invalidate();
  }, [slots, ia.explode, ia.selected, ia.lifts, invalidate]);

  function setHover(slot: number) {
    if (hover.current === slot) return;
    hover.current = slot;
    slots.setHover(slot);
    ia.onHover?.(slot);
    invalidate();
  }
  // e.point is in world space; the plane mesh's local frame is the sheet frame (z = top).
  function slotAt(e: ThreeEvent<PointerEvent | MouseEvent>): number {
    const p = e.object.worldToLocal(e.point.clone());
    return pickSlot(scene.outlines, p.x, p.y);
  }
  function hitOnPlane(e: ThreeEvent<PointerEvent>, plane: Plane): Vector3 | null {
    return e.ray.intersectPlane(plane, new Vector3());
  }

  return (
    <mesh
      position={[width / 2, height / 2, top + ia.explode]}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) {
          const hit = hitOnPlane(e, d.plane);
          if (!hit) return;
          // world (x, z) ↔ sheet frame (x, −y)
          ia.onOffset([
            Math.round(d.offset[0] + hit.x - d.start.x),
            Math.round(d.offset[1] - (hit.z - d.start.z)),
          ]);
          return;
        }
        setHover(slotAt(e));
      }}
      onPointerOut={() => {
        if (!drag.current) setHover(-1);
      }}
      onPointerDown={(e) => {
        if (!ia.moveSheet || e.button !== 0) return;
        e.stopPropagation();
        const plane = new Plane(new Vector3(0, 1, 0), -e.point.y);
        drag.current = { plane, start: e.point.clone(), offset: ia.offset };
        setEnabled(controls, false);
        (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        drag.current = null;
        setEnabled(controls, true);
        (e.target as Element | null)?.releasePointerCapture?.(e.pointerId);
      }}
      onClick={(e) => {
        if (ia.moveSheet) return;
        e.stopPropagation();
        const s = slotAt(e);
        ia.onSelect(s === ia.selected ? -1 : s);
      }}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
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
  onSlow,
  box,
}: SceneProps & { box: ReturnType<typeof sheetFrameBox> }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const controls = useRef<OrbitControlsImpl>(null);
  const fps = useRef(new FpsWatch());
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
    if (fps.current.frame(performance.now())) onSlow?.();
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
