'use client';

/**
 * Host of the 3D preview (T152, spec §3.8, D-033). Light on purpose: it never imports `three`;
 * the scene (`./scene`) is a lazy chunk loaded by `next/dynamic` only when the 3D view opens.
 * Draws the DOM view cube (keyboard operable buttons) in the top-right corner and falls back to
 * the 2D view (via `onFallback`) when the scene crashes or WebGL is lost.
 */
import { Skeleton, cn } from '@nittcam/ui';
import type { Project } from '@nittcam/core';
import dynamic from 'next/dynamic';
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { onThemeChange, readTokenColors } from '../../lib/canvas-theme';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import {
  azimuthDeg,
  cubeMatrix,
  polarDeg,
  type CameraPose,
  type ViewPreset,
} from '../../lib/preview3d/camera';
import type { TableSpec } from '../../lib/preview3d/stage';
import { useMediaQuery } from '../../lib/use-media-query';
import type { CameraCommand, SceneColors } from './scene';

type Text = Messages['layout']['preview3d'];

const Scene = dynamic(() => import('./scene'), { ssr: false, loading: () => <Loading /> });

const TOKENS: Record<keyof SceneColors, string> = {
  sheet: '--color-sheet',
  sheetEdge: '--color-sheet-edge',
  part: '--color-part',
  partStroke: '--color-part-stroke',
  // The 2D simulation table token is a line colour (light in dark mode); the envelope tone
  // reads as a calm machine bed in both themes.
  table: '--color-sim-envelope',
  grid: '--color-grid',
  gridSection: '--color-border-strong',
  shadow: '--color-fg',
};

function readColors(): SceneColors {
  return readTokenColors(TOKENS, getComputedStyle(document.documentElement));
}

export interface Preview3DProps {
  t: Text;
  project: Project;
  sheet: number;
  table: TableSpec | null;
  command: CameraCommand;
  /** A view-cube click asks the owner for a preset (the owner keeps the command state). */
  onPreset: (preset: ViewPreset) => void;
  /** The scene could not run (crash, lost context): the owner shows the 2D view. */
  onFallback: () => void;
  partCount: number;
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
}: Preview3DProps) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)', false);
  // Opened by a click (never server-rendered), so the tokens can be read on the first render.
  const [colors, setColors] = useState<SceneColors | null>(() =>
    typeof document === 'undefined' ? null : readColors(),
  );
  const host = useRef<HTMLDivElement>(null);
  const cube = useRef<HTMLDivElement>(null);

  useEffect(() => onThemeChange(() => setColors(readColors())), []);

  // Camera reports go straight to the DOM (no React render per frame).
  const onCamera = (viewInverse: ArrayLike<number>, pose: CameraPose) => {
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
  const onStats = (calls: number) => {
    if (host.current) host.current.dataset.drawCalls = String(calls);
  };

  return (
    <div
      ref={host}
      data-testid="preview3d"
      data-view={command.preset}
      data-reduced-motion={reduced ? 'true' : 'false'}
      role="application"
      aria-label={fill(t.canvasLabel, { n: sheet + 1, count: partCount })}
      tabIndex={0}
      className="absolute inset-0 touch-none overflow-hidden bg-linear-to-b from-surface-subtle to-canvas outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    >
      {colors ? (
        <SceneBoundary onError={onFallback}>
          <Scene
            project={project}
            sheet={sheet}
            table={table}
            colors={colors}
            reduced={reduced}
            command={command}
            onCamera={onCamera}
            onStats={onStats}
          />
        </SceneBoundary>
      ) : (
        <Loading />
      )}
      <ViewCube t={t} cubeRef={cube} onPreset={onPreset} />
    </div>
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
