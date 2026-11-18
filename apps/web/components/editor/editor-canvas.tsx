'use client';

import { arcOf, segmentMidpoint, type BoardPart, type SnapKind, type Vertex } from '@nittcam/core';
import type Konva from 'konva';
import { Layer, Shape, Stage } from 'react-konva';
import { formatMm, partLabel, sizeText, LINE_HEIGHT } from '../../lib/canvas-labels';
import { canvasMonoFont } from '../../lib/canvas-theme';
import {
  gridLevels,
  rulerStep,
  rulerTicks,
  toScreen,
  visibleBox,
  type Box,
  type Pt,
  type Viewport,
} from '../../lib/editor/viewport';
import type { DraftView } from '../../lib/editor/draw-tool';
import type { EditorColors } from './colors';

/** Width of the rulers on the top and left edges, px. */
export const RULER_PX = 22;

/** Snap glyph kinds: the engine's kinds (T126). */
export type SnapGlyph = Exclude<SnapKind, 'none'>;

export interface EditorCanvasProps {
  width: number;
  height: number;
  view: Viewport;
  parts: readonly BoardPart[];
  /** Label text per part id: number + name (and ×qty). */
  names: ReadonlyMap<string, { number: string; name: string }>;
  selection: ReadonlySet<string>;
  hover: string | null;
  /** Live move preview of the selection, mm. */
  drag: Pt | null;
  /** Box selection in board mm. */
  marquee: Box | null;
  snap: { kind: SnapGlyph; point: Pt } | null;
  grid: boolean;
  colors: EditorColors;
  /** In-progress drawing (T127–T129), board mm. */
  draft?: DraftView | null;
  /** Live dimension label of the draft ("596 × 716", "R 150"). */
  draftLabel?: string | null;
  /** Canvas words of the drawing tools: the close glyph and the open-shape chip. */
  drawText?: { close: string; open: string };
}

type Ctx = CanvasRenderingContext2D;

function raw(context: Konva.Context): Ctx {
  return (context as unknown as { _context: Ctx })._context;
}

/** Adds a bulge contour to the current path, in screen space (Y flipped). */
function traceContour(ctx: Ctx, vs: readonly Vertex[], v: Viewport, dx = 0, dy = 0) {
  const first = vs[0];
  if (!first) return;
  const s0 = toScreen(v, { x: first.x + dx, y: first.y + dy });
  ctx.moveTo(s0.x, s0.y);
  vs.forEach((a, i) => {
    const b = vs[(i + 1) % vs.length] ?? first;
    const p0 = { x: a.x + dx, y: a.y + dy };
    const p1 = { x: b.x + dx, y: b.y + dy };
    const arc = arcOf(p0, p1, a.bulge);
    if (!arc) {
      const s = toScreen(v, p1);
      ctx.lineTo(s.x, s.y);
      return;
    }
    const c = toScreen(v, arc.center);
    // Y is flipped on screen: angles negate and a CCW arc runs clockwise.
    ctx.arc(
      c.x,
      c.y,
      arc.radius * v.scale,
      -arc.startAngle,
      -(arc.startAngle + arc.sweep),
      arc.sweep > 0,
    );
  });
  ctx.closePath();
}

function drawGrid(ctx: Ctx, p: EditorCanvasProps) {
  const { view: v, width, height, colors } = p;
  const vis = visibleBox(v, width, height);
  const { fine, major } = gridLevels(v.scale);
  // Major lines (thin), then dots at the finest level.
  if (major !== undefined) {
    ctx.beginPath();
    for (let x = Math.ceil(vis.minX / major) * major; x <= vis.maxX; x += major) {
      const sx = Math.round(toScreen(v, { x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    for (let y = Math.ceil(vis.minY / major) * major; y <= vis.maxY; y += major) {
      const sy = Math.round(toScreen(v, { x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }
    ctx.strokeStyle = colors.gridMajor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const cols = (vis.maxX - vis.minX) / fine;
  const rows = (vis.maxY - vis.minY) / fine;
  if (cols * rows < 40_000) {
    ctx.fillStyle = colors.gridDot;
    for (let x = Math.ceil(vis.minX / fine) * fine; x <= vis.maxX; x += fine) {
      for (let y = Math.ceil(vis.minY / fine) * fine; y <= vis.maxY; y += fine) {
        const s = toScreen(v, { x, y });
        ctx.fillRect(Math.round(s.x) - 0.75, Math.round(s.y) - 0.75, 1.5, 1.5);
      }
    }
  }
  // Board origin.
  const o = toScreen(v, { x: 0, y: 0 });
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x + 28, o.y);
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x, o.y - 28);
  ctx.strokeStyle = colors.origin;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(o.x, o.y, 3, 0, 2 * Math.PI);
  ctx.fillStyle = colors.origin;
  ctx.fill();
}

function drawParts(ctx: Ctx, p: EditorCanvasProps) {
  const { view: v, colors } = p;
  for (const part of p.parts) {
    const selected = p.selection.has(part.id);
    const d = selected && p.drag ? p.drag : { x: 0, y: 0 };
    ctx.beginPath();
    traceContour(ctx, part.outline, v, d.x, d.y);
    for (const inner of part.inners) traceContour(ctx, inner, v, d.x, d.y);
    ctx.fillStyle = selected ? colors.selectionFill : colors.part;
    ctx.fill('evenodd');
    ctx.lineWidth = selected ? 2 : part.id === p.hover ? 1.75 : 1;
    ctx.strokeStyle = selected || part.id === p.hover ? colors.selection : colors.partStroke;
    ctx.stroke();
    if (part.holes.length > 0) {
      ctx.beginPath();
      for (const h of part.holes) {
        const c = toScreen(v, { x: h.x + d.x, y: h.y + d.y });
        const r = Math.max((h.d / 2) * v.scale, 1.5);
        ctx.moveTo(c.x + r, c.y);
        ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
      }
      ctx.strokeStyle = colors.partStroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function drawLabels(ctx: Ctx, p: EditorCanvasProps) {
  const { view: v, colors } = p;
  const font = canvasMonoFont();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const part of p.parts) {
    const n = p.names.get(part.id);
    if (!n) continue;
    const d = p.selection.has(part.id) && p.drag ? p.drag : { x: 0, y: 0 };
    const w = part.box.maxX - part.box.minX;
    const h = part.box.maxY - part.box.minY;
    const label = partLabel({ number: n.number, name: n.name, w, h, scale: v.scale });
    if (label.lines.length === 0) continue;
    const fontPx = label.font * v.scale;
    const c = toScreen(v, {
      x: (part.box.minX + part.box.maxX) / 2 + d.x,
      y: (part.box.minY + part.box.maxY) / 2 + d.y,
    });
    const top = c.y - ((label.lines.length - 1) * fontPx * LINE_HEIGHT) / 2;
    label.lines.forEach((line, i) => {
      ctx.font = `${i === 0 ? 'bold ' : ''}${fontPx}px ${font}`;
      ctx.fillStyle = i === 0 ? colors.text : colors.dim;
      ctx.fillText(line, c.x, top + i * fontPx * LINE_HEIGHT);
    });
  }
}

/** Selection frame with its size above it (canvas language: mono dimension label). */
function drawSelection(ctx: Ctx, p: EditorCanvasProps) {
  const sel = p.parts.filter((x) => p.selection.has(x.id));
  if (sel.length === 0) return;
  const d = p.drag ?? { x: 0, y: 0 };
  const box = sel.reduce(
    (a, x) => ({
      minX: Math.min(a.minX, x.box.minX),
      minY: Math.min(a.minY, x.box.minY),
      maxX: Math.max(a.maxX, x.box.maxX),
      maxY: Math.max(a.maxY, x.box.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const a = toScreen(p.view, { x: box.minX + d.x, y: box.maxY + d.y });
  const b = toScreen(p.view, { x: box.maxX + d.x, y: box.minY + d.y });
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = p.colors.selection;
  ctx.lineWidth = 1;
  ctx.strokeRect(a.x - 4, a.y - 4, b.x - a.x + 8, b.y - a.y + 8);
  ctx.setLineDash([]);
  ctx.fillStyle = p.colors.selection;
  for (const [x, y] of [
    [a.x - 4, a.y - 4],
    [b.x + 4, a.y - 4],
    [a.x - 4, b.y + 4],
    [b.x + 4, b.y + 4],
  ] as const) {
    ctx.fillRect(x - 3, y - 3, 6, 6);
  }
  const text = sizeText(box.maxX - box.minX, box.maxY - box.minY);
  ctx.font = `11px ${canvasMonoFont()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const tw = ctx.measureText(text).width + 10;
  const cx = (a.x + b.x) / 2;
  ctx.fillStyle = p.colors.selection;
  ctx.beginPath();
  ctx.roundRect(cx - tw / 2, a.y - 26, tw, 18, 4);
  ctx.fill();
  ctx.fillStyle = p.colors.selectionText;
  ctx.fillText(text, cx, a.y - 11);
}

function drawMarquee(ctx: Ctx, p: EditorCanvasProps) {
  if (!p.marquee) return;
  const a = toScreen(p.view, { x: p.marquee.minX, y: p.marquee.maxY });
  const b = toScreen(p.view, { x: p.marquee.maxX, y: p.marquee.minY });
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = p.colors.selection;
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = p.colors.selection;
  ctx.lineWidth = 1;
  ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
}

/** Snap glyph in the `info` colour: one shape per kind (T126). */
function drawSnap(ctx: Ctx, p: EditorCanvasProps) {
  if (!p.snap) return;
  const s = toScreen(p.view, p.snap.point);
  const r = 6;
  ctx.strokeStyle = p.colors.snap;
  ctx.fillStyle = p.colors.snap;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  switch (p.snap.kind) {
    case 'endpoint':
      ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r);
      break;
    case 'midpoint':
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y + r * 0.8);
      ctx.lineTo(s.x - r, s.y + r * 0.8);
      ctx.closePath();
      break;
    case 'centre':
      ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
      break;
    case 'intersection':
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      break;
    case 'perpendicular':
      ctx.moveTo(s.x - r, s.y + r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x, s.y + r);
      ctx.lineTo(s.x, s.y - r);
      break;
    case 'angle':
      ctx.arc(s.x, s.y, r, Math.PI, 1.5 * Math.PI);
      ctx.moveTo(s.x - r - 3, s.y);
      ctx.lineTo(s.x + r, s.y);
      break;
    case 'grid':
      ctx.moveTo(s.x - r, s.y);
      ctx.lineTo(s.x + r, s.y);
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x, s.y + r);
      break;
    default:
      return;
  }
  ctx.stroke();
}

/** Adds one bulge segment a → b (screen space, Y flipped) to the current path. */
function traceSegment(ctx: Ctx, a: Pt, b: Pt, bulge: number, v: Viewport) {
  const arc = arcOf(a, b, bulge);
  if (!arc) {
    const s = toScreen(v, b);
    ctx.lineTo(s.x, s.y);
    return;
  }
  const c = toScreen(v, arc.center);
  ctx.arc(
    c.x,
    c.y,
    arc.radius * v.scale,
    -arc.startAngle,
    -(arc.startAngle + arc.sweep),
    arc.sweep > 0,
  );
}

/** Open path: segments between the given vertices (the last vertex's bulge is ignored). */
function traceOpen(ctx: Ctx, vs: readonly Vertex[], v: Viewport) {
  const first = vs[0];
  if (!first) return;
  const s0 = toScreen(v, first);
  ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < vs.length; i += 1) {
    const a = vs[i - 1] as Vertex;
    traceSegment(ctx, a, vs[i] as Vertex, a.bulge, v);
  }
}

/** Mono chip with a filled background, centred on (x, y) (canvas language: dimension label). */
function chip(ctx: Ctx, text: string, x: number, y: number, bg: string, fg: string) {
  ctx.font = `11px ${canvasMonoFont()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width + 10;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - tw / 2, y - 9, tw, 18, 4);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(text, x, y + 0.5);
}

/**
 * In-progress drawing (D-039): dashed 1.5 px accent preview, 10 % accent fill once closed,
 * 6 px square vertex nodes, a grown start node with "Kapat" when the cursor closes the path, the
 * arc centre as a small cross, and an open finished path in `warning` with one "Kapalı değil" chip.
 */
function drawDraft(ctx: Ctx, p: EditorCanvasProps) {
  const d = p.draft;
  if (!d) return;
  const { view: v, colors } = p;
  const stroke = d.open ? colors.warning : colors.accent;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.setLineDash(d.open ? [] : [6, 4]);
  ctx.beginPath();
  if (d.closed) {
    traceContour(ctx, d.vertices, v);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    traceOpen(ctx, d.vertices, v);
  }
  ctx.stroke();
  if (d.rubber) {
    ctx.beginPath();
    const s = toScreen(v, d.rubber.from);
    ctx.moveTo(s.x, s.y);
    traceSegment(ctx, d.rubber.from, d.rubber.to, d.rubber.bulge, v);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Vertex nodes: 6 px squares; the start node grows while the cursor closes the shape.
  d.nodes.forEach((n, i) => {
    const s = toScreen(v, n);
    const r = i === 0 && d.closing ? 6 : 3;
    ctx.fillStyle = i === 0 && d.closing ? colors.snap : colors.ruler;
    ctx.strokeStyle = i === 0 && d.closing ? colors.snap : stroke;
    ctx.lineWidth = 1.5;
    ctx.fillRect(s.x - r, s.y - r, 2 * r, 2 * r);
    ctx.strokeRect(s.x - r, s.y - r, 2 * r, 2 * r);
  });
  const start = d.nodes[0];
  if (d.closing && start && p.drawText) {
    const s = toScreen(v, start);
    ctx.font = `600 11px ${canvasMonoFont()}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.snap;
    ctx.fillText(p.drawText.close, s.x + 10, s.y - 12);
  }
  if (d.centre) {
    const c = toScreen(v, d.centre);
    ctx.beginPath();
    ctx.moveTo(c.x - 5, c.y);
    ctx.lineTo(c.x + 5, c.y);
    ctx.moveTo(c.x, c.y - 5);
    ctx.lineTo(c.x, c.y + 5);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (d.open && p.drawText) {
    const a = d.vertices[0];
    const b = d.vertices[1];
    if (a && b) {
      const m = toScreen(v, segmentMidpoint(a, b, a.bulge));
      chip(ctx, p.drawText.open, m.x, m.y - 16, colors.warning, colors.selectionText);
    }
  }
  // Live dimension label above the preview's top edge.
  if (p.draftLabel && d.vertices.length > 0) {
    let top = Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const q of d.closed ? d.vertices : [...d.vertices, ...(d.rubber ? [d.rubber.to] : [])]) {
      top = Math.min(top, toScreen(v, q).y);
      const sx = toScreen(v, q).x;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
    }
    if (d.closed && d.centre && d.vertices[0]) {
      // Circle: the box top is the centre minus the radius on screen.
      const c = toScreen(v, d.centre);
      top = c.y - Math.abs(c.x - toScreen(v, d.vertices[0]).x);
    }
    chip(ctx, p.draftLabel, (minX + maxX) / 2, top - 16, colors.accent, colors.selectionText);
  }
}

/** Rulers along the top and left edges, with mono labels in board millimetres. */
function drawRulers(ctx: Ctx, p: EditorCanvasProps) {
  const { view: v, width, height, colors } = p;
  const vis = visibleBox(v, width, height);
  const step = rulerStep(v.scale);
  ctx.fillStyle = colors.ruler;
  ctx.fillRect(0, 0, width, RULER_PX);
  ctx.fillRect(0, 0, RULER_PX, height);
  ctx.strokeStyle = colors.rulerEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_PX - 0.5);
  ctx.lineTo(width, RULER_PX - 0.5);
  ctx.moveTo(RULER_PX - 0.5, 0);
  ctx.lineTo(RULER_PX - 0.5, height);
  ctx.stroke();
  ctx.font = `10px ${canvasMonoFont()}`;
  ctx.fillStyle = colors.dim;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.beginPath();
  for (const x of rulerTicks(vis.minX, vis.maxX, step / 5)) {
    const sx = Math.round(toScreen(v, { x, y: 0 }).x) + 0.5;
    if (sx < RULER_PX) continue;
    const major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
    ctx.moveTo(sx, RULER_PX);
    ctx.lineTo(sx, RULER_PX - (major ? 8 : 4));
    if (major) ctx.fillText(formatMm(x), sx + 3, 3);
  }
  ctx.save();
  for (const y of rulerTicks(vis.minY, vis.maxY, step / 5)) {
    const sy = Math.round(toScreen(v, { x: 0, y }).y) + 0.5;
    if (sy < RULER_PX) continue;
    const major = Math.abs(y / step - Math.round(y / step)) < 1e-6;
    ctx.moveTo(RULER_PX, sy);
    ctx.lineTo(RULER_PX - (major ? 8 : 4), sy);
    if (major) {
      ctx.save();
      ctx.translate(3, sy - 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(formatMm(y), 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.strokeStyle = colors.dim;
  ctx.stroke();
  ctx.fillStyle = colors.ruler;
  ctx.fillRect(0, 0, RULER_PX, RULER_PX);
}

/** Konva stage of the drawing board: everything is drawn in screen space from board mm. */
export default function EditorCanvas(props: EditorCanvasProps) {
  const { width, height } = props;
  return (
    <Stage width={width} height={height} listening={false}>
      <Layer listening={false}>
        <Shape
          sceneFunc={(context) => {
            const ctx = raw(context);
            if (props.grid) drawGrid(ctx, props);
            drawParts(ctx, props);
            drawLabels(ctx, props);
            drawSelection(ctx, props);
            drawMarquee(ctx, props);
            drawDraft(ctx, props);
            drawSnap(ctx, props);
            drawRulers(ctx, props);
          }}
        />
      </Layer>
    </Stage>
  );
}
