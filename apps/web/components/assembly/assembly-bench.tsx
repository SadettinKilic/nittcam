'use client';

/**
 * Montaj tezgâhı (T387, D-131, spec §3.8): every part copy of the project in 3D, moved and turned
 * freely (gizmo, numeric fields, 90° buttons) and mated face to face. Lazy chunk (loaded by the
 * Parçalar step's "Montaj" view). Display only: every edit is a `setAssemblyInstances` /
 * `resetAssembly` command (undo/redo and autosave come with the project session); nesting,
 * toolpath and NC never read it.
 */
import {
  Badge,
  Button,
  IconButton,
  Input,
  Measure,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  cn,
} from '@nittcam/ui';
import {
  Box,
  Eye,
  EyeOff,
  Focus,
  ImageDown,
  Magnet,
  Maximize,
  Move3d,
  RotateCcw,
  Rotate3d,
  Ruler,
  ScanSearch,
  Search,
  ZoomIn,
  ZoomOut,
  ArrowDownToLine,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MATERIAL_KINDS,
  MATERIAL_TRAITS,
  defaultThicknessOf,
  materialKindOf,
  type MaterialKind,
  type Project,
} from '@nittcam/core';
import { WorkspaceLayout } from '../wizard/workspace-layout';
import type { Messages } from '../../lib/messages';
import { useMessages } from '../../lib/messages-context';
import { fill } from '../../lib/fill';
import { onThemeChange, readTokenColors } from '../../lib/canvas-theme';
import {
  ariaKeyShortcuts,
  claimPageGroup,
  isTypingTarget,
  shortcutById,
  withShortcut,
} from '../../lib/shortcuts';
import { readSimple3d } from '../../lib/preferences';
import { MATERIAL_TOKEN, materialLook } from '../../lib/preview3d/textures';
import { exportPng } from '../../lib/preview3d/png';
import {
  benchItems,
  instanceOf,
  stockLook,
  type BenchItem,
} from '../../lib/preview3d/assembly-model';
import {
  boxSize,
  eulerDeg,
  faceFrame,
  faceFromNormal,
  mate,
  quatFromEulerDeg,
  turnAbout,
  worldBounds,
  type BoxFace,
  type Pose,
  type V3,
} from '../../lib/preview3d/assembly-math';
import type { CaptureFn } from '../preview3d/capture';
import type {
  BenchColors,
  BenchMark,
  BenchMode,
  BenchSlide,
  BenchView,
  CameraCmd,
} from './bench-scene';
import { FitPanel } from './fit-panel';
import { FoldTools } from './fold-tools';
import { applyFold, foldToolOf, NO_FOLD, type FoldState } from '../../lib/preview3d/bench-fold';
import type { VGrooveInfo } from '../../lib/vgroove-info';
import { ViewTools } from './view-tools';
import {
  boundsOf,
  exploded,
  explodeOffsets,
  type Section,
} from '../../lib/preview3d/assembly-explode';
import { useFitCheck } from './use-fit-check';
import { fastenerRows, fastenersOf } from '../../lib/preview3d/fasteners';
import { measure, snapPick, type MeasurePick } from '../../lib/preview3d/assembly-measure';
import { CanvasBoundary } from '../feedback/canvas-boundary';

const BenchScene = dynamic(() => import('./bench-scene'), {
  ssr: false,
  loading: () => <BenchLoading />,
});

type T = Messages['bench'];
type CameraReq =
  | { kind: 'view'; view: BenchView }
  | { kind: 'fit' }
  | { kind: 'zoom'; dir: 1 | -1 }
  | { kind: 'frame'; min: V3; max: V3 };

const COLOR_TOKENS = {
  stroke: '--color-part-stroke',
  floor: '--color-sim-envelope',
  grid: '--color-grid',
  selection: '--color-accent',
  picked: '--color-warning',
  hover: '--color-success',
  danger: '--color-danger',
} as const;

function readColors(material: string): BenchColors {
  const style = getComputedStyle(document.documentElement);
  const flat = readTokenColors(COLOR_TOKENS, style);
  const looks = readTokenColors(MATERIAL_TOKEN, style);
  return { ...flat, base: looks[materialLook(materialKindOf(material) ?? material)], looks };
}

export interface AssemblyBenchProps {
  project: Project;
  run: (command: string, params: unknown) => boolean;
  /** Liste / Çizim / Montaj switch for narrow screens (the header holds it on ≥ 1024 px). */
  viewSwitch?: ReactNode;
  /** T391: the stock's V-groove facts and V-bit (ACM parts fold along their grooves). */
  vGroove?: VGrooveInfo;
}

const now = () => new Date().toISOString();
const MM1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

export function AssemblyBench({ project, run, viewSwitch, vGroove }: AssemblyBenchProps) {
  const messages = useMessages();
  const t = messages.bench;
  const roles = messages.cutList.cabinet.roles;
  const flatItems = useMemo(() => benchItems(project, roles), [project, roles]);
  // T391 "Katla": ACM parts folded along their V-grooves (view state, never stored).
  const machinedFace = project.stock.machinedFace;
  const foldTool = useMemo(
    () => (vGroove?.traits ? foldToolOf({ stock: { machinedFace } }, vGroove) : null),
    [vGroove, machinedFace],
  );
  const [fold, setFold] = useState<FoldState>(NO_FOLD);
  const folded = useMemo(() => applyFold(flatItems, foldTool, fold), [flatItems, foldTool, fold]);
  const items = folded.items;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const material = project.stock.material;
  const [tone, setTone] = useState<{ material: string; colors: BenchColors | null }>(() => ({
    material,
    colors: typeof document === 'undefined' ? null : readColors(material),
  }));
  // Another stock material: new base colour (state reset during render, no effect).
  if (tone.material !== material) setTone({ material, colors: readColors(material) });
  useEffect(
    () => onThemeChange(() => setTone({ material, colors: readColors(material) })),
    [material],
  );
  const colors = tone.colors;
  const [simple] = useState(() => typeof window !== 'undefined' && readSimple3d());

  const [mode, setMode] = useState<BenchMode>('move');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mateA, setMateA] = useState<{ id: string; face: BoxFace; point: V3 } | null>(null);
  const [slide, setSlide] = useState<(BenchSlide & { aId: string; face: BoxFace }) | null>(null);
  const [snapped, setSnapped] = useState(false);
  const [query, setQuery] = useState('');
  const [isolated, setIsolated] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraCmd>({ kind: 'view', view: 'iso', n: 0 });
  const [view, setView] = useState<BenchView>('iso');
  const [step, setStep] = useState<{ rot: number; move: number }>({ rot: 15, move: 1 });
  const capture = useRef<CaptureFn | null>(null);
  const setCapture = useCallback((fn: CaptureFn | null) => {
    capture.current = fn;
  }, []);

  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  // A selection whose part was deleted goes away by itself.
  if (selectedId && !selected) setSelectedId(null);
  if (isolated && !byId.has(isolated)) setIsolated(null);

  const shown = useMemo(
    () => items.filter((i) => !i.hidden && (isolated === null || i.id === isolated)),
    [items, isolated],
  );

  // "Oturuyor mu?" (T388): re-checks the visible parts after every edit while on.
  const [checkOn, setCheckOn] = useState(false);
  const fit = useFitCheck(shown, checkOn);
  const marks = useMemo(() => {
    const m = new Map<string, BenchMark>();
    for (const x of fit.result?.issues ?? []) {
      if (x.kind === 'overlap') {
        m.set(x.a, 'danger');
        m.set(x.b, 'danger');
      } else if (x.kind === 'hole' && !x.ok) {
        for (const id of [x.a, x.b]) if (!m.has(id)) m.set(id, 'warning');
      }
    }
    // T391: a folded part whose flanges clash (or miss a corner relief) is red.
    const clash = new Set(
      folded.parts.filter((p) => p.check.state === 'clash').map((p) => p.partId),
    );
    if (clash.size > 0) for (const it of shown) if (clash.has(it.partId)) m.set(it.id, 'danger');
    return m;
  }, [fit.result, folded.parts, shown]);

  // Explode and section (T389): display only, never stored.
  const [explode, setExplode] = useState(0);
  const [section, setSection] = useState<Section | null>(null);
  const display = useMemo(() => {
    if (explode <= 0) return shown;
    const off = explodeOffsets(shown, explode / 100);
    return shown.map((i) => exploded(i, off));
  }, [shown, explode]);
  const displayBounds = useMemo(() => boundsOf(display), [display]);
  const locked = explode > 0;
  // Bağlantı elemanı (T390): markers through aligned holes of the shown parts, at their real
  // places (left out while exploded: the parts move apart).
  const [fastenersOn, setFastenersOn] = useState(true);
  const fasteners = useMemo(() => fastenersOf(shown), [shown]);
  const rows = useMemo(() => fastenerRows(fasteners), [fasteners]);

  const commit = useCallback(
    (id: string, pose: Pose, hidden?: boolean) => {
      const item = byId.get(id);
      if (!item) return false;
      return run('setAssemblyInstances', {
        instances: [instanceOf(item, pose, hidden ?? item.hidden)],
        updatedAt: now(),
      });
    },
    [byId, run],
  );

  const cam = useCallback((c: CameraReq) => {
    setCamera((prev) => ({ ...c, n: prev.n + 1 }) as CameraCmd);
  }, []);

  // Measure tool (T389): up to two snapped picks on the displayed (maybe exploded) parts.
  const [picks, setPicks] = useState<MeasurePick[]>([]);

  const endMate = useCallback(() => {
    setMateA(null);
    setSlide(null);
    setSnapped(false);
    setPicks([]);
  }, []);

  const changeMode = useCallback(
    (m: BenchMode) => {
      setMode(m);
      endMate();
    },
    [endMate],
  );

  const onPick = useCallback(
    (id: string, normal: V3, point: V3) => {
      const item = byId.get(id);
      if (!item) return;
      const face = faceFromNormal(item.pose.rotation, normal);
      if (!mateA || mateA.id === id || (slide && slide.id !== id && !mateA)) {
        // Step 1 (or a new first face, also after a finished mate).
        setSlide(null);
        setSnapped(false);
        setMateA({ id, face, point });
        return;
      }
      const a = byId.get(mateA.id);
      if (!a) return;
      const pose = mate(a.pose, a.box, mateA.face, item.pose, item.box, face, mateA.point);
      if (commit(id, pose)) {
        setSelectedId(id);
        setSlide({ id, frame: faceFrame(a.pose, a.box, mateA.face), aId: a.id, face: mateA.face });
        setMateA(null);
      }
    },
    [byId, mateA, slide, commit],
  );

  // The slide frame follows A when A moves (undo, numeric edit).
  const slideFrame = useMemo(() => {
    if (!slide) return null;
    const a = byId.get(slide.aId);
    if (!a || !byId.has(slide.id)) return null;
    return { id: slide.id, frame: faceFrame(a.pose, a.box, slide.face) };
  }, [slide, byId]);

  // T394 (CTO #14 M2): toasts dock at the canvas bottom-right (WorkspaceLayout, lib/toast-dock);
  // the B-M1 / B67 top offset under the bench toolbar is gone.

  // "?" opens the bench's own shortcut sheet first (T136 pattern).
  useEffect(() => claimPageGroup('bench'), []);

  // Keys: W / E / M tools, Esc, H hide, F fit, + / − zoom; Shift = free, Ctrl = 90° while turning.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      setStep({ rot: e.shiftKey ? 0 : mod ? 90 : 15, move: e.shiftKey ? 0 : 1 });
      if (e.type !== 'keydown' || e.altKey || mod) return;
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      const k = e.key.toLowerCase();
      // T397 (CTO #14 P6): exploded parts cannot be moved; the editing tools stay off.
      if (locked && (k === 'w' || k === 'e' || k === 'm')) return;
      if (k === 'w') changeMode('move');
      else if (k === 'e') changeMode('rotate');
      else if (k === 'm') changeMode('mate');
      else if (k === 'u') changeMode('measure');
      else if (k === 'escape') {
        if (mateA || slide || picks.length > 0) endMate();
        else setSelectedId(null);
      } else if (k === 'h' && selected) commit(selected.id, selected.pose, !selected.hidden);
      else if (k === 'f') cam({ kind: 'fit' });
      else if (k === '+' || k === '=') cam({ kind: 'zoom', dir: 1 });
      else if (k === '-') cam({ kind: 'zoom', dir: -1 });
      else return;
      e.preventDefault();
    }
    function onUp(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      setStep({ rot: e.shiftKey ? 0 : mod ? 90 : 15, move: e.shiftKey ? 0 : 1 });
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [changeMode, endMate, mateA, slide, picks, selected, commit, cam, locked]);

  const pickPoints = useMemo(() => picks.map((p) => p.point), [picks]);
  const measured = picks.length === 2 && picks[0] && picks[1] ? measure(picks[0], picks[1]) : null;
  const hint = measured
    ? [
        fill(t.measure.distance, { mm: MM1.format(measured.distance) }),
        fill(t.measure.delta, {
          x: MM1.format(Math.abs(measured.delta[0])),
          y: MM1.format(Math.abs(measured.delta[1])),
          z: MM1.format(Math.abs(measured.delta[2])),
        }),
        ...(measured.faceGap !== null
          ? [fill(t.measure.faceGap, { mm: MM1.format(measured.faceGap) })]
          : []),
      ].join(' · ')
    : mode === 'measure'
      ? picks.length === 1
        ? t.hints.measureB
        : t.hints.measureA
      : locked
        ? t.tools.locked
        : slide
          ? snapped
            ? `${t.hints.snapped} · ${t.hints.slide}`
            : t.hints.slide
          : mode === 'mate'
            ? mateA
              ? t.hints.mateB
              : t.hints.mateA
            : !selected
              ? t.hints.select
              : mode === 'rotate'
                ? t.hints.rotate
                : t.hints.move;

  const host = useRef<HTMLDivElement>(null);
  // Perf read-out straight to the DOM (no React render per frame), like the 3D preview (T159).
  const onStats = useCallback((s: { fps: number | null; drawCalls: number }) => {
    const d = host.current?.dataset;
    if (!d) return;
    d.fps = s.fps === null ? '' : String(Math.round(s.fps));
    d.drawCalls = String(s.drawCalls);
    d.ready = 'true';
  }, []);
  const total = items.length;
  const placed = items.filter((i) => i.placed).length;

  const canvas = (
    <div
      ref={host}
      className="absolute inset-0 overflow-hidden bg-linear-to-b from-surface-subtle to-canvas"
      role="application"
      aria-label={fill(t.canvasLabel, { count: total })}
      data-testid="bench"
      data-mode={mode}
      data-selected={selectedId ?? ''}
      data-mate={mateA ? 'b' : slide ? 'slide' : ''}
      data-snapped={snapped ? 'true' : 'false'}
      data-shown={shown.length}
      data-placed={placed}
      data-view={view}
      data-explode={explode}
      data-fold={folded.parts.length > 0 ? fold.pct : ''}
      data-measure={measured ? measured.distance.toFixed(2) : ''}
      data-face-gap={measured?.faceGap != null ? measured.faceGap.toFixed(2) : ''}
      data-picks={picks.map((p) => p.kind).join(',')}
      data-section={
        section ? `${'xyz'[section.axis]}:${section.at}${section.flip ? ':flip' : ''}` : ''
      }
      data-check={checkOn ? (fit.result && !fit.busy ? 'done' : 'busy') : ''}
      // An empty bench has no scene to report a frame: it is ready at once (B-M1 tester note).
      {...(total === 0 ? { 'data-ready': 'true' } : {})}
    >
      {total === 0 ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-fg-muted">
          {t.empty}
        </div>
      ) : colors ? (
        <CanvasBoundary testId="bench-crashed">
          <BenchScene
            items={display}
            colors={colors}
            simple={simple}
            mode={locked && mode !== 'measure' ? 'move' : mode}
            selectedId={selectedId}
            pickedFace={mateA ? { id: mateA.id, face: mateA.face } : null}
            slide={slideFrame}
            marks={marks}
            fasteners={fastenersOn && !locked ? fasteners : undefined}
            section={section}
            locked={locked}
            measurePoints={pickPoints}
            onMeasure={(id, normal, point, tol) => {
              const it = display.find((i) => i.id === id);
              if (!it) return;
              const p = snapPick(
                { id, pose: it.pose, box: it.box, edges: it.mesh.edges },
                point,
                normal,
                tol,
              );
              setPicks((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
            }}
            rotationStep={step.rot}
            moveStep={step.move}
            camera={camera}
            onSelect={setSelectedId}
            onPick={onPick}
            onCommit={(id, pose) => commit(id, pose)}
            onSnap={setSnapped}
            onCapture={setCapture}
            onStats={onStats}
          />
        </CanvasBoundary>
      ) : (
        <BenchLoading />
      )}
    </div>
  );

  // T397 (CTO #14 P7): the fit results float over the canvas's lower-left corner (above the
  // hint), so the selected part's position fields in the right column stay in view.
  const fitPanel = checkOn ? (
    <FitPanel
      className="pointer-events-auto min-h-0 w-80 max-w-full overflow-y-auto bg-surface/95 shadow-md backdrop-blur-sm"
      t={t}
      state={fit}
      byId={byId}
      onClose={() => setCheckOn(false)}
      onFrame={(a, b) => {
        const ia = byId.get(a);
        const ib = byId.get(b);
        if (!ia || !ib) return;
        const ba = worldBounds(ia.pose, ia.box);
        const bb = worldBounds(ib.pose, ib.box);
        cam({
          kind: 'frame',
          min: [
            Math.min(ba.min[0], bb.min[0]),
            Math.min(ba.min[1], bb.min[1]),
            Math.min(ba.min[2], bb.min[2]),
          ],
          max: [
            Math.max(ba.max[0], bb.max[0]),
            Math.max(ba.max[1], bb.max[1]),
            Math.max(ba.max[2], bb.max[2]),
          ],
        });
      }}
    />
  ) : null;

  const overlay = (
    <>
      {/* B67: leaves room for the zoom group on the right (from 640 px it shares the row), so
          "Oturuyor mu?" wraps to a second row instead of sliding under the zoom buttons.
          The empty part of a wrapped row lets canvas drags (orbit) through. */}
      <div
        data-testid="bench-toolbar"
        className="absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2 sm:max-w-[calc(100%-11rem)] pointer-events-none [&>*]:pointer-events-auto"
      >
        {viewSwitch}
        <div
          role="radiogroup"
          aria-label={t.modes.label}
          className="flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 p-0.5 shadow-sm backdrop-blur-sm"
        >
          {(
            [
              ['move', Move3d, 'benchMove'],
              ['rotate', Rotate3d, 'benchRotate'],
              ['mate', Magnet, 'benchMate'],
              ['measure', Ruler, 'benchMeasure'],
            ] as const
          ).map(([m, Icon, key]) => {
            // T397 (CTO #14 P6): exploded parts cannot move, so Taşı / Döndür / Oturt are off
            // (aria-disabled keeps the reason reachable as a tooltip); Ölç still works. At 0 %
            // the tool chosen before is active again.
            const off = locked && m !== 'measure';
            const on = mode === m && !off;
            return (
              <Tooltip key={m} content={off ? t.tools.locked : withShortcut(t.modeTips[m], key)}>
                <Button
                  role="radio"
                  aria-checked={on}
                  aria-disabled={off || undefined}
                  variant="ghost"
                  size="sm"
                  data-testid={`bench-mode-${m}`}
                  aria-keyshortcuts={ariaKeyShortcuts(shortcutById(key).keys, false)}
                  onClick={() => {
                    if (!off) changeMode(m);
                  }}
                  className={cn(
                    'gap-1.5 px-2.5',
                    on && 'bg-accent-subtle text-accent-text hover:text-accent-text',
                    off &&
                      'cursor-not-allowed text-fg-disabled hover:bg-transparent hover:text-fg-disabled',
                  )}
                >
                  <Icon aria-hidden />
                  <span className="max-md:sr-only">{t.modes[m]}</span>
                </Button>
              </Tooltip>
            );
          })}
        </div>
        <Tooltip content={t.check.tip}>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={checkOn}
            data-testid="bench-check-toggle"
            onClick={() => setCheckOn((v) => !v)}
            className={cn(
              'gap-1.5 bg-surface/95 px-2.5 shadow-sm backdrop-blur-sm',
              checkOn && 'bg-accent-subtle text-accent-text hover:text-accent-text',
            )}
          >
            <ScanSearch aria-hidden />
            <span className="max-md:sr-only">{t.check.button}</span>
          </Button>
        </Tooltip>
      </div>
      <div
        data-testid="bench-zoom"
        className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 p-0.5 shadow-sm backdrop-blur-sm max-sm:top-14"
      >
        <Tooltip content={withShortcut(t.zoomIn, 'canvasZoomIn')}>
          <IconButton aria-label={t.zoomIn} size="sm" onClick={() => cam({ kind: 'zoom', dir: 1 })}>
            <ZoomIn aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content={withShortcut(t.zoomOut, 'canvasZoomOut')}>
          <IconButton
            aria-label={t.zoomOut}
            size="sm"
            onClick={() => cam({ kind: 'zoom', dir: -1 })}
          >
            <ZoomOut aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content={withShortcut(t.fit, 'canvasFit')}>
          <IconButton
            aria-label={t.fit}
            size="sm"
            data-testid="bench-fit"
            onClick={() => cam({ kind: 'fit' })}
          >
            <Maximize aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content={t.savePng}>
          <IconButton
            aria-label={t.savePng}
            size="sm"
            onClick={() => {
              const url = capture.current?.();
              if (url) void exportPng(url, 'nittcam-montaj-gorseli.png');
            }}
          >
            <ImageDown aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
      <div
        role="group"
        aria-label={t.views.label}
        data-testid="bench-views"
        data-toast-avoid=""
        className="absolute right-2 bottom-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 p-0.5 shadow-sm backdrop-blur-sm max-sm:bottom-14"
      >
        {(['top', 'front', 'right', 'iso'] as const).map((v) => (
          <Tooltip key={v} content={fill(t.viewTip, { view: t.views[v] })}>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={view === v}
              data-testid={`bench-view-${v}`}
              className={cn(
                'px-2.5',
                view === v && 'bg-accent-subtle text-accent-text hover:text-accent-text',
              )}
              onClick={() => {
                setView(v);
                cam({ kind: 'view', view: v });
              }}
            >
              {t.views[v]}
            </Button>
          </Tooltip>
        ))}
      </div>
      <div
        data-toast-avoid=""
        className="pointer-events-none absolute bottom-2 left-2 z-10 flex max-h-[calc(100%-7rem)] max-w-[calc(100%-1rem)] flex-col items-start gap-2 sm:max-w-[min(36rem,calc(100%-21rem))]"
      >
        {fitPanel}
        <p
          role="status"
          aria-live="polite"
          data-testid="bench-hint"
          className={cn(
            'shrink-0 rounded-lg border bg-surface/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm',
            snapped ? 'border-success-border text-success-text' : 'border-border text-fg-muted',
          )}
        >
          {hint}
        </p>
      </div>
    </>
  );

  return (
    <WorkspaceLayout
      testId="bench-workspace"
      labels={t.workspace}
      leftHeader={
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h2 className="truncate font-semibold text-fg">{t.workspace.left}</h2>
          <span className="shrink-0 text-xs text-fg-muted tabular-nums">
            {fill(t.list.count, { shown: shown.length, total })}
          </span>
        </div>
      }
      left={
        <PartList
          t={t}
          items={items}
          query={query}
          onQuery={setQuery}
          selectedId={selectedId}
          isolated={isolated}
          onSelect={(id) => {
            setSelectedId(id);
            if (mode === 'mate') changeMode('move');
          }}
          onToggle={(item) => commit(item.id, item.pose, !item.hidden)}
          onIsolate={(id) => {
            setIsolated(id);
            cam({ kind: 'fit' });
          }}
        />
      }
      rightHeader={<h2 className="truncate font-semibold text-fg">{t.workspace.right}</h2>}
      right={
        <>
          <ViewTools
            t={t}
            explode={explode}
            onExplode={(v) => {
              if (v > 0) endMate();
              setExplode(v);
            }}
            section={section}
            onSection={setSection}
            bounds={displayBounds}
            sheet={project.assembly?.sheet === true}
            onSheet={(on) => run('setAssemblySheet', { on, updatedAt: now() })}
            fasteners={fastenersOn}
            onFasteners={setFastenersOn}
            fastenerRows={rows}
          />
          {folded.parts.length > 0 && foldTool ? (
            <FoldTools
              t={t.fold}
              parts={folded.parts}
              state={fold}
              onState={setFold}
              focusPartId={selected?.partId ?? null}
              vAngle={foldTool.angleDeg}
              noTool={!vGroove?.tool}
            />
          ) : null}
          <Inspector
            t={t}
            materials={messages.materials}
            stock={stockLook(project)}
            onLook={(material, thickness) =>
              selected &&
              run('setAssemblyPartLook', {
                partId: selected.partId,
                material,
                ...(material ? { thickness } : {}),
                updatedAt: now(),
              })
            }
            item={selected}
            onPose={(pose) => selected && commit(selected.id, pose)}
            onHide={() => selected && commit(selected.id, selected.pose, !selected.hidden)}
            onReset={() =>
              selected && run('resetAssembly', { ids: [selected.id], updatedAt: now() })
            }
            onResetAll={() => run('resetAssembly', { updatedAt: now() })}
            anyPlaced={placed > 0}
          />
        </>
      }
      canvas={canvas}
      canvasOverlay={total > 0 ? overlay : null}
    />
  );
}

function BenchLoading() {
  const t = useMessages().bench;
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex h-full items-center justify-center text-sm text-fg-muted"
    >
      <Box aria-hidden className="mr-2 size-4 animate-pulse" />
      {t.loading}
    </div>
  );
}

function PartList({
  t,
  items,
  query,
  onQuery,
  selectedId,
  isolated,
  onSelect,
  onToggle,
  onIsolate,
}: {
  t: T;
  items: readonly BenchItem[];
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  isolated: string | null;
  onSelect: (id: string) => void;
  onToggle: (item: BenchItem) => void;
  onIsolate: (id: string | null) => void;
}) {
  const fold = (s: string) => s.toLocaleLowerCase('tr');
  const q = fold(query.trim());
  const list = q ? items.filter((i) => fold(`${i.part.name} ${i.group ?? ''}`).includes(q)) : items;
  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="bench-parts">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t.list.search}
          aria-label={t.list.searchLabel}
          className="pl-8"
          data-testid="bench-search"
        />
      </div>
      {isolated ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onIsolate(null)}
          data-testid="bench-isolate-off"
        >
          <Eye aria-hidden />
          {t.list.isolateOff}
        </Button>
      ) : null}
      {list.length === 0 ? (
        <p className="px-1 py-2 text-sm text-fg-muted">{t.list.noMatch}</p>
      ) : (
        <ul className="flex flex-col" aria-label={t.workspace.left}>
          {list.map((item) => {
            const qty = item.part.qty;
            const active = item.id === selectedId;
            return (
              <li
                key={item.id}
                data-testid="bench-part"
                data-id={item.id}
                data-hidden={item.hidden ? 'true' : 'false'}
                className={cn(
                  'group flex h-row items-center gap-1 rounded-md pr-1',
                  active ? 'bg-accent-subtle' : 'hover:bg-surface-hover',
                )}
              >
                <Button
                  variant="ghost"
                  aria-pressed={active}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'h-full min-w-0 flex-1 flex-col items-start justify-center gap-0 px-2 text-left hover:bg-transparent',
                    item.hidden && 'text-fg-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'w-full truncate text-sm',
                      active ? 'font-medium text-accent-text' : 'text-fg',
                    )}
                  >
                    {item.part.name || item.partId}
                    {qty > 1 ? (
                      <span className="text-fg-muted">
                        {' '}
                        · {fill(t.list.copy, { n: item.copy + 1 })}
                      </span>
                    ) : null}
                  </span>
                  {item.group ? (
                    <span className="w-full truncate text-2xs text-fg-muted">{item.group}</span>
                  ) : null}
                </Button>
                {item.placed ? (
                  <Badge variant="neutral" className="shrink-0 max-sm:hidden">
                    {t.list.moved}
                  </Badge>
                ) : null}
                <Tooltip content={t.list.isolate}>
                  <IconButton
                    aria-label={t.list.isolate}
                    size="sm"
                    onClick={() => onIsolate(item.id)}
                    aria-pressed={isolated === item.id}
                  >
                    <Focus aria-hidden />
                  </IconButton>
                </Tooltip>
                <Tooltip content={item.hidden ? t.list.show : t.list.hide}>
                  <IconButton
                    aria-label={item.hidden ? t.list.show : t.list.hide}
                    size="sm"
                    data-testid="bench-part-eye"
                    onClick={() => onToggle(item)}
                  >
                    {item.hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </IconButton>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A number field that commits on blur or Enter (one undo step per edit, not per keystroke). */
function CommitField({
  label,
  value,
  unit,
  testId,
  onCommit,
}: {
  label: string;
  value: number;
  unit: string;
  testId: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(value);
  const [shownFor, setShownFor] = useState(value);
  if (shownFor !== value) {
    setShownFor(value);
    setDraft(value);
  }
  const done = () => {
    if (draft !== null && Math.abs(draft - value) > 1e-9) onCommit(draft);
    else setDraft(value);
  };
  return (
    <NumberInput
      aria-label={label}
      value={draft}
      onValueChange={setDraft}
      unit={unit}
      maxDecimals={2}
      inputSize="sm"
      data-testid={testId}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done();
      }}
    />
  );
}

const STOCK = 'stock';

/**
 * T390 (D-131): material and real thickness of the selected part in the assembly, so an aluminium
 * bracket can sit on a wood panel. Display only: nesting, toolpath and NC keep the stock.
 */
function LookFields({
  t,
  materials,
  stock,
  item,
  thickness,
  onLook,
}: {
  t: T;
  materials: Messages['materials'];
  stock: MaterialKind;
  item: BenchItem;
  thickness: number;
  onLook: (material: MaterialKind | null, thickness: number) => void;
}) {
  const value = item.ownLook ? item.look : STOCK;
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid="bench-look">
      <legend className="mb-1 text-xs font-medium text-fg-muted">{t.inspector.material}</legend>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === value) return;
          if (v === STOCK) return onLook(null, thickness);
          const kind = v as MaterialKind;
          // A metal part starts at its kind's first common thickness unless it has its own.
          const presets = MATERIAL_TRAITS[kind].thicknessPresets;
          const keep = item.ownLook || presets.length === 0 || presets.includes(thickness);
          onLook(kind, keep ? thickness : (defaultThicknessOf(MATERIAL_TRAITS[kind]) ?? thickness));
        }}
      >
        <SelectTrigger size="sm" aria-label={t.inspector.material} data-testid="bench-material">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={STOCK}>
            {fill(t.inspector.stock, { name: materials[stock] })}
          </SelectItem>
          {MATERIAL_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {materials[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {item.ownLook ? (
        <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-sm">
          <span className="text-fg-muted">{t.inspector.thickness}</span>
          <CommitField
            label={t.inspector.thickness}
            value={thickness}
            unit="mm"
            testId="bench-thickness"
            onCommit={(v) => {
              if (v >= 0.1 && v <= 200) onLook(item.look, v);
            }}
          />
        </label>
      ) : null}
      {item.ownLook ? <p className="text-xs text-fg-subtle">{t.inspector.lookHint}</p> : null}
    </fieldset>
  );
}

function Inspector({
  t,
  materials,
  stock,
  onLook,
  item,
  onPose,
  onHide,
  onReset,
  onResetAll,
  anyPlaced,
}: {
  t: T;
  materials: Messages['materials'];
  stock: MaterialKind;
  /** T390: show the part in another material (null = the stock's) and thickness. */
  onLook: (material: MaterialKind | null, thickness: number) => void;
  item: BenchItem | null;
  onPose: (pose: Pose) => void;
  onHide: () => void;
  onReset: () => void;
  onResetAll: () => void;
  anyPlaced: boolean;
}) {
  const resetAll = (
    <Tooltip content={t.inspector.resetAllTip}>
      <Button
        variant="outline"
        size="sm"
        disabled={!anyPlaced}
        onClick={onResetAll}
        data-testid="bench-reset-all"
      >
        <RotateCcw aria-hidden />
        {t.inspector.resetAll}
      </Button>
    </Tooltip>
  );
  if (!item)
    return (
      <div className="flex flex-col gap-4" data-testid="bench-inspector">
        <p className="text-sm text-fg-muted">{t.inspector.none}</p>
        <p className="text-xs text-fg-subtle">{t.displayOnly}</p>
        {resetAll}
      </div>
    );
  const size = boxSize(item.box);
  const angles = eulerDeg(item.pose.rotation);
  const axes = ['x', 'y', 'z'] as const;
  const setPos = (k: number, v: number) => {
    const position: V3 = [...item.pose.position];
    position[k] = v;
    onPose({ ...item.pose, position });
  };
  const setAngle = (k: number, v: number) => {
    const e: V3 = [...angles];
    e[k] = v;
    onPose({ ...item.pose, rotation: quatFromEulerDeg(e) });
  };
  const toFloor = () => {
    const b = worldBounds(item.pose, item.box);
    const p: V3 = [...item.pose.position];
    p[1] -= b.min[1];
    onPose({ ...item.pose, position: p });
  };
  return (
    <div className="flex flex-col gap-4" data-testid="bench-inspector" data-id={item.id}>
      <div className="min-w-0">
        <p className="truncate font-medium text-fg">
          {item.part.name || item.partId}
          {item.part.qty > 1 ? (
            <span className="text-fg-muted"> · {fill(t.list.copy, { n: item.copy + 1 })}</span>
          ) : null}
        </p>
        <p className="text-xs text-fg-muted">
          {t.inspector.size}: <Measure value={[size[0], size[1], size[2]]} unit="mm" />
        </p>
      </div>
      <LookFields
        t={t}
        materials={materials}
        stock={stock}
        item={item}
        thickness={size[2]}
        onLook={onLook}
      />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium text-fg-muted">{t.inspector.position}</legend>
        {axes.map((a, k) => (
          <label key={a} className="grid grid-cols-[1.25rem_1fr] items-center gap-2 text-sm">
            <span className="font-mono text-fg-muted">{t.inspector[a]}</span>
            <CommitField
              label={fill(t.inspector.posLabel, { axis: t.inspector[a] })}
              value={Math.round((item.pose.position[k] ?? 0) * 100) / 100}
              unit="mm"
              testId={`bench-pos-${a}`}
              onCommit={(v) => setPos(k, v)}
            />
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium text-fg-muted">{t.inspector.angles}</legend>
        {axes.map((a, k) => (
          <div key={a} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-2 text-sm">
            <span className="font-mono text-fg-muted">{t.inspector[a]}</span>
            <CommitField
              label={fill(t.inspector.angleLabel, { axis: t.inspector[a] })}
              value={angles[k] ?? 0}
              unit="°"
              testId={`bench-angle-${a}`}
              onCommit={(v) => setAngle(k, v)}
            />
            <Tooltip content={fill(t.inspector.turnTip, { axis: t.inspector[a] })}>
              <Button
                variant="outline"
                size="sm"
                className="px-2"
                aria-label={fill(t.inspector.turnTip, { axis: t.inspector[a] })}
                data-testid={`bench-turn-${a}`}
                onClick={() => onPose(turnAbout(item.pose, k as 0 | 1 | 2, 90))}
              >
                {t.inspector.turn}
              </Button>
            </Tooltip>
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Tooltip content={t.inspector.floorTip}>
          <Button variant="outline" size="sm" onClick={toFloor} data-testid="bench-floor">
            <ArrowDownToLine aria-hidden />
            {t.inspector.floor}
          </Button>
        </Tooltip>
        <Button variant="outline" size="sm" onClick={onHide} data-testid="bench-hide">
          {item.hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
          {item.hidden ? t.inspector.show : t.inspector.hide}
        </Button>
        <Tooltip content={t.inspector.resetTip}>
          <Button
            variant="outline"
            size="sm"
            disabled={!item.placed}
            onClick={onReset}
            data-testid="bench-reset"
          >
            <RotateCcw aria-hidden />
            {t.inspector.reset}
          </Button>
        </Tooltip>
      </div>
      <div className="border-t border-border-subtle pt-3">{resetAll}</div>
      <p className="text-xs text-fg-subtle">{t.displayOnly}</p>
    </div>
  );
}

export default AssemblyBench;
