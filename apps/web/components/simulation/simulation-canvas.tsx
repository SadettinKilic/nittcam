'use client';

import { positionAt, simPlayheadAt, type SimMachineFrame, type SimSheet } from '@nittcam/core';
import type Konva from 'konva';
import { memo, useEffect, useMemo, useRef } from 'react';
import { Arrow, Circle, Group, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva';
import type { DrawnPart, ViewState } from '../layout-view/model';
import { zoomAt } from '../layout-view/zoom';
import { DEPTH_LEVELS, depthLevel, depthRamp, toolDiameterOf, type SimColors } from './model';
import { canvasMonoFont } from '../../lib/canvas-theme';

/**
 * Konva drawing of the simulation (T020, spec §6.5). Units inside the stage are millimetres in a
 * Y-down canvas frame (`cy = sheetHeight − y`), like the layout view (D-020).
 *
 * Two layers: a static one (table, travel, sheet with margin and waste, light parts, grain arrow,
 * machine zero; `listening={false}`) and the path layer, a single `Shape` whose scene function
 * draws the prebuilt read path up to the playhead in a few batched strokes (rapids dashed, cuts
 * grouped by depth colour), direction arrows, cut-order badges and the tool circle. A new playhead
 * only redraws that layer (`batchDraw`, coalesced to one frame).
 */
export interface SimulationCanvasProps {
  width: number;
  height: number;
  sim: SimSheet;
  sheet: { width: number; height: number; grain: 0 | 90 };
  margin: number;
  parts: readonly DrawnPart[];
  machine: SimMachineFrame | null;
  view: ViewState;
  colors: SimColors;
  /** Playhead, s. */
  time: number;
  onViewChange: (view: ViewState) => void;
  /** Keeps a dragged pan inside the allowed range (the sheet stays partly visible). */
  clampPan: (x: number, y: number, scale: number) => { x: number; y: number };
}

const StaticLayer = memo(function StaticLayer({
  sheet,
  margin,
  parts,
  machine,
  colors,
  scale,
}: Pick<SimulationCanvasProps, 'sheet' | 'margin' | 'parts' | 'machine' | 'colors'> & {
  scale: number;
}) {
  const { width: W, height: H } = sheet;
  const px = 1 / scale;
  const flip = (r: { x: number; y: number; width: number; height: number }) => ({
    x: r.x,
    y: H - r.y - r.height,
    width: r.width,
    height: r.height,
  });
  const zero = machine ? { x: machine.zero.x, y: H - machine.zero.y } : null;
  const axis = 60 * px;
  return (
    <Layer listening={false}>
      {machine ? (
        <>
          <Rect
            {...flip(machine.envelope)}
            stroke={colors.envelope}
            strokeWidth={px}
            dash={[2 * px, 4 * px]}
            perfectDrawEnabled={false}
          />
          <Rect
            {...flip(machine.table)}
            stroke={colors.table}
            strokeWidth={1.5 * px}
            dash={[10 * px, 5 * px]}
            perfectDrawEnabled={false}
          />
        </>
      ) : null}
      <Rect x={0} y={0} width={W} height={H} fill={colors.margin} perfectDrawEnabled={false} />
      <Rect
        x={margin}
        y={margin}
        width={Math.max(0, W - 2 * margin)}
        height={Math.max(0, H - 2 * margin)}
        fill={colors.waste}
        perfectDrawEnabled={false}
      />
      <Shape
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(context) => {
          const ctx = (context as unknown as { _context: CanvasRenderingContext2D })._context;
          ctx.beginPath();
          for (const p of parts) ctx.rect(p.x, H - p.y - p.h, p.w, p.h);
          ctx.fillStyle = colors.part;
          ctx.fill();
          ctx.lineWidth = px;
          ctx.strokeStyle = colors.partStroke;
          ctx.stroke();
        }}
      />
      <Rect
        x={0}
        y={0}
        width={W}
        height={H}
        stroke={colors.edge}
        strokeWidth={2 * px}
        perfectDrawEnabled={false}
      />
      {zero ? (
        <Group x={zero.x} y={zero.y}>
          <Arrow
            points={[0, 0, (machine?.xSign ?? 1) * axis, 0]}
            stroke={colors.zero}
            fill={colors.zero}
            strokeWidth={1.5 * px}
            pointerLength={6 * px}
            pointerWidth={6 * px}
            perfectDrawEnabled={false}
          />
          <Arrow
            points={[0, 0, 0, -(machine?.ySign ?? 1) * axis]}
            stroke={colors.zero}
            fill={colors.zero}
            strokeWidth={1.5 * px}
            pointerLength={6 * px}
            pointerWidth={6 * px}
            perfectDrawEnabled={false}
          />
          <Text
            text="X+"
            x={(machine?.xSign ?? 1) * (axis + 4 * px) - (machine?.xSign === -1 ? 14 * px : 0)}
            y={-6 * px}
            fontSize={11 * px}
            fontFamily={canvasMonoFont()}
            fontStyle="bold"
            fill={colors.zero}
            perfectDrawEnabled={false}
          />
          <Text
            text="Y+"
            x={-7 * px}
            y={-(machine?.ySign ?? 1) * (axis + 6 * px) - (machine?.ySign === -1 ? 0 : 11 * px)}
            fontSize={11 * px}
            fontFamily={canvasMonoFont()}
            fontStyle="bold"
            fill={colors.zero}
            perfectDrawEnabled={false}
          />
          <Circle radius={5 * px} fill={colors.zero} perfectDrawEnabled={false} />
          <Line
            points={[-10 * px, 0, 10 * px, 0]}
            stroke={colors.zero}
            strokeWidth={px}
            perfectDrawEnabled={false}
          />
          <Line
            points={[0, -10 * px, 0, 10 * px]}
            stroke={colors.zero}
            strokeWidth={px}
            perfectDrawEnabled={false}
          />
        </Group>
      ) : null}
    </Layer>
  );
});

/** Canvas coordinates of the path points and per-step data, built once per sheet. */
interface Prebuilt {
  x: Float64Array;
  y: Float64Array;
  level: Uint8Array;
  maxLevel: number;
  /** Position known at the end of step i (the next step starts from a known XY). */
  endKnown: Uint8Array;
}

function prebuild(sim: SimSheet, sheetHeight: number): Prebuilt {
  const n = sim.points.length / 3;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    x[k] = sim.points[3 * k] ?? 0;
    y[k] = sheetHeight - (sim.points[3 * k + 1] ?? 0);
  }
  const level = new Uint8Array(sim.steps.length);
  const endKnown = new Uint8Array(sim.steps.length);
  let maxLevel = 0;
  sim.steps.forEach((s, i) => {
    const lv = depthLevel(s.zMin, sim.zBottom);
    level[i] = lv;
    if (s.kind === 'cut' && lv > maxLevel) maxLevel = lv;
    endKnown[i] = (sim.steps[i + 1]?.known ?? true) ? 1 : 0;
  });
  return { x, y, level, maxLevel, endKnown };
}

export default function SimulationCanvas(props: SimulationCanvasProps) {
  const { width, height, sim, sheet, view, onViewChange, colors } = props;
  const stage = useRef<Konva.Stage>(null);
  const pathShape = useRef<Konva.Shape>(null);
  const pinch = useRef<{ dist: number } | null>(null);
  const pre = useMemo(() => prebuild(sim, sheet.height), [sim, sheet.height]);
  const ramp = useMemo(
    () => depthRamp(colors.depthTop, colors.depthBottom, DEPTH_LEVELS),
    [colors.depthTop, colors.depthBottom],
  );
  // The scene function reads the latest values from this ref, so a new playhead needs no new node.
  const live = useRef({ time: props.time, scale: view.scale });
  useEffect(() => {
    live.current = { time: props.time, scale: view.scale };
    pathShape.current?.getLayer()?.batchDraw();
  }, [props.time, view.scale]);

  const H = sheet.height;

  function drawPath(context: Konva.Context) {
    const ctx = (context as unknown as { _context: CanvasRenderingContext2D })._context;
    const { time, scale } = live.current;
    const px = 1 / scale;
    const steps = sim.steps;
    const ph = simPlayheadAt(steps, time);
    const pos = positionAt(sim, time);
    const last = ph.active >= 0 ? ph.active : ph.done - 1;
    const { x, y } = pre;

    /** Adds step i to the current path (partially when it is the active step). */
    const add = (i: number) => {
      const s = steps[i];
      if (!s) return;
      ctx.moveTo(x[s.p0] ?? 0, y[s.p0] ?? 0);
      if (i !== ph.active) {
        for (let k = s.p0 + 1; k <= s.p1; k += 1) ctx.lineTo(x[k] ?? 0, y[k] ?? 0);
        return;
      }
      // Active step: whole sample points that lie before the tool, then the tool centre.
      const target = ph.fraction;
      let total = 0;
      for (let k = s.p0; k < s.p1; k += 1) {
        total += Math.hypot((x[k + 1] ?? 0) - (x[k] ?? 0), (y[k + 1] ?? 0) - (y[k] ?? 0));
      }
      let walked = 0;
      for (let k = s.p0 + 1; k < s.p1; k += 1) {
        walked += Math.hypot((x[k] ?? 0) - (x[k - 1] ?? 0), (y[k] ?? 0) - (y[k - 1] ?? 0));
        if (total > 0 && walked / total > target) break;
        ctx.lineTo(x[k] ?? 0, y[k] ?? 0);
      }
      ctx.lineTo(pos.x, H - pos.y);
    };

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Rapids: one dashed stroke.
    ctx.beginPath();
    for (let i = 0; i <= last; i += 1) {
      const s = steps[i];
      if (s && s.kind === 'rapid' && s.known) add(i);
    }
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = colors.rapid;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Cuts: one stroke per run of equal depth colour, in machining order (a tab band drawn after
    // the deeper pass shows lighter on top of it).
    ctx.lineWidth = 2 * px;
    let level = -1;
    for (let i = 0; i <= last; i += 1) {
      const s = steps[i];
      if (!s || s.kind !== 'cut') continue;
      const lv = pre.level[i] ?? 0;
      if (lv !== level) {
        if (level >= 0) ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = ramp[lv] ?? colors.depthBottom;
        level = lv;
      }
      add(i);
    }
    if (level >= 0) ctx.stroke();

    // Tabs: a contrasting band over the bridge plus a round marker that stays visible when the
    // bridge is only a few pixels long (fit to screen).
    ctx.strokeStyle = colors.tab;
    ctx.lineWidth = 5 * px;
    ctx.beginPath();
    for (let i = 0; i <= last; i += 1) {
      if (steps[i]?.tab) add(i);
    }
    ctx.stroke();
    for (let i = 0; i < ph.done; i += 1) {
      const s = steps[i];
      if (!s?.tab) continue;
      const k = Math.floor((s.p0 + s.p1) / 2);
      const mx = s.p1 - s.p0 === 1 ? ((x[s.p0] ?? 0) + (x[s.p1] ?? 0)) / 2 : (x[k] ?? 0);
      const my = s.p1 - s.p0 === 1 ? ((y[s.p0] ?? 0) + (y[s.p1] ?? 0)) / 2 : (y[k] ?? 0);
      ctx.beginPath();
      ctx.arc(mx, my, 3.5 * px, 0, 2 * Math.PI);
      ctx.fillStyle = colors.tab;
      ctx.fill();
      ctx.lineWidth = px;
      ctx.strokeStyle = colors.badge;
      ctx.stroke();
    }

    // Direction arrows on the straight final-depth cuts that are long enough on screen.
    ctx.fillStyle = colors.depthBottom;
    const arrow = 7 * px;
    for (let i = 0; i < ph.done; i += 1) {
      const s = steps[i];
      if (!s || s.kind !== 'cut' || s.p1 - s.p0 !== 1 || pre.level[i] !== pre.maxLevel) continue;
      const ax = x[s.p0] ?? 0;
      const ay = y[s.p0] ?? 0;
      const dx = (x[s.p1] ?? 0) - ax;
      const dy = (y[s.p1] ?? 0) - ay;
      const len = Math.hypot(dx, dy);
      if (len * scale < 48) continue;
      const ux = dx / len;
      const uy = dy / len;
      const mx = ax + dx / 2;
      const my = ay + dy / 2;
      ctx.beginPath();
      ctx.moveTo(mx + ux * arrow, my + uy * arrow);
      ctx.lineTo(
        mx - ux * arrow * 0.6 - uy * arrow * 0.7,
        my - uy * arrow * 0.6 + ux * arrow * 0.7,
      );
      ctx.lineTo(
        mx - ux * arrow * 0.6 + uy * arrow * 0.7,
        my - uy * arrow * 0.6 - ux * arrow * 0.7,
      );
      ctx.closePath();
      ctx.fill();
    }

    // Cut-order badges at each contour start reached so far.
    const r = 8 * px;
    ctx.font = `bold ${10 * px}px ${canvasMonoFont()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of sim.contours) {
      if (c.step > last) break;
      const bx = c.x - r * 0.9;
      const by = H - c.y - r * 0.9;
      ctx.beginPath();
      ctx.arc(bx, by, c.n > 99 ? r * 1.25 : r, 0, 2 * Math.PI);
      ctx.fillStyle = colors.badge;
      ctx.fill();
      ctx.fillStyle = colors.badgeFg;
      ctx.fillText(String(c.n), bx, by + 0.5 * px);
    }

    // Tool: translucent circle of the tool diameter at the tool centre, plus a centre mark.
    const visible =
      ph.active >= 0
        ? (steps[ph.active]?.known ?? false)
        : ph.done > 0 && pre.endKnown[ph.done - 1] === 1;
    const current = steps[last];
    if (visible && current) {
      const d = toolDiameterOf(sim, current.tool) ?? 6;
      const tx = pos.x;
      const ty = H - pos.y;
      const below = pos.z < 0;
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(d / 2, 3 * px), 0, 2 * Math.PI);
      ctx.globalAlpha = below ? 0.35 : 0.18;
      ctx.fillStyle = colors.tool;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = colors.tool;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx - 6 * px, ty);
      ctx.lineTo(tx + 6 * px, ty);
      ctx.moveTo(tx, ty - 6 * px);
      ctx.lineTo(tx, ty + 6 * px);
      ctx.lineWidth = px;
      ctx.stroke();
    }
  }

  return (
    <Stage
      ref={stage}
      width={width}
      height={height}
      scaleX={view.scale}
      scaleY={view.scale}
      x={view.x}
      y={view.y}
      draggable
      dragBoundFunc={(pos) => props.clampPan(pos.x, pos.y, view.scale)}
      onDragEnd={(e) => {
        if (e.target === e.target.getStage()) {
          onViewChange({ scale: view.scale, x: e.target.x(), y: e.target.y() });
        }
      }}
      onWheel={(e) => {
        e.evt.preventDefault();
        const p = stage.current?.getPointerPosition();
        if (!p) return;
        onViewChange(zoomAt(view, e.evt.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y));
      }}
      onTouchMove={(e) => {
        const touches = e.evt.touches;
        const a = touches[0];
        const b = touches[1];
        const st = stage.current;
        if (touches.length !== 2 || !a || !b || !st) return;
        e.evt.preventDefault();
        if (st.isDragging()) st.stopDrag();
        const rect = st.container().getBoundingClientRect();
        const cx = (a.clientX + b.clientX) / 2 - rect.left;
        const cy = (a.clientY + b.clientY) / 2 - rect.top;
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const prev = pinch.current;
        pinch.current = { dist };
        if (prev && prev.dist > 0) onViewChange(zoomAt(view, dist / prev.dist, cx, cy));
      }}
      onTouchEnd={() => {
        pinch.current = null;
      }}
    >
      <StaticLayer
        sheet={sheet}
        margin={props.margin}
        parts={props.parts}
        machine={props.machine}
        colors={colors}
        scale={view.scale}
      />
      <Layer listening={false}>
        <Shape ref={pathShape} listening={false} perfectDrawEnabled={false} sceneFunc={drawPath} />
      </Layer>
    </Stage>
  );
}
