'use client';

/**
 * Montaj tezgâhı 3D scene (T387, D-131). Part of the lazy bench chunk. Every part copy is one
 * mesh (geometry shared per part shape, materials shared per state), so 300 parts stay inside the
 * spec §3.8 budget with `frameloop="demand"`. The scene never writes the project: it reports
 * picks and finished drags; the host turns them into commands.
 * Frame: mm, y up, x right, z toward the viewer.
 */
import { OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  memo,
  useCallback,
  useLayoutEffect,
  type ComponentRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  DoubleSide,
  Group,
  LineBasicMaterial,
  Matrix3,
  MeshStandardMaterial,
  NeutralToneMapping,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { Capture, type CaptureFn } from '../preview3d/capture';
import type { MeshData } from '../../lib/preview3d/part-mesh';
import type { BenchItem } from '../../lib/preview3d/assembly-model';
import {
  boxCentre,
  cross,
  instanceMatrix,
  faceFrame,
  faceFromNormal,
  qFromBasis,
  slideOnFace,
  worldBounds,
  type BoxFace,
  type FaceFrame,
  type Pose,
  type V3,
} from '../../lib/preview3d/assembly-math';
import { fittedPosition, type Vec3 } from '../../lib/preview3d/camera';
import { FpsWatch } from '../../lib/preview3d/fps';
import { installThreeConsole } from '../../lib/preview3d/three-console';

installThreeConsole();

export type BenchMode = 'move' | 'rotate' | 'mate';
export type BenchView = 'top' | 'front' | 'right' | 'iso';
export type CameraCmd =
  | { kind: 'view'; view: BenchView; n: number }
  | { kind: 'fit'; n: number }
  | { kind: 'zoom'; dir: 1 | -1; n: number }
  /** Frame these world bounds from the current viewing direction (fit-check row, T388). */
  | { kind: 'frame'; min: V3; max: V3; n: number };

/** Fit-check marks (T388): red = overlap, orange = off-centre hole. */
export type BenchMark = 'danger' | 'warning';

export interface BenchColors {
  base: string;
  stroke: string;
  floor: string;
  grid: string;
  selection: string;
  /** The first face picked for a mate. */
  picked: string;
  /** Face under the pointer in mate mode / snapped edge. */
  hover: string;
  /** Fit check: overlapping parts. */
  danger: string;
}

export interface BenchSlide {
  id: string;
  frame: FaceFrame;
}

export interface BenchSceneProps {
  items: readonly BenchItem[];
  colors: BenchColors;
  simple: boolean;
  mode: BenchMode;
  selectedId: string | null;
  /** Mate step 1 done: A's picked face is highlighted. */
  pickedFace: { id: string; face: BoxFace } | null;
  slide: BenchSlide | null;
  /** Fit-check marks by item id (T388). */
  marks?: ReadonlyMap<string, BenchMark>;
  /** Rotation snap in degrees; 0 = free (Shift). */
  rotationStep: number;
  /** Move snap in mm; 0 = free (Shift). */
  moveStep: number;
  camera: CameraCmd;
  onSelect: (id: string | null) => void;
  onPick: (id: string, normal: V3, point: V3) => void;
  /** A gizmo or slide drag ended; false = the command was refused (the part goes back). */
  onCommit: (id: string, pose: Pose) => boolean;
  /** While sliding: which in-plane edges snap (feedback line). */
  onSnap: (snapped: boolean) => void;
  onCapture?: (fn: CaptureFn | null) => void;
  /** Perf read-out per frame (T159 style: fps of the current orbit run, draw calls). */
  onStats?: (stats: { fps: number | null; drawCalls: number }) => void;
}

const FOV = 35;
const VIEW_DIRS: Record<BenchView, Vec3> = {
  top: [0, 1, 0.0001],
  front: [0, 0, 1],
  right: [1, 0, 0],
  iso: [-0.45, 0.45, 0.77],
};
const DOOR_OPACITY = 0.7;

/** Geometry of a part mesh, shared by every copy of the same shape. */
const geometries = new WeakMap<MeshData, { mesh: BufferGeometry; edges: BufferGeometry }>();
function geometryOf(data: MeshData) {
  const hit = geometries.get(data);
  if (hit) return hit;
  const mesh = new BufferGeometry();
  mesh.setAttribute('position', new BufferAttribute(data.positions, 3));
  mesh.setAttribute('normal', new BufferAttribute(data.normals, 3));
  mesh.setIndex(new BufferAttribute(data.indices, 1));
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  const edges = new BufferGeometry();
  edges.setAttribute('position', new BufferAttribute(data.edges, 3));
  const out = { mesh, edges };
  geometries.set(data, out);
  return out;
}

/** Union of the world bounds of the given items (null when empty). */
export function itemsBounds(items: readonly BenchItem[]): { min: V3; max: V3 } | null {
  let out: { min: V3; max: V3 } | null = null;
  for (const it of items) {
    const b = worldBounds(it.pose, it.box);
    if (!out) out = { min: [...b.min], max: [...b.max] };
    else
      for (let k = 0; k < 3; k++) {
        out.min[k] = Math.min(out.min[k] ?? 0, b.min[k] ?? 0);
        out.max[k] = Math.max(out.max[k] ?? 0, b.max[k] ?? 0);
      }
  }
  return out;
}

export default function BenchScene(props: BenchSceneProps) {
  const bounds = useMemo(() => itemsBounds(props.items), [props.items]);
  const span = bounds
    ? Math.max(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
        500,
      )
    : 2000;
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      camera={{
        fov: FOV,
        near: 1,
        far: Math.max(200_000, span * 40),
        position: [-2000, 2000, 3000],
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping;
        gl.setClearColor(0x000000, 0);
      }}
      data-testid="bench-canvas"
    >
      <BenchContent {...props} bounds={bounds} span={span} />
    </Canvas>
  );
}

function BenchContent({
  items,
  colors,
  simple,
  mode,
  selectedId,
  pickedFace,
  slide,
  marks,
  rotationStep,
  moveStep,
  camera: cmd,
  onSelect,
  onPick,
  onCommit,
  onSnap,
  onCapture,
  onStats,
  bounds,
  span,
}: BenchSceneProps & { bounds: { min: V3; max: V3 } | null; span: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const cam = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    enabled: boolean;
    target: Vector3;
    update: () => void;
  } | null;

  // Shared materials (one per state), recoloured on a theme switch.
  // New materials on a theme switch (rare); the old ones are disposed.
  const mats = useMemo(() => benchMaterials(colors, simple), [colors, simple]);
  useEffect(() => {
    invalidate();
    return () => Object.values(mats).forEach((m) => m.dispose());
  }, [mats, invalidate]);

  // The selected copy's group, for the gizmo (callback ref → state).
  const [selObj, setSelObj] = useState<Group | null>(null);
  const tc = useRef<ComponentRef<typeof TransformControls> | null>(null);
  const lastDrag = useRef(0);
  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  // ---- slide on the mated face (T387) ----
  const [dragPose, setDragPose] = useState<{ id: string; pose: Pose } | null>(null);
  const startSlide = useCallback(
    (e: ThreeEvent<PointerEvent>, item: BenchItem) => {
      if (!slide || e.button !== 0) return;
      e.stopPropagation();
      const plane = new Plane().setFromNormalAndCoplanarPoint(
        new Vector3(...slide.frame.normal),
        e.point.clone(),
      );
      const start = e.point.clone();
      const ray = new Raycaster();
      const ndc = new Vector2();
      const hit = new Vector3();
      const drag = { last: item.pose };
      const ctl = get().controls as unknown as { enabled: boolean } | null;
      if (ctl) ctl.enabled = false;
      const move = (ev: PointerEvent) => {
        const r = gl.domElement.getBoundingClientRect();
        ndc.set(
          ((ev.clientX - r.left) / r.width) * 2 - 1,
          -((ev.clientY - r.top) / r.height) * 2 + 1,
        );
        ray.setFromCamera(ndc, cam);
        if (!ray.ray.intersectPlane(plane, hit)) return;
        const d = hit.clone().sub(start);
        const out = slideOnFace(item.pose, item.box, slide.frame, [d.x, d.y, d.z]);
        drag.last = out.pose;
        onSnap(out.snappedU || out.snappedV);
        setDragPose({ id: item.id, pose: out.pose });
        invalidate();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (ctl) ctl.enabled = true;
        lastDrag.current = performance.now();
        if (drag.last !== item.pose) onCommit(item.id, drag.last);
        setDragPose(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [slide, get, gl, cam, onSnap, onCommit, invalidate],
  );

  // ---- batching (spec §3.8 budget): one instanced mesh per part shape, one merged edge set;
  // the selected or dragged copy is drawn on its own (gizmo, highlight). ----
  const loneId = dragPose?.id ?? null;
  const { batches, single } = useMemo(() => {
    const map = new Map<
      MeshData,
      { key: string; mesh: MeshData; door: boolean; items: BenchItem[] }
    >();
    const lone: BenchItem[] = [];
    const doors = new Map<
      MeshData,
      { key: string; mesh: MeshData; door: boolean; items: BenchItem[] }
    >();
    for (const it of items) {
      if (it.id === selectedId || it.id === loneId || marks?.has(it.id)) {
        lone.push(it);
        continue;
      }
      const into = it.door ? doors : map;
      const b = into.get(it.mesh) ?? {
        key: `${it.door ? 'd' : 's'}:${it.id}`,
        mesh: it.mesh,
        door: it.door,
        items: [],
      };
      b.items.push(it);
      into.set(it.mesh, b);
    }
    return { batches: [...map.values(), ...doors.values()], single: lone };
  }, [items, selectedId, loneId, marks]);
  const edges = useMemo(
    () => mergedEdges(batches.flatMap((b) => (simple && !b.door ? [] : b.items))),
    [batches, simple],
  );
  useEffect(() => () => edges?.dispose(), [edges]);

  // ---- picking ----
  const [hover, setHover] = useState<{ id: string; face: BoxFace } | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const itemOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const ids = e.object.userData.ids as readonly string[] | undefined;
    const id =
      ids && e.instanceId !== undefined
        ? ids[e.instanceId]
        : (e.object.parent?.userData.id as string | undefined);
    return id ? byId.get(id) : undefined;
  };
  const worldNormal = (e: ThreeEvent<PointerEvent | MouseEvent>): V3 | null => {
    if (!e.face) return null;
    const m = e.object.matrixWorld.clone();
    if (e.object instanceof InstancedMesh && e.instanceId !== undefined) {
      const inst = new Matrix4();
      e.object.getMatrixAt(e.instanceId, inst);
      m.multiply(inst);
    }
    const n = e.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(m)).normalize();
    return [n.x, n.y, n.z];
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const item = itemOf(e);
    if (!item || e.delta > 4) return;
    e.stopPropagation();
    // A click that ends a gizmo drag (or lands on the gizmo) is not a pick.
    if (performance.now() - lastDrag.current < 250 || gizmoHot(tc.current)) return;
    if (mode === 'mate') {
      const n = worldNormal(e);
      if (n) onPick(item.id, n, [e.point.x, e.point.y, e.point.z]);
      return;
    }
    onSelect(item.id);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== 'mate') return;
    e.stopPropagation();
    const item = itemOf(e);
    const n = worldNormal(e);
    if (!item || !n) return;
    const face = faceFromNormal(item.pose.rotation, n);
    if (hover?.id !== item.id || hover.face.axis !== face.axis || hover.face.sign !== face.sign) {
      setHover({ id: item.id, face });
      invalidate();
    }
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const item = itemOf(e);
    if (item && slide && item.id === slide.id) startSlide(e, item);
  };

  // ---- camera ----
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const boundsRef = useRef(bounds);
  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);
  const viewRef = useRef<BenchView>('iso');
  useEffect(() => {
    const b = cmd.kind === 'frame' ? { min: cmd.min, max: cmd.max } : boundsRef.current;
    if (!b || !controls || size.width <= 0) return;
    const target: Vec3 = [
      (b.min[0] + b.max[0]) / 2,
      (b.min[1] + b.max[1]) / 2,
      (b.min[2] + b.max[2]) / 2,
    ];
    const box = {
      hx: (b.max[0] - b.min[0]) / 2,
      hy: (b.max[1] - b.min[1]) / 2,
      hz: (b.max[2] - b.min[2]) / 2,
    };
    if (cmd.kind === 'zoom') {
      const t = controls.target;
      const k = cmd.dir > 0 ? 0.8 : 1.25;
      cam.position.sub(t).multiplyScalar(k).add(t);
    } else {
      if (cmd.kind === 'view') viewRef.current = cmd.view;
      let dir = VIEW_DIRS[viewRef.current];
      if ((cmd.kind === 'fit' || cmd.kind === 'frame') && cmd.n > 0) {
        const p = cam.position.clone().sub(controls.target).normalize();
        dir = [p.x, p.y, p.z];
      }
      cam.position.set(...fittedPosition(target, dir, box, FOV, aspect));
      controls.target.set(...target);
    }
    cam.lookAt(controls.target);
    controls.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per camera command and aspect
  }, [cmd.n, controls, Math.round(aspect * 100)]);

  // e2e hook (set `window.__nittcamBenchHook = true` first): screen point of a part's centre.
  useEffect(() => {
    const w = window as unknown as { __nittcamBenchHook?: boolean; __nittcamBench?: unknown };
    if (!w.__nittcamBenchHook) return;
    w.__nittcamBench = {
      point: (id: string, lift = 0): [number, number] | null => {
        const it = byId.get(id);
        if (!it) return null;
        const p = new Vector3(it.pose.position[0], it.pose.position[1] + lift, it.pose.position[2]);
        p.project(cam);
        const r = gl.domElement.getBoundingClientRect();
        return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
      },
    };
    return () => {
      delete w.__nittcamBench;
    };
  }, [byId, cam, gl]);

  // Revert a refused gizmo drag (the props did not change, so React would not reset it).
  const revert = useCallback(
    (obj: Group, pose: Pose) => {
      obj.position.set(...pose.position);
      obj.quaternion.set(...pose.rotation);
      invalidate();
    },
    [invalidate],
  );

  const floorSize = Math.ceil((span * 3) / 1000) * 1000;
  const fc: V3 = bounds
    ? [(bounds.min[0] + bounds.max[0]) / 2, 0, (bounds.min[2] + bounds.max[2]) / 2]
    : [0, 0, 0];

  return (
    <>
      <hemisphereLight args={['#ffffff', colors.floor, 1.6]} />
      <directionalLight position={[-span, span * 1.5, span]} intensity={1.4} />
      <directionalLight position={[span, span * 0.5, -span]} intensity={0.35} />
      <mesh
        position={[fc[0], -0.5, fc[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          if (e.delta > 4) return;
          e.stopPropagation();
          if (performance.now() - lastDrag.current < 250 || gizmoHot(tc.current)) return;
          onSelect(null);
        }}
      >
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial color={colors.floor} roughness={0.95} />
      </mesh>
      {simple ? null : (
        <gridHelper
          args={[floorSize, floorSize / 100, colors.grid, colors.grid]}
          position={[fc[0], 0, fc[2]]}
        />
      )}
      <group
        onClick={onClick}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerOut={() => {
          if (hover) {
            setHover(null);
            invalidate();
          }
        }}
      >
        {batches.map((b) => (
          <Batch
            key={b.key}
            data={b.mesh}
            items={b.items}
            material={b.door ? mats.door : mats.solid}
          />
        ))}
        {edges ? <lineSegments geometry={edges} material={mats.edge} raycast={() => null} /> : null}
        {single.map((item) => {
          const selected = item.id === selectedId;
          const pose = dragPose?.id === item.id ? dragPose.pose : item.pose;
          const mark = marks?.get(item.id);
          return (
            <Instance
              key={item.id}
              ref={selected ? setSelObj : undefined}
              item={item}
              pose={pose}
              material={
                selected ? mats.selected : mark ? mats[mark] : item.door ? mats.door : mats.solid
              }
              edgeMaterial={selected ? mats.edgeSelected : mark ? mats[`${mark}Edge`] : mats.edge}
              edges={!simple || selected || item.door || mark !== undefined}
              door={item.door}
            />
          );
        })}
      </group>
      {pickedFace && byId.get(pickedFace.id) ? (
        <FaceMark
          item={byId.get(pickedFace.id) as BenchItem}
          face={pickedFace.face}
          color={colors.picked}
        />
      ) : null}
      {mode === 'mate' && hover && byId.get(hover.id) ? (
        <FaceMark item={byId.get(hover.id) as BenchItem} face={hover.face} color={colors.hover} />
      ) : null}
      {selObj && selectedItem && mode !== 'mate' && !slide ? (
        <TransformControls
          ref={tc}
          object={selObj}
          mode={mode === 'rotate' ? 'rotate' : 'translate'}
          space="world"
          size={1.15}
          rotationSnap={rotationStep > 0 ? (rotationStep * Math.PI) / 180 : null}
          translationSnap={moveStep > 0 ? moveStep : null}
          onMouseUp={() => {
            lastDrag.current = performance.now();
            const p = selObj.position;
            const q = selObj.quaternion;
            const pose: Pose = { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
            if (!onCommit(selectedItem.id, pose)) revert(selObj, selectedItem.pose);
          }}
          onObjectChange={() => invalidate()}
        />
      ) : null}
      <Capture onCapture={onCapture} />
      <Stats onStats={onStats} />
      <OrbitControls makeDefault minDistance={50} maxDistance={span * 20} />
    </>
  );
}

interface InstanceProps {
  item: BenchItem;
  pose: Pose;
  material: MeshStandardMaterial;
  edgeMaterial: LineBasicMaterial;
  edges: boolean;
  door: boolean;
  ref?: Ref<Group> | undefined;
}

/** One part copy: a group at its pose (origin = the part's centre) holding the shared mesh. */
const Instance = memo(function Instance({
  item,
  pose,
  material,
  edgeMaterial,
  edges,
  door,
  ref,
}: InstanceProps) {
  const geo = geometryOf(item.mesh);
  const c = boxCentre(item.box);
  return (
    <group
      ref={ref ?? null}
      position={pose.position}
      quaternion={pose.rotation}
      userData={{ id: item.id }}
      name={item.id}
    >
      <mesh geometry={geo.mesh} material={material} position={[-c[0], -c[1], -c[2]]} />
      {edges ? (
        <lineSegments
          geometry={geo.edges}
          material={edgeMaterial}
          position={[-c[0], -c[1], -c[2]]}
          renderOrder={door ? 1 : 0}
          raycast={() => null}
        />
      ) : null}
    </group>
  );
});

/** A see-through quad on one face of a part (mate pick / hover feedback). */
function FaceMark({ item, face, color }: { item: BenchItem; face: BoxFace; color: string }) {
  const f = faceFrame(item.pose, item.box, face);
  const v = cross(f.normal, f.u);
  const rotation = qFromBasis(f.u, v, f.normal);
  const at: V3 = [
    f.centre[0] + f.normal[0] * 0.6,
    f.centre[1] + f.normal[1] * 0.6,
    f.centre[2] + f.normal[2] * 0.6,
  ];
  return (
    <mesh position={at} quaternion={rotation} raycast={() => null} renderOrder={2}>
      <planeGeometry args={[f.hu * 2, f.hv * 2]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.45}
        side={DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/** True while the pointer is on a gizmo handle (its `axis` is set; private in the typings). */
function gizmoHot(controls: unknown): boolean {
  return Boolean((controls as { axis?: string | null } | null)?.axis);
}

/** Shared materials of one colour set (one per state). */
function benchMaterials(colors: BenchColors, simple: boolean) {
  const solid = new MeshStandardMaterial({ color: colors.base, roughness: simple ? 1 : 0.7 });
  const door = new MeshStandardMaterial({
    color: colors.base,
    roughness: simple ? 1 : 0.7,
    transparent: true,
    opacity: DOOR_OPACITY,
    depthWrite: false,
  });
  const selected = new MeshStandardMaterial({
    color: new Color(colors.base).lerp(new Color(colors.selection), 0.35),
    emissive: colors.selection,
    emissiveIntensity: 0.18,
    roughness: 0.6,
  });
  const edge = new LineBasicMaterial({ color: colors.stroke });
  const edgeSelected = new LineBasicMaterial({ color: colors.selection });
  // Fit check (T388): tinted towards the status colour, see-through enough to show the overlap.
  const markMat = (c: string) =>
    new MeshStandardMaterial({
      color: new Color(colors.base).lerp(new Color(c), 0.6),
      emissive: c,
      emissiveIntensity: 0.25,
      roughness: 0.6,
      transparent: true,
      opacity: 0.85,
    });
  const danger = markMat(colors.danger);
  const warning = markMat(colors.picked);
  const dangerEdge = new LineBasicMaterial({ color: colors.danger });
  const warningEdge = new LineBasicMaterial({ color: colors.picked });
  return { solid, door, selected, edge, edgeSelected, danger, warning, dangerEdge, warningEdge };
}

/** Frame-rate read-out (spec §3.8 budget check): reported to the host after every frame. */
function Stats({ onStats }: { onStats: BenchSceneProps['onStats'] }) {
  const [watch] = useState(() => new FpsWatch());
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (!onStats) return;
    watch.frame(performance.now());
    onStats({ fps: watch.rate(), drawCalls: gl.info.render.calls });
  });
  return null;
}

/** All copies of one part shape as one instanced mesh (ids in `userData` for picking). */
function Batch({
  data,
  items,
  material,
}: {
  data: MeshData;
  items: readonly BenchItem[];
  material: MeshStandardMaterial;
}) {
  const ref = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geo = geometryOf(data);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    items.forEach((it, i) => {
      m.fromArray(instanceMatrix(it.pose, boxCentre(it.box)));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    invalidate();
  }, [items, invalidate]);
  return (
    <instancedMesh
      // A new count needs a new mesh (three sizes the instance buffer once).
      key={items.length}
      ref={ref}
      args={[geo.mesh, material, items.length]}
      material={material}
      userData={{ ids: items.map((i) => i.id) }}
    />
  );
}

/** The contour lines of many copies in one geometry (one draw call). */
function mergedEdges(items: readonly BenchItem[]): BufferGeometry | null {
  let n = 0;
  for (const it of items) n += it.mesh.edges.length;
  if (n === 0) return null;
  const out = new Float32Array(n);
  let o = 0;
  for (const it of items) {
    const m = instanceMatrix(it.pose, boxCentre(it.box));
    const e = it.mesh.edges;
    for (let i = 0; i + 2 < e.length; i += 3) {
      const x = e[i] ?? 0;
      const y = e[i + 1] ?? 0;
      const z = e[i + 2] ?? 0;
      out[o++] = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
      out[o++] = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
      out[o++] = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(out, 3));
  g.computeBoundingSphere();
  return g;
}
