'use client';

import type Konva from 'konva';
import { memo, useMemo, useRef } from 'react';
import { Arrow, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { CanvasColors, DrawnPart, ViewState } from './model';
import { zoomAt } from './zoom';
import { canvasMonoFont } from '../../lib/canvas-theme';

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
  sheet: { width: number; height: number; grain: 0 | 90 };
  margin: number;
  parts: readonly DrawnPart[];
  view: ViewState;
  colors: CanvasColors;
  grid: boolean;
  /** Key of the selected part. */
  selected: string | null;
  /** Keys drawn in the conflict colour (the dragged part and what it collides with). */
  conflicts: ReadonlySet<string>;
  /** Unsaved position of the selected part (keyboard nudge or drag), mm. */
  pending: { x: number; y: number } | null;
  onViewChange: (view: ViewState) => void;
  onSelect: (key: string | null) => void;
  /** Live position of a dragged part (mm, snapped); the parent checks it. */
  onDragMove: (key: string, x: number, y: number) => void;
  /** Drop at (mm, snapped). Returns false when the drop is refused; the part then snaps back. */
  onDrop: (key: string, x: number, y: number) => boolean;
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
    </Layer>
  );
});

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
}: {
  part: DrawnPart;
  selected: boolean;
  conflict: boolean;
  pendingX: number | undefined;
  pendingY: number | undefined;
  sheetHeight: number;
  sheetGrain: 0 | 90;
  colors: CanvasColors;
  scale: number;
  onSelect: LayoutCanvasProps['onSelect'];
  onDragMove: LayoutCanvasProps['onDragMove'];
  onDrop: LayoutCanvasProps['onDrop'];
}) {
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
  const font = Math.max(4, Math.min(80, Math.min(w, h) * 0.28, (w / part.label.length) * 1.4));
  // Grain arrow along the sheet grain turned by the placement rotation (D-019: rule is relative
  // to the sheet frame). Canvas Y points down, so 90° (up on the sheet) is -Y here.
  const angle = (sheetGrain + part.rot) % 180;
  const len = Math.min(angle === 0 ? w : h, 160) * 0.5;
  const cx = w / 2;
  const cy = h / 2 + font * 0.9;
  const arrow =
    angle === 0 ? [cx - len / 2, cy, cx + len / 2, cy] : [cx, cy + len / 2, cx, cy - len / 2];

  const snap = (node: Konva.Node) => {
    const x = Math.round(node.x());
    const yTop = Math.round(node.y());
    node.position({ x, y: yTop });
    return { x, y: sheetHeight - yTop - h };
  };

  return (
    <Group
      x={shown.x}
      y={top}
      draggable
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(part.key);
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
        onDragMove(part.key, p.x, p.y);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const node = e.target;
        const p = snap(node);
        // Refused: straight back to the stored position. The view has no animated transitions
        // at all, so prefers-reduced-motion is respected by construction.
        if (!onDrop(part.key, p.x, p.y)) node.position({ x: part.x, y: sheetHeight - part.y - h });
      }}
    >
      <Rect
        width={w}
        height={h}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={conflict ? colors.conflictFill : fill}
        opacity={pending ? 0.85 : 1}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
      />
      <Text
        text={part.label}
        width={w}
        y={h / 2 - font / 2 - (part.grainLock ? font * 0.3 : 0)}
        align="center"
        fontSize={font}
        fontFamily={canvasMonoFont()}
        fontStyle="bold"
        fill={colors.text}
        listening={false}
        perfectDrawEnabled={false}
      />
      {part.grainLock ? (
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
      draggable
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
        {props.parts.map((part) => (
          <PartShape
            key={part.key}
            part={part}
            selected={part.key === props.selected}
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
