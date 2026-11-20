'use client';

import type Konva from 'konva';
import { memo, useEffect, useMemo, useRef } from 'react';
import { Arrow, Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { CanvasColors, DrawnPart, ViewState } from './model';
import { zoomAt } from './zoom';
import { canvasMonoFont } from '../../lib/canvas-theme';
import { formatMm, partLabel } from '../../lib/canvas-labels';
import { grainArrowPoints, grainLines } from '../../lib/grain-texture';

/** True when the operator asked for less motion (no fade-in after "Diz"). */
function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * The Konva drawing of one sheet (T013, spec §3.6, §6.5). Loaded only in the browser (react-konva
 * needs a canvas). Units inside the stage are millimetres: the stage scale is pixels per mm and the
 * stage position is the pan. The sheet frame has its origin bottom-left and Y up (D-019), so a
 * part's top edge in canvas units is `sheetHeight - y - h`.
 *
 * Layers: a static layer (sheet, margin band, waste, grid; `listening={false}`, redrawn only when
 * the sheet or the zoom changes) and the parts layer. Parts are memoised so a drag redraws only
 * the dragged part and the parts whose conflict state changes.
 */
export interface LayoutCanvasProps {
  width: number;
  height: number;
  sheet: { width: number; height: number; grain: number | null };
  margin: number;
  parts: readonly DrawnPart[];
  view: ViewState;
  colors: CanvasColors;
  grid: boolean;
  /** Key of the selected part. */
  selected: string | null;
  /** Further parts of a multi-selection (Shift/Ctrl+click, T170), drawn as selected. */
  marked?: ReadonlySet<string>;
  /** Keys drawn in the conflict colour (the dragged part and what it collides with). */
  conflicts: ReadonlySet<string>;
  /** Unsaved position of the selected part (keyboard nudge or drag), mm. */
  pending: { x: number; y: number } | null;
  onViewChange: (view: ViewState) => void;
  /** `additive`: Shift/Ctrl/⌘ held, the part is toggled in the multi-selection (T170). */
  onSelect: (key: string | null, additive?: boolean) => void;
  /**
   * Live position of a dragged part (mm, rounded); the parent checks it. It may return a snapped
   * position (T170: neighbours at gap distance), which the part then jumps to. `free` = Alt held,
   * no snapping.
   */
  onDragMove: (
    key: string,
    x: number,
    y: number,
    free?: boolean,
  ) => { x: number; y: number } | undefined;
  /** Drop at (mm, rounded). Returns false when the drop is refused; the part then snaps back. */
  onDrop: (key: string, x: number, y: number, free?: boolean) => boolean;
  /**
   * Bumped after each "Diz" result (T196): the parts are remounted and fade/settle in, staggered,
   * ≤ 240 ms in total; 0 or reduced motion = no animation.
   */
  appearKey?: number;
  /** Stage drag pans the view (off on an un-zoomed touch canvas so the page can scroll, T198). */
  pannable?: boolean;
}

const SheetLayer = memo(function SheetLayer({
  sheet,
  margin,
  colors,
  grid,
  scale,
}: {
  sheet: LayoutCanvasProps['sheet'];
  margin: number;
  colors: CanvasColors;
  grid: boolean;
  scale: number;
}) {
  const { width: W, height: H } = sheet;
  const lines = useMemo(() => {
    if (!grid) return [];
    const out: number[][] = [];
    for (let x = 100; x < W; x += 100) out.push([x, 0, x, H]);
    for (let y = 100; y < H; y += 100) out.push([0, H - y, W, H - y]);
    return out;
  }, [grid, W, H]);
  const hair = 1 / scale;
  // Spacing in power-of-two mm steps so zooming does not rebuild the texture on every wheel tick.
  const grainStep = 2 ** Math.ceil(Math.log2(Math.max(1, 14 / scale)));
  const grainSegs = useMemo(
    () =>
      grainLines(W, H, sheet.grain, grainStep).map(([x1, y1, x2, y2]) => [x1, H - y1, x2, H - y2]),
    [W, H, sheet.grain, grainStep],
  );
  return (
    <Layer listening={false}>
      {/* Margin band = the whole sheet; the usable area (waste until parts cover it) on top. */}
      <Rect x={0} y={0} width={W} height={H} fill={colors.margin} perfectDrawEnabled={false} />
      <Rect
        x={margin}
        y={margin}
        width={Math.max(0, W - 2 * margin)}
        height={Math.max(0, H - 2 * margin)}
        fill={colors.waste}
        perfectDrawEnabled={false}
      />
      {/* Sheet grain texture at the sheet angle (T116, D-034): ~14 px apart on screen. */}
      {grainSegs.map((s, i) => (
        <Line
          key={`g${i}`}
          points={s}
          stroke={colors.grain}
          strokeWidth={hair}
          opacity={0.45}
          perfectDrawEnabled={false}
        />
      ))}
      {lines.map((pts) => (
        <Line
          key={pts.join(',')}
          points={pts}
          stroke={colors.grid}
          strokeWidth={hair}
          perfectDrawEnabled={false}
        />
      ))}
      <Rect
        x={0}
        y={0}
        width={W}
        height={H}
        stroke={colors.edge}
        strokeWidth={2 * hair}
        perfectDrawEnabled={false}
      />
      <SheetDimensions width={W} height={H} colors={colors} scale={scale} />
    </Layer>
  );
});

/**
 * The sheet's real size on its top and left edges ("2.800" / "2.070", mono, muted) and the origin
 * marker (X right, Y up) at the bottom-left corner, all sized in screen pixels (T196).
 */
function SheetDimensions({
  width: W,
  height: H,
  colors,
  scale,
}: {
  width: number;
  height: number;
  colors: CanvasColors;
  scale: number;
}) {
  const px = 1 / scale;
  const fs = 11 * px;
  const gap = 6 * px;
  const tick = 4 * px;
  const arm = 22 * px;
  const font = canvasMonoFont();
  return (
    <Group listening={false}>
      <Line points={[0, -gap, W, -gap]} stroke={colors.dim} strokeWidth={px} opacity={0.5} />
      <Line points={[0, -gap - tick, 0, -gap + tick]} stroke={colors.dim} strokeWidth={px} />
      <Line points={[W, -gap - tick, W, -gap + tick]} stroke={colors.dim} strokeWidth={px} />
      <Text
        text={formatMm(W)}
        x={0}
        y={-gap - fs * 1.35}
        width={W}
        align="center"
        fontSize={fs}
        fontFamily={font}
        fill={colors.dim}
        perfectDrawEnabled={false}
      />
      <Line points={[-gap, 0, -gap, H]} stroke={colors.dim} strokeWidth={px} opacity={0.5} />
      <Line points={[-gap - tick, 0, -gap + tick, 0]} stroke={colors.dim} strokeWidth={px} />
      <Line points={[-gap - tick, H, -gap + tick, H]} stroke={colors.dim} strokeWidth={px} />
      <Text
        text={formatMm(H)}
        x={-gap - fs * 1.35}
        y={H}
        width={H}
        rotation={-90}
        align="center"
        fontSize={fs}
        fontFamily={font}
        fill={colors.dim}
        perfectDrawEnabled={false}
      />
      <Arrow
        points={[0, H, arm, H]}
        stroke={colors.origin}
        fill={colors.origin}
        strokeWidth={1.5 * px}
        pointerLength={5 * px}
        pointerWidth={5 * px}
      />
      <Arrow
        points={[0, H, 0, H - arm]}
        stroke={colors.origin}
        fill={colors.origin}
        strokeWidth={1.5 * px}
        pointerLength={5 * px}
        pointerWidth={5 * px}
      />
      <Rect x={-2.5 * px} y={H - 2.5 * px} width={5 * px} height={5 * px} fill={colors.origin} />
    </Group>
  );
}

const PartShape = memo(function PartShape({
  part,
  selected,
  conflict,
  pendingX,
  pendingY,
  sheetHeight,
  sheetGrain,
  colors,
  scale,
  onSelect,
  onDragMove,
  onDrop,
  appearDelay,
}: {
  part: DrawnPart;
  selected: boolean;
  conflict: boolean;
  pendingX: number | undefined;
  pendingY: number | undefined;
  sheetHeight: number;
  sheetGrain: number | null;
  colors: CanvasColors;
  scale: number;
  onSelect: LayoutCanvasProps['onSelect'];
  onDragMove: LayoutCanvasProps['onDragMove'];
  onDrop: LayoutCanvasProps['onDrop'];
  /** ms before this part fades in after a "Diz"; undefined = no animation. */
  appearDelay?: number | undefined;
}) {
  const group = useRef<Konva.Group>(null);
  useEffect(() => {
    const node = group.current;
    if (appearDelay === undefined || !node || reducedMotion()) return;
    const settle = 6 / scale;
    node.opacity(0);
    node.y(node.y() - settle);
    const timer = window.setTimeout(() => {
      node.to({ opacity: 1, y: node.y() + settle, duration: 0.14 });
    }, appearDelay);
    return () => {
      window.clearTimeout(timer);
      node.opacity(1);
    };
    // Mount-only: the parent remounts the parts with a new key after each "Diz".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { w, h } = part;
  const pending = pendingX !== undefined && pendingY !== undefined;
  const shown = pending ? { x: pendingX, y: pendingY } : { x: part.x, y: part.y };
  const top = sheetHeight - shown.y - h;
  const hair = 1 / scale;
  const fill = part.locked ? colors.partLocked : colors.part;
  let stroke = part.locked ? colors.partLockedStroke : colors.partStroke;
  if (selected) stroke = colors.selected;
  if (conflict) stroke = colors.conflict;
  const strokeWidth = (selected || conflict ? 3 : 1) * hair;
  // A locked part is told apart by a dashed outline too, not by its colour alone (T251).
  const dash = part.locked && !selected && !conflict ? [6 * hair, 4 * hair] : [];
  const label = partLabel({ number: part.label, name: part.name, w, h, scale });
  const font = label.font;
  // Grain arrow of a fixed-grain part at its sheet-frame angle (D-034: part grain + rotation).
  // Canvas Y points down, so 90° (up on the sheet) is -Y here.
  const angle = part.grainAngle ?? sheetGrain ?? 0;
  const arrow = grainArrowPoints(angle, w, h, font, label.lines.length);

  const snap = (node: Konva.Node) => {
    const x = Math.round(node.x());
    const yTop = Math.round(node.y());
    node.position({ x, y: yTop });
    return { x, y: sheetHeight - yTop - h };
  };

  return (
    <Group
      ref={group}
      x={shown.x}
      y={top}
      draggable
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(part.key, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey);
      }}
      onTouchStart={(e) => {
        e.cancelBubble = true;
        onSelect(part.key);
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        e.target.moveToTop();
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const p = snap(e.target);
        const to = onDragMove(part.key, p.x, p.y, e.evt?.altKey);
        if (to) e.target.position({ x: to.x, y: sheetHeight - to.y - h });
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const node = e.target;
        const p = snap(node);
        // Refused: straight back to the stored position. The view has no animated transitions
        // at all, so prefers-reduced-motion is respected by construction.
        if (!onDrop(part.key, p.x, p.y, e.evt?.altKey))
          node.position({ x: part.x, y: sheetHeight - part.y - h });
      }}
    >
      {part.outline ? (
        <>
          {/* Hit area = the footprint, so a turned part is as easy to grab as before. */}
          <Rect width={w} height={h} fill="transparent" perfectDrawEnabled={false} />
          {/* True outline of a turned or drawn part (T116, D-034). */}
          <Line
            points={part.outline}
            closed
            stroke={stroke}
            strokeWidth={strokeWidth}
            dash={dash}
            fill={conflict ? colors.conflictFill : fill}
            opacity={pending ? 0.85 : 1}
            perfectDrawEnabled={false}
            shadowForStrokeEnabled={false}
          />
        </>
      ) : (
        <Rect
          width={w}
          height={h}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          fill={conflict ? colors.conflictFill : fill}
          opacity={pending ? 0.85 : 1}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      )}
      {/* Cut-outs (T134): the sheet shows through; they turn and move with the part. */}
      {part.inners.map((pts, i) => (
        <Line
          key={`inner-${i}`}
          points={pts}
          closed
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill={colors.waste}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
          listening={false}
        />
      ))}
      {/* Holes and template instances (T171, CTO #8): left and right doors read apart. */}
      {part.holes.map((c, i) => (
        <Circle
          key={`hole-${i}`}
          x={c.x}
          y={c.y}
          radius={c.r}
          stroke={stroke}
          strokeWidth={hair}
          fill={colors.waste}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
          listening={false}
        />
      ))}
      {label.lines.map((line, i) => (
        <Text
          key={i}
          text={line}
          width={w}
          y={
            h / 2 -
            (label.lines.length * font * 1.25) / 2 +
            i * font * 1.25 -
            (part.grainAngle !== null ? font * 0.6 : 0)
          }
          align="center"
          fontSize={font}
          fontFamily={canvasMonoFont()}
          fontStyle={i === 0 ? 'bold' : 'normal'}
          fill={i === 0 ? colors.text : colors.dim}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
      {part.grainAngle !== null && label.level !== 'none' ? (
        <Arrow
          points={arrow}
          stroke={colors.text}
          fill={colors.text}
          strokeWidth={Math.max(hair, font * 0.08)}
          pointerLength={font * 0.35}
          pointerWidth={font * 0.3}
          pointerAtBeginning
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
    </Group>
  );
});

export default function LayoutCanvas(props: LayoutCanvasProps) {
  const { width, height, sheet, view, onViewChange } = props;
  const stage = useRef<Konva.Stage>(null);
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);

  return (
    <Stage
      ref={stage}
      width={width}
      height={height}
      scaleX={view.scale}
      scaleY={view.scale}
      x={view.x}
      y={view.y}
      draggable={props.pannable ?? true}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) props.onSelect(null);
      }}
      onDragEnd={(e) => {
        if (e.target === e.target.getStage()) {
          onViewChange({ scale: view.scale, x: e.target.x(), y: e.target.y() });
        }
      }}
      onWheel={(e) => {
        e.evt.preventDefault();
        const st = stage.current;
        const p = st?.getPointerPosition();
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
        pinch.current = { dist, cx, cy };
        if (prev && prev.dist > 0) onViewChange(zoomAt(view, dist / prev.dist, cx, cy));
      }}
      onTouchEnd={() => {
        pinch.current = null;
      }}
    >
      <SheetLayer
        sheet={sheet}
        margin={props.margin}
        colors={props.colors}
        grid={props.grid}
        scale={view.scale}
      />
      <Layer>
        {props.parts.map((part, i) => (
          <PartShape
            key={`${props.appearKey ?? 0}:${part.key}`}
            appearDelay={props.appearKey ? Math.min(i * 8, 100) : undefined}
            part={part}
            selected={part.key === props.selected || (props.marked?.has(part.key) ?? false)}
            conflict={props.conflicts.has(part.key)}
            pendingX={part.key === props.selected ? props.pending?.x : undefined}
            pendingY={part.key === props.selected ? props.pending?.y : undefined}
            sheetHeight={sheet.height}
            sheetGrain={sheet.grain}
            colors={props.colors}
            scale={view.scale}
            onSelect={props.onSelect}
            onDragMove={props.onDragMove}
            onDrop={props.onDrop}
          />
        ))}
      </Layer>
    </Stage>
  );
}
