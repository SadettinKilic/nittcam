'use client';

/**
 * Host of the 3D preview (T152, spec §3.8, D-033). Light on purpose: it never imports `three`;
 * the scene (`./scene`) is a lazy chunk loaded by `next/dynamic` only when the 3D view opens.
 * Draws the DOM view cube (keyboard operable buttons) in the top-right corner and falls back to
 * the 2D view (via `onFallback`) when the scene crashes or WebGL is lost.
 */
import { Button, IconButton, Skeleton, Tooltip, cn } from '@nittcam/ui';
import {
  Boxes,
  EyeOff,
  ImageDown,
  Gauge,
  Maximize,
  Move,
  RotateCcw,
  Route,
  Undo2,
  X,
} from 'lucide-react';
import { sheetSizeOf, type Project } from '@nittcam/core';
import dynamic from 'next/dynamic';
import { isTypingTarget, withShortcut } from '../../lib/shortcuts';
import {
  Component,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { sizeText } from '../../lib/canvas-labels';
import { drawnParts, jobBox, type DrawnPart } from '../layout-view/model';
import { clampOffset, explodeMax } from '../../lib/preview3d/interaction';
import { onThemeChange, readTokenColors } from '../../lib/canvas-theme';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import { useMessages } from '../../lib/messages-context';
import { cabinetGroups, hasFaceFeatures } from '../../lib/preview3d/assembly';
import {
  TOOLBAR_PRESETS,
  azimuthDeg,
  cubeMatrix,
  polarDeg,
  type CameraPose,
  type ViewPreset,
} from '../../lib/preview3d/camera';
import type { TableSpec } from '../../lib/preview3d/stage';
import { MATERIAL_TOKEN, materialLook } from '../../lib/preview3d/textures';
import { readSimple3d, setSimple3d } from '../../lib/preferences';
import { useReducedMotion } from '../../lib/use-preferences';
import type { CaptureFn } from './capture';
import { exportPng } from '../../lib/preview3d/png';
import type {
  CameraCommand,
  SceneColors,
  SceneInteraction,
  SceneStats,
  SceneToolpath,
} from './scene';

import { rememberPose, type FallbackReason } from '../../lib/preview3d/view-memory';
/** Why the 3D view gave way to 2D: no WebGL2 / a crash, or still too slow in Basit mod (T159). */
export type { FallbackReason };

type Text = Messages['layout']['preview3d'];

const Scene = dynamic(() => import('./scene'), { ssr: false, loading: () => <Loading /> });
const AssemblyScene = dynamic(() => import('./assembly-scene'), {
  ssr: false,
  loading: () => <Loading />,
});

type FlatColors = Omit<SceneColors, 'materials'>;

const TOKENS: Record<keyof FlatColors, string> = {
  sheet: '--color-sheet',
  sheetEdge: '--color-sheet-edge',
  part: '--color-part',
  partStroke: '--color-part-stroke',
  // The 2D simulation table token is a line colour (light in dark mode); the envelope tone
  // reads as a calm machine bed in both themes.
  table: '--color-sim-envelope',
  grid: '--color-grid',
  gridSection: '--color-border-strong',
  shadow: '--color-mat-shadow',
  band: '--color-mat-band',
  simTool: '--color-sim-tool',
  simRapid: '--color-sim-rapid',
  simDepthTop: '--color-sim-depth-top',
  simDepthBottom: '--color-sim-depth-bottom',
  highlight: '--color-accent',
};

function readColors(): SceneColors {
  const style = getComputedStyle(document.documentElement);
  return { ...readTokenColors(TOKENS, style), materials: readTokenColors(MATERIAL_TOKEN, style) };
}

export interface Preview3DProps {
  t: Text;
  project: Project;
  sheet: number;
  table: TableSpec | null;
  command: CameraCommand;
  /** A view-cube click asks the owner for a preset (the owner keeps the command state). */
  onPreset: (preset: ViewPreset, whole?: boolean) => void;
  /** The scene could not run (crash, lost context) or stayed too slow in Basit mod: the owner
   * shows the 2D view with the matching note (spec §3.8). */
  onFallback: (reason: FallbackReason) => void;
  partCount: number;
  /** Per-slot extra lift in mm (cutting playback, T157). */
  lifts?: ArrayLike<number> | null;
  /** Extra overlay content inside the scene's host (playback controls, banner; T157). */
  children?: ReactNode;
  /** Toolpath overlay from the read program (T156); adds the "Takım yolu" toggle. */
  toolpath?: SceneToolpath | null;
}

export function Preview3D({
  t,
  project,
  sheet,
  table,
  command,
  onPreset,
  onFallback,
  partCount,
  lifts,
  children,
  toolpath,
}: Preview3DProps) {
  const [showPath, setShowPath] = useState(true);
  const reduced = useReducedMotion();
  // Opened by a click (never server-rendered), so the tokens can be read on the first render.
  const [colors, setColors] = useState<SceneColors | null>(() =>
    typeof document === 'undefined' ? null : readColors(),
  );
  const host = useRef<HTMLDivElement>(null);
  const cube = useRef<HTMLDivElement>(null);
  // "Basit mod" (T154, spec §3.8): remembered per browser; turned on by itself when slow.
  const [simple, setSimple] = useState(() => typeof window !== 'undefined' && readSimple3d());
  const [autoSimple, setAutoSimple] = useState(false);
  // T158 "Montaj görünümü": cabinet groups of the cut list as assembled boxes (view only).
  const roles = useMessages().cutList.cabinet.roles;
  const groups = useMemo(() => cabinetGroups(project, roles), [project, roles]);
  const [assembly, setAssembly] = useState(false);
  // T160 "Görüntü kaydet": the live scene fills this with a frame grabber.
  const capture = useRef<CaptureFn | null>(null);
  const setCapture = useCallback((fn: CaptureFn | null) => {
    capture.current = fn;
  }, []);
  function savePng() {
    const url = capture.current?.();
    if (!url) return;
    const name = showAssembly ? 'nittcam-montaj-3d.png' : `nittcam-plaka-${sheet + 1}-3d.png`;
    void exportPng(url, name);
  }
  const showAssembly = assembly && groups.length > 0;
  function toggleSimple() {
    setSimple(!simple);
    setAutoSimple(false);
    setSimple3d(!simple);
  }

  useEffect(() => onThemeChange(() => setColors(readColors())), []);

  // T155: view-only interaction; nothing here is written to the project.
  const [moveSheet, setMoveSheet] = useState(false);
  const [offset, setOffset] = useState<readonly [number, number]>([0, 0]);
  const [hideWaste, setHideWaste] = useState(false);
  const [explode, setExplode] = useState(0);
  const [selected, setSelected] = useState(-1);
  const copies = useMemo(() => drawnParts(project, sheet), [project, sheet]);
  // B44: a small job opens framed on its parts; "Tümünü göster" frames the whole sheet.
  const smallJob = useMemo(
    () => jobBox(copies, sheetSizeOf(project, sheet)) !== null,
    [copies, project, sheet],
  );
  // T381: F frames the whole sheet, as on the 2D canvases (never while typing).
  const preset = command.preset;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      e.preventDefault();
      onPreset(preset, true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPreset, preset]);
  // A new sheet (or a new layout) starts at rest (state reset during render, no effect).
  const [restFor, setRestFor] = useState({ sheet, layout: project.layout });
  if (restFor.sheet !== sheet || restFor.layout !== project.layout) {
    setRestFor({ sheet, layout: project.layout });
    setSelected(-1);
    setOffset([0, 0]);
  }
  const sheetSize = sheetSizeOf(project, sheet);
  const lift = (explode / 100) * explodeMax(project.stock.thickness);
  const interaction: SceneInteraction = {
    explode: lift,
    hideWaste,
    moveSheet,
    offset,
    onOffset: (o) => setOffset(clampOffset(o, sheetSize)),
    selected,
    onSelect: setSelected,
    onHover: (slot) => {
      if (host.current) host.current.dataset.hover = String(slot);
    },
    lifts: lifts ?? null,
  };
  const moved = offset[0] !== 0 || offset[1] !== 0;
  const picked = selected >= 0 ? copies[selected] : undefined;
  const active = 'bg-accent-subtle text-accent-text hover:text-accent-text';

  // Camera reports go straight to the DOM (no React render per frame).
  const onCamera = (viewInverse: ArrayLike<number>, pose: CameraPose) => {
    rememberPose(pose);
    if (cube.current) cube.current.style.transform = cubeMatrix(viewInverse);
    const el = host.current;
    if (!el) return;
    el.dataset.azimuth = String(Math.round(azimuthDeg(pose)));
    el.dataset.polar = String(Math.round(polarDeg(pose)));
    el.dataset.distance = String(
      Math.round(
        Math.hypot(
          pose.position[0] - pose.target[0],
          pose.position[1] - pose.target[1],
          pose.position[2] - pose.target[2],
        ),
      ),
    );
    el.dataset.ready = 'true';
  };
  const onStats = (s: SceneStats) => {
    const d = host.current?.dataset;
    if (!d) return;
    d.drawCalls = String(s.drawCalls);
    d.fps = s.fps === null ? '' : String(Math.round(s.fps));
    d.gpuGeometries = String(s.geometries);
    d.gpuTextures = String(s.textures);
    d.firstFrameMs = String(s.firstFrameMs);
  };

  return (
    <div
      ref={host}
      data-testid="preview3d"
      data-view={command.preset}
      data-reduced-motion={reduced ? 'true' : 'false'}
      data-simple={simple ? 'true' : 'false'}
      data-material={materialLook(project.stock.material)}
      data-offset={`${offset[0]},${offset[1]}`}
      data-selected={picked?.key ?? ''}
      data-explode={Math.round(lift)}
      data-hide-waste={hideWaste ? 'true' : 'false'}
      data-toolpath={toolpath ? (showPath ? 'on' : 'off') : undefined}
      data-assembly={
        showAssembly
          ? groups
              .map((g) => `${g.group}:${g.assembly.width}x${g.assembly.height}x${g.assembly.depth}`)
              .join(';')
          : undefined
      }
      data-assembly-features={
        showAssembly
          ? groups.reduce(
              (n, g) =>
                n +
                g.assembly.boxes.filter((b) => {
                  const part = g.parts.get(b.id);
                  return part ? hasFaceFeatures(part) : false;
                }).length,
              0,
            )
          : undefined
      }
      role="application"
      aria-label={
        showAssembly
          ? fill(t.assemblyLabel, { count: groups.length })
          : fill(t.canvasLabel, { n: sheet + 1, count: partCount })
      }
      tabIndex={0}
      className="@container absolute inset-0 touch-none overflow-hidden bg-linear-to-b from-surface-subtle to-canvas outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    >
      {colors && showAssembly ? (
        <SceneBoundary onError={() => onFallback('webgl')}>
          <AssemblyScene
            groups={groups}
            colors={colors}
            base={colors.materials[materialLook(project.stock.material)]}
            simple={simple}
            onCapture={setCapture}
          />
        </SceneBoundary>
      ) : colors ? (
        <SceneBoundary onError={() => onFallback('webgl')}>
          <Scene
            project={project}
            sheet={sheet}
            table={table}
            colors={colors}
            reduced={reduced}
            simple={simple}
            onSlow={() => {
              // Already simple and still slow: give way to 2D (§3.8 "gerekirse 2D'ye düşer").
              if (simple) return onFallback('slow');
              setSimple(true);
              setAutoSimple(true);
            }}
            command={command}
            onCamera={onCamera}
            onStats={onStats}
            interaction={interaction}
            toolpath={toolpath ? { ...toolpath, path: showPath } : null}
            onCapture={setCapture}
          />
        </SceneBoundary>
      ) : (
        <Loading />
      )}
      {showAssembly ? null : <ViewCube t={t} cubeRef={cube} onPreset={onPreset} />}
      {picked && !showAssembly ? (
        <InfoCard t={t} part={picked} onClose={() => setSelected(-1)} />
      ) : null}
      {children}
      {/* Presets inside the 3D view (bottom right, where the 2D read-out sits), so the shared
          tab row of the canvas keeps its room (T249). */}
      <div
        role="group"
        aria-label={t.presetsLabel}
        data-testid="preview3d-presets"
        data-toast-avoid=""
        hidden={showAssembly}
        className="absolute right-2 bottom-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 p-0.5 shadow-sm backdrop-blur-sm max-sm:bottom-8"
      >
        {TOOLBAR_PRESETS.map((p) => (
          <Tooltip key={p} content={fill(t.presetTip, { view: t.presets[p] })}>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                'h-7 px-2',
                command.preset === p && 'bg-accent-subtle text-accent-text hover:text-accent-text',
              )}
              aria-pressed={command.preset === p}
              data-testid={`preview3d-preset-${p}`}
              onClick={() => onPreset(p)}
            >
              {t.presets[p]}
            </Button>
          </Tooltip>
        ))}
        <Tooltip content={t.reset}>
          <IconButton
            size="sm"
            variant="ghost"
            className="size-7"
            aria-label={t.reset}
            data-testid="preview3d-reset"
            onClick={() => onPreset('iso')}
          >
            <RotateCcw aria-hidden />
          </IconButton>
        </Tooltip>
        {smallJob ? (
          <Tooltip content={withShortcut(t.fitSheet, 'canvasFit')}>
            <IconButton
              size="sm"
              variant="ghost"
              className="size-7"
              aria-label={t.fitSheet}
              data-testid="preview3d-fit-sheet"
              aria-keyshortcuts="F"
              onClick={() => onPreset(command.preset, true)}
            >
              <Maximize aria-hidden />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      <div
        data-toast-avoid=""
        className="pointer-events-none absolute bottom-2 left-2 z-10 flex flex-col items-start gap-2 max-sm:bottom-8"
      >
        {autoSimple ? (
          <p
            role="status"
            data-testid="preview3d-auto-simple"
            className="pointer-events-auto max-w-72 rounded-lg border border-border bg-surface/95 px-2.5 py-1.5 text-xs text-fg-muted shadow-sm"
          >
            {t.simpleAuto}
          </p>
        ) : null}
        <Tooltip content={t.simpleTip}>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={simple}
            aria-label={t.simple}
            data-testid="preview3d-simple"
            onClick={toggleSimple}
            className={cn(
              'pointer-events-auto bg-surface/95 shadow-sm',
              simple && 'border-accent-border bg-accent-subtle text-accent-text',
            )}
          >
            <Gauge aria-hidden />
            <span className="hidden @md:inline">{t.simple}</span>
          </Button>
        </Tooltip>
        <Tooltip content={t.savePngTip}>
          <Button
            variant="outline"
            size="sm"
            data-testid="preview3d-save-png"
            onClick={savePng}
            className="pointer-events-auto bg-surface/95 shadow-sm"
          >
            <ImageDown aria-hidden />
            {t.savePng}
          </Button>
        </Tooltip>
        {groups.length > 0 ? (
          <Tooltip content={t.assemblyTip}>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={showAssembly}
              data-testid="preview3d-assembly"
              onClick={() => setAssembly(!assembly)}
              className={cn(
                'pointer-events-auto bg-surface/95 shadow-sm',
                showAssembly && 'border-accent-border bg-accent-subtle text-accent-text',
              )}
            >
              <Boxes aria-hidden />
              {t.assembly}
            </Button>
          </Tooltip>
        ) : null}
        {/* T161: the tools wrap before the preset group (bottom right, ~15 rem with "Tümünü göster", B44) so they never
            cover it; the simulation adds Takım yolu and reached it at 1440. */}
        <div
          role="group"
          aria-label={t.toolsLabel}
          data-testid="preview3d-tools"
          hidden={showAssembly}
          className="pointer-events-auto flex max-w-[calc(100cqw_-_15.5rem)] flex-wrap items-center gap-1 rounded-lg border border-border bg-surface/95 p-0.5 shadow-sm backdrop-blur-sm"
        >
          <Tooltip content={t.moveSheetTip}>
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-7 px-2', moveSheet && active)}
              aria-pressed={moveSheet}
              aria-label={t.moveSheet}
              data-testid="preview3d-move"
              onClick={() => setMoveSheet(!moveSheet)}
            >
              <Move aria-hidden />
              <span className="hidden @lg:inline">{t.moveSheet}</span>
            </Button>
          </Tooltip>
          {moved ? (
            <Tooltip content={t.snapBackTip}>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                data-testid="preview3d-snap-back"
                onClick={() => setOffset([0, 0])}
              >
                <Undo2 aria-hidden />
                {t.snapBack}
              </Button>
            </Tooltip>
          ) : null}
          {toolpath ? (
            <Tooltip content={t.toolpathTip}>
              <Button
                size="sm"
                variant="ghost"
                className={cn('h-7 px-2', showPath && active)}
                aria-pressed={showPath}
                aria-label={t.toolpath}
                data-testid="preview3d-toolpath"
                onClick={() => setShowPath(!showPath)}
              >
                <Route aria-hidden />
                <span className="hidden @lg:inline">{t.toolpath}</span>
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content={t.hideWaste}>
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-7 px-2', hideWaste && active)}
              aria-pressed={hideWaste}
              aria-label={t.hideWaste}
              data-testid="preview3d-hide-waste"
              onClick={() => setHideWaste(!hideWaste)}
            >
              <EyeOff aria-hidden />
              <span className="hidden @lg:inline">{t.hideWaste}</span>
            </Button>
          </Tooltip>
          <label
            className="flex items-center gap-1.5 px-1.5 text-xs text-fg-muted"
            title={t.explodeTip}
          >
            <span className="hidden @md:inline">{t.explode}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={explode}
              onChange={(e) => setExplode(Number(e.target.value))}
              aria-label={t.explode}
              aria-valuetext={`${Math.round(lift)} mm`}
              data-testid="preview3d-explode"
              className="h-7 w-24 cursor-pointer accent-(--color-accent)"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

/** Info card of the selected part (T155, spec §3.8): number as in 2D, name, size, grain. */
function InfoCard({ t, part, onClose }: { t: Text; part: DrawnPart; onClose: () => void }) {
  const i = t.info;
  const title = fill(i.title, { label: part.label });
  return (
    <section
      aria-label={title}
      data-testid="preview3d-info"
      className="absolute top-16 left-3 z-10 w-56 rounded-lg border border-border bg-surface/95 p-3 text-sm shadow-md backdrop-blur-sm"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold text-fg" data-testid="preview3d-info-label">
          {title}
        </h3>
        <IconButton
          size="sm"
          variant="ghost"
          className="-mt-1 -mr-1 size-6"
          aria-label={i.close}
          onClick={onClose}
        >
          <X aria-hidden />
        </IconButton>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-fg-muted">{i.name}</dt>
        <dd className="truncate text-fg">{part.name.trim() || i.unnamed}</dd>
        <dt className="text-fg-muted">{i.size}</dt>
        <dd className="font-mono text-fg tabular-nums">{sizeText(part.w, part.h)}</dd>
        <dt className="text-fg-muted">{i.grain}</dt>
        <dd className="text-fg">
          {part.grainAngle === null ? i.grainFree : `${Math.round(part.grainAngle)}°`}
        </dd>
      </dl>
    </section>
  );
}

function Loading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6" aria-busy="true">
      <Skeleton className="size-full rounded-none opacity-60" />
    </div>
  );
}

/** Scene crash (or no context) → back to 2D; the page and the project stay intact. */
class SceneBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('3D preview failed, falling back to 2D', error.message, info.componentStack);
    this.props.onError();
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

const CUBE = 64;
const HALF = CUBE / 2;

const FACES: {
  preset: ViewPreset | null;
  key: keyof Text['presets'] | 'bottom';
  transform: string;
}[] = [
  { preset: 'front', key: 'front', transform: `translateZ(${HALF}px)` },
  { preset: 'back', key: 'back', transform: `rotateY(180deg) translateZ(${HALF}px)` },
  { preset: 'right', key: 'right', transform: `rotateY(90deg) translateZ(${HALF}px)` },
  { preset: 'left', key: 'left', transform: `rotateY(-90deg) translateZ(${HALF}px)` },
  { preset: 'top', key: 'top', transform: `rotateX(90deg) translateZ(${HALF}px)` },
  { preset: null, key: 'bottom', transform: `rotateX(-90deg) translateZ(${HALF}px)` },
];

/** Top corners of the cube (CSS frame: Y down, Z toward the viewer). */
const CORNERS: { preset: ViewPreset; x: number; z: number }[] = [
  { preset: 'iso', x: HALF, z: HALF },
  { preset: 'isoFrontLeft', x: -HALF, z: HALF },
  { preset: 'isoBackRight', x: HALF, z: -HALF },
  { preset: 'isoBackLeft', x: -HALF, z: -HALF },
];

/**
 * View cube (T152): a CSS 3D cube that turns with the camera; its faces (Üst/Ön/Sağ/Sol/Arka) and
 * top corners (isometric views) are real buttons, so the presets are reachable by keyboard too.
 */
function ViewCube({
  t,
  cubeRef,
  onPreset,
}: {
  t: Text;
  cubeRef: React.RefObject<HTMLDivElement | null>;
  onPreset: (p: ViewPreset) => void;
}) {
  return (
    <div
      role="group"
      aria-label={t.cube}
      data-testid="preview3d-cube"
      className="absolute top-16 right-3 z-10 select-none"
      style={{ width: CUBE + 24, height: CUBE + 24, perspective: 'none' }}
    >
      <div
        className="absolute"
        style={{ left: 12, top: 12, width: CUBE, height: CUBE, transformStyle: 'preserve-3d' }}
      >
        <div
          ref={cubeRef}
          className="absolute inset-0"
          style={{ transformStyle: 'preserve-3d', transform: 'rotateX(-35deg) rotateY(-45deg)' }}
        >
          {FACES.map((f) =>
            f.preset ? (
              <button
                key={f.key}
                type="button"
                data-testid={`preview3d-cube-${f.preset}`}
                aria-label={fill(t.presetTip, { view: t.presets[f.preset] })}
                onClick={() => onPreset(f.preset as ViewPreset)}
                className={cn(
                  'absolute inset-0 flex items-center justify-center border border-border-strong',
                  'bg-surface/90 text-2xs font-semibold text-fg-muted [backface-visibility:hidden]',
                  'hover:bg-accent-subtle hover:text-accent-text focus-visible:bg-accent-subtle',
                  'focus-visible:text-accent-text focus-visible:outline-none',
                )}
                style={{ transform: f.transform }}
              >
                {t.presets[f.preset]}
              </button>
            ) : (
              <div
                key={f.key}
                aria-hidden="true"
                className="absolute inset-0 border border-border bg-surface-subtle/90 [backface-visibility:hidden]"
                style={{ transform: f.transform }}
              />
            ),
          )}
          {CORNERS.map((c) => (
            <button
              key={c.preset}
              type="button"
              data-testid={`preview3d-cube-${c.preset}`}
              aria-label={fill(t.presetTip, { view: t.presets[c.preset] })}
              onClick={() => onPreset(c.preset)}
              className="absolute size-3.5 rounded-full border border-border-strong bg-surface hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              style={{
                left: HALF - 7,
                top: HALF - 7,
                transform: `translate3d(${c.x}px, ${-HALF}px, ${c.z}px)`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
