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
import { installThreeConsole } from '../../lib/preview3d/three-console';
import { autoDowngradeOff, FpsWatch, feedSlowHook, slowHookFps } from '../../lib/preview3d/fps';
import { materialLook, type MaterialLook } from '../../lib/preview3d/textures';
import { stockMaterials } from './materials';
import { drawnParts, jobBox } from '../layout-view/model';
type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;
import {
  INTRO_MS,
  PRESET_MS,
  easeOut,
  interpolatePose,
  presetPose,
  sheetFrameBox,
  type CameraPose,
  type Vec3,
  type ViewPreset,
} from '../../lib/preview3d/camera';
import { PartsLayer } from './parts-layer';
import { Capture, type CaptureFn } from './capture';
import { ToolpathLayer } from './toolpath-layer';
import { endsReached, liftsAt, partLiftTimes } from '../../lib/preview3d/toolpath';
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
  /** Restore this pose (no ease) instead of the preset's, e.g. after a wizard step change (T160). */
  pose?: CameraPose;
  /** Frame the whole sheet ("Tümünü göster"); otherwise a small job is framed (B44 fit to job). */
  whole?: boolean;
}

export interface SceneProps {
  project: Project;
  sheet: number;
  /** T353: the V-bit of the V-grooves (their V section is drawn); omitted = not drawn. */
  vBit?: { angleDeg: number; tipDiameter: number } | undefined;
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
  /** Perf read-out of the last frame (T159; data attributes on the host for perf checks). */
  onStats?: (stats: SceneStats) => void;
  interaction: SceneInteraction;
  /** Toolpath overlay from the read program (T156) and the playback state (T157). */
  toolpath?: SceneToolpath | null;
  /** "Görüntü kaydet" (T160): filled with a frame grabber while the scene lives. */
  onCapture?: (fn: CaptureFn | null) => void;
}

/** Perf read-out of the scene (T159 budget: fps while orbiting, first frame, GPU memory). */
export interface SceneStats {
  drawCalls: number;
  /** Frame rate of the current continuous run of frames; null between runs. */
  fps: number | null;
  /** Live GPU geometries and textures (three.js `renderer.info.memory`). */
  geometries: number;
  textures: number;
  /** ms from the scene's first render (right after the chunk load) to its first drawn frame. */
  firstFrameMs: number;
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

// B44 (D-080): drop fiber's THREE.Clock deprecation warning; all other three messages stay.
installThreeConsole();

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
  const vAngle = props.vBit?.angleDeg;
  const vTip = props.vBit?.tipDiameter;
  const sheetScene = useMemo(
    () =>
      buildSheetScene(
        project,
        sheet,
        vAngle === undefined ? undefined : { angleDeg: vAngle, tipDiameter: vTip ?? 0 },
      ),
    [project, sheet, vAngle, vTip],
  );
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
  const { width: W, height: H } = stage.sheet;
  // B44 fit to job: on a small job the camera frames the parts, centred on them.
  const jobFrame = useMemo(() => {
    const b = jobBox(drawnParts(project, sheet), stage.sheet);
    if (!b) return null;
    return {
      box: sheetFrameBox(b, stage.thickness),
      target: [b.x + b.width / 2 - W / 2, 0, H / 2 - (b.y + b.height / 2)] as Vec3,
    };
  }, [project, sheet, stage, W, H]);
  const T = stage.thickness;
  // T157: during playback a copy lifts slightly once its outer contour has ended.
  const play = props.toolpath && props.toolpath.time !== null ? props.toolpath : null;
  const playSim = play?.sim ?? null;
  const liftTimes = useMemo(
    () => (playSim ? partLiftTimes(playSim, sheetScene.outlines) : null),
    [playSim, sheetScene.outlines],
  );
  const sortedEnds = useMemo(
    () => (liftTimes ? Float64Array.from(liftTimes).sort() : null),
    [liftTimes],
  );
  const reached = sortedEnds && play?.time != null ? endsReached(sortedEnds, play.time) : 0;
  const liftAmount = Math.max(2, T * 0.25);
  const playLifts = useMemo(
    () =>
      liftTimes && sortedEnds
        ? liftsAt(
            liftTimes,
            reached > 0 ? (sortedEnds[reached - 1] ?? -Infinity) : -Infinity,
            liftAmount,
          )
        : null,
    [liftTimes, sortedEnds, reached, liftAmount],
  );
  const ia = playLifts ? { ...props.interaction, lifts: playLifts } : props.interaction;
  const [ox, oy] = ia.offset;
  const tb = stage.table;
  const span = Math.max(W, H, tb.w, tb.h);
  // A stable array: drei's ContactShadows rebuilds (and leaks) its render targets on a new
  // `scale` identity, so a fresh array per render grew GPU memory on every camera preset (T159).
  const shadowScale = useMemo(() => [W * 1.15, H * 1.15] as [number, number], [W, H]);

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
      {/* Hidden, not unmounted, in Basit mod: drei never frees its render targets (T159). */}
      <group visible={!simple}>
        <ContactShadows
          key={`${W}x${H}x${T}`}
          position={[ox, 0.5, -oy]}
          scale={shadowScale}
          far={Math.max(T * 4, 60)}
          blur={2.2}
          opacity={0.45}
          resolution={512}
          frames={1}
          color={colors.shadow}
        />
      </group>
      <Rig {...props} box={sheetFrameBox(stage.sheet, T)} job={jobFrame} />
      <Capture onCapture={props.onCapture} />
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
  simple,
  box,
  job,
}: SceneProps & {
  box: ReturnType<typeof sheetFrameBox>;
  job: { box: ReturnType<typeof sheetFrameBox>; target: Vec3 } | null;
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const controls = useRef<OrbitControlsImpl>(null);
  const fps = useRef(new FpsWatch());
  // T159: first frame after the chunk load (the scene's first render) and the slow-test clock.
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);
  const firstFrame = useRef(-1);
  const fakeClock = useRef(0);
  // Basit mod on (by hand or by the watch): arm the watch again; a second slow run → 2D (§3.8).
  useEffect(() => fps.current.reset(), [simple]);
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
  const jobKey = job
    ? `${job.target.map(Math.round).join()},${Math.round(job.box.hx)},${Math.round(job.box.hz)}`
    : '';
  useEffect(() => {
    if (!ready) return;
    const fresh = handled.current !== command.nonce;
    if (!fresh && touched.current) return;
    handled.current = command.nonce;
    touched.current = false;
    const frame = (p: ViewPreset) =>
      job && !command.whole
        ? presetPose(p, job.box, FOV, aspect, job.target)
        : presetPose(p, box, FOV, aspect);
    const to = command.pose ?? frame(command.preset);
    const running = anim.current;
    if (!fresh) {
      if (running) running.to = to;
      else apply(to);
      invalidate();
      return;
    }
    const from = command.from ? frame(command.from) : currentPose();
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
  }, [ready, command.nonce, box.hx, box.hy, box.hz, aspectKey, jobKey]);

  useFrame(() => {
    const a = anim.current;
    if (a) {
      const k = Math.min(1, (performance.now() - a.start) / a.ms);
      apply(interpolatePose(a.from, a.to, easeOut(k)));
      if (k < 1) invalidate();
      else anim.current = null;
    }
    const now = performance.now();
    if (firstFrame.current < 0) firstFrame.current = now - mountedAt.current;
    const fake = slowHookFps();
    // The test hook feeds a whole 3 s window per real frame, so the slow chain (Basit mod, then
    // 2D) needs only two real frames, however slowly a CPU-rendered CI canvas draws them.
    let slow: boolean;
    if (fake) {
      const fed = feedSlowHook(fps.current, fakeClock.current, fake);
      fakeClock.current = fed.clock;
      slow = fed.slow;
    } else {
      slow = fps.current.frame(now);
      // Test switch: the real rate is still read out (data-fps) but never downgrades the view.
      if (slow && autoDowngradeOff()) {
        fps.current.reset();
        slow = false;
      }
    }
    if (slow) onSlow?.();
    if (fake) invalidate(); // the test hook keeps frames coming until the watch fires
    onStats?.({
      drawCalls: gl.info.render.calls,
      fps: fps.current.rate(),
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      firstFrameMs: Math.round(firstFrame.current),
    });
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
