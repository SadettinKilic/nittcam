'use client';

import { arcOf, segmentMidpoint, type BoardPart, type SnapKind, type Vertex } from '@nittcam/core';
import type Konva from 'konva';
import { Layer, Shape, Stage } from 'react-konva';
import { formatMm, partLabel, sizeText, LINE_HEIGHT } from '../../lib/canvas-labels';
import { canvasMonoFont } from '../../lib/canvas-theme';
import { grainArrowPoints } from '../../lib/grain-texture';
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
import type { TemplateGhost } from '../../lib/editor/template-place';
import { dimText, type SegmentLabel } from '../../lib/editor/dims';
import type { EditorColors } from './colors';
import { RULER_PX } from './ruler';

export { RULER_PX };

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
  /** Stock sheet as a view-only reference outline (T243); null when hidden. */
  sheet?: { w: number; h: number; label: string } | null;
  colors: EditorColors;
  /** In-progress drawing (T127–T129), board mm. */
  draft?: DraftView | null;
  /** Template ghost while placing (T148): holes, contours and lines in board mm. */
  ghost?: TemplateGhost | null;
  /** Live dimension label of the draft ("596 × 716", "R 150"). */
  draftLabel?: string | null;
  /** Canvas words of the drawing tools: the close glyph and the open-shape chip. */
  drawText?: { close: string; open: string };
  /** Bend handles of the selected part (segment middles), board mm (T129). */
  handles?: readonly Pt[];
  /** Grain angle (part frame, degrees) of every fixed-grain part, by id (T254). */
  grains?: ReadonlyMap<string, number>;
  /** Corner nodes of the selected part (square), board mm (T130). */
  corners?: readonly Pt[];
  /** The segment or vertex the properties panel edits (T130), drawn in the accent. */
  focus?: EditorFocus | null;
  /** Length labels of the selected part's segments (T133), board mm. */
  segmentLabels?: readonly SegmentLabel[] | null;
  /** Dimension tool in progress (T133): first point and the cursor, board mm. */
  dimPreview?: { a: Pt; b: Pt } | null;
}

/** Segment or vertex picked for the properties panel, board mm. */
export type EditorFocus =
  { kind: 'segment'; p0: Pt; p1: Pt; bulge: number } | { kind: 'vertex'; at: Pt };

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
}

/** Origin arm length, px (T243: the layout canvas glyph, X right / Y up). */
export const ORIGIN_ARM_PX = 24;

/**
 * Board origin (T243): X axis to the right and Y up, 24 px arms with arrow heads and "X" / "Y"
 * in mono, a 5 px square at 0,0. Drawn with or without the grid.
 */
function drawOrigin(ctx: Ctx, p: EditorCanvasProps) {
  const { view: v, colors } = p;
  const o = toScreen(v, { x: 0, y: 0 });
  const arm = ORIGIN_ARM_PX;
  const head = 5;
  ctx.save();
  ctx.strokeStyle = colors.origin;
  ctx.fillStyle = colors.origin;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x + arm - head, o.y);
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x, o.y - arm + head);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(o.x + arm, o.y);
  ctx.lineTo(o.x + arm - head, o.y - head / 2 - 0.5);
  ctx.lineTo(o.x + arm - head, o.y + head / 2 + 0.5);
  ctx.closePath();
  ctx.moveTo(o.x, o.y - arm);
  ctx.lineTo(o.x - head / 2 - 0.5, o.y - arm + head);
  ctx.lineTo(o.x + head / 2 + 0.5, o.y - arm + head);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(o.x - 2.5, o.y - 2.5, 5, 5);
  ctx.font = `600 10px ${canvasMonoFont()}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('X', o.x + arm + 3, o.y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Y', o.x, o.y - arm - 2);
  ctx.restore();
}

/**
 * Reference outline of the project's stock sheet from the origin (T243, D-039): dashed
 * `sheet-edge` stroke and "Plaka 2.800 × 2.070" in mono above its top edge. View only: no hit
 * test, not project data, never exported.
 */
function drawSheet(ctx: Ctx, p: EditorCanvasProps) {
  const sheet = p.sheet;
  if (!sheet) return;
  const { view: v, colors } = p;
  const a = toScreen(v, { x: 0, y: sheet.h });
  const b = toScreen(v, { x: sheet.w, y: 0 });
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = colors.sheetEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, b.x - a.x, b.y - a.y);
  ctx.setLineDash([]);
  ctx.font = `10px ${canvasMonoFont()}`;
  ctx.fillStyle = colors.dim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(sheet.label, a.x, a.y - 4);
  ctx.restore();
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
    const grain = p.grains?.get(part.id);
    if (grain !== undefined) {
      // The layout canvas glyph (T254): a two-headed arrow below the label at the grain angle.
      const corner = toScreen(v, { x: part.box.minX + d.x, y: part.box.maxY + d.y });
      const [x1, y1, x2, y2] = grainArrowPoints(grain, w, h, label.font, label.lines.length);
      drawGrainArrow(
        ctx,
        { x: corner.x + x1 * v.scale, y: corner.y + y1 * v.scale },
        { x: corner.x + x2 * v.scale, y: corner.y + y2 * v.scale },
        fontPx,
        colors.text,
      );
    }
  }
}

/** A two-headed arrow a ↔ b in screen px, heads sized from the label font (layout canvas). */
function drawGrainArrow(ctx: Ctx, a: Pt, b: Pt, font: number, color: string) {
  const len = font * 0.35;
  const half = font * 0.15;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, font * 0.08);
  ctx.stroke();
  for (const [tip, dir] of [
    [b, ang],
    [a, ang + Math.PI],
  ] as const) {
    const bx = tip.x - Math.cos(dir) * len;
    const by = tip.y - Math.sin(dir) * len;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(bx - Math.sin(dir) * half, by + Math.cos(dir) * half);
    ctx.lineTo(bx + Math.sin(dir) * half, by - Math.cos(dir) * half);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
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
  // With segment length labels (T133) the top edge carries its own length: no second chip there.
  if (p.segmentLabels && p.segmentLabels.length > 0) return;
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

/** Offset of a dimension line from the measured points, px on screen. */
const DIM_OFFSET_PX = 16;

/**
 * One linear dimension (T133): extension lines, the dimension line with tick marks, offset to
 * the left of a → b, and its length in a chip. Fixed screen size at every zoom.
 */
function drawDimension(ctx: Ctx, p: EditorCanvasProps, a0: Pt, b0: Pt, preview: boolean) {
  const a = toScreen(p.view, a0);
  const b = toScreen(p.view, b0);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  // Screen Y is down: the left of travel on screen is (dy, -dx).
  const nx = dy / len;
  const ny = -dx / len;
  const o = DIM_OFFSET_PX;
  const a2 = { x: a.x + nx * o, y: a.y + ny * o };
  const b2 = { x: b.x + nx * o, y: b.y + ny * o };
  const color = preview ? p.colors.accent : p.colors.dim;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(preview ? [4, 3] : []);
  ctx.beginPath();
  ctx.moveTo(a.x + nx * 3, a.y + ny * 3);
  ctx.lineTo(a2.x + nx * 4, a2.y + ny * 4);
  ctx.moveTo(b.x + nx * 3, b.y + ny * 3);
  ctx.lineTo(b2.x + nx * 4, b2.y + ny * 4);
  ctx.moveTo(a2.x, a2.y);
  ctx.lineTo(b2.x, b2.y);
  // 45° ticks at both ends (architectural style, readable at any angle).
  for (const q of [a2, b2]) {
    ctx.moveTo(q.x - 4 * (dx / len + nx), q.y - 4 * (dy / len + ny));
    ctx.lineTo(q.x + 4 * (dx / len + nx), q.y + 4 * (dy / len + ny));
  }
  ctx.stroke();
  ctx.setLineDash([]);
  chip(
    ctx,
    dimText(a0, b0),
    (a2.x + b2.x) / 2 + nx * 10,
    (a2.y + b2.y) / 2 + ny * 10,
    preview ? p.colors.accent : p.colors.ruler,
    preview ? p.colors.selectionText : p.colors.text,
  );
}

/** Persistent dimensions of every part (T133), then the dimension tool's preview. */
function drawDimensions(ctx: Ctx, p: EditorCanvasProps) {
  for (const part of p.parts) {
    if (part.dims.length === 0) continue;
    const d = p.selection.has(part.id) && p.drag ? p.drag : { x: 0, y: 0 };
    for (const dim of part.dims) {
      drawDimension(
        ctx,
        p,
        { x: dim.a.x + d.x, y: dim.a.y + d.y },
        { x: dim.b.x + d.x, y: dim.b.y + d.y },
        false,
      );
    }
  }
  if (p.dimPreview) drawDimension(ctx, p, p.dimPreview.a, p.dimPreview.b, true);
}

/** Segment length chips of the selected part (T133); the active segment in the accent. */
function drawSegmentLabels(ctx: Ctx, p: EditorCanvasProps) {
  if (!p.segmentLabels || p.drag) return;
  for (const l of p.segmentLabels) {
    const s = toScreen(p.view, l.at);
    chip(
      ctx,
      l.text,
      s.x,
      s.y,
      l.active ? p.colors.accent : p.colors.ruler,
      l.active ? p.colors.selectionText : p.colors.text,
    );
  }
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

/** Bend handles: round nodes (distinct from the square vertex nodes) at segment middles. */
function drawHandles(ctx: Ctx, p: EditorCanvasProps) {
  if (!p.handles || p.handles.length === 0) return;
  ctx.lineWidth = 1.5;
  for (const h of p.handles) {
    const s = toScreen(p.view, h);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = p.colors.ruler;
    ctx.fill();
    ctx.strokeStyle = p.colors.selection;
    ctx.stroke();
  }
}

/**
 * Corner nodes (6 px squares, T130) and the picked segment (3 px accent stroke) or vertex
 * (filled accent square) of the properties panel.
 */
function drawCorners(ctx: Ctx, p: EditorCanvasProps) {
  const { view: v, colors } = p;
  const f = p.focus;
  if (f?.kind === 'segment') {
    const s0 = toScreen(v, f.p0);
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    traceSegment(ctx, f.p0, f.p1, f.bulge, v);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.lineWidth = 1.5;
  for (const c of p.corners ?? []) {
    const s = toScreen(v, c);
    ctx.beginPath();
    ctx.rect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7);
    ctx.fillStyle = colors.ruler;
    ctx.fill();
    ctx.strokeStyle = colors.selection;
    ctx.stroke();
  }
  if (f?.kind === 'vertex') {
    const s = toScreen(v, f.at);
    ctx.beginPath();
    ctx.rect(Math.round(s.x) - 5, Math.round(s.y) - 5, 10, 10);
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.strokeStyle = colors.ruler;
    ctx.stroke();
  }
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
function drawGhost(ctx: Ctx, p: EditorCanvasProps) {
  const g = p.ghost;
  if (!g) return;
  const { view: v, colors } = p;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colors.accent;
  ctx.fillStyle = colors.accent;
  ctx.setLineDash([5, 3]);
  for (const c of g.circles) {
    const s = toScreen(v, c);
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(c.r * v.scale, 1.5), 0, Math.PI * 2);
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  }
  for (const vs of g.contours) {
    ctx.beginPath();
    traceContour(ctx, vs, v);
    ctx.stroke();
  }
  for (const vs of g.lines) {
    ctx.beginPath();
    traceOpen(ctx, vs, v);
    ctx.stroke();
  }
  ctx.restore();
}

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
            drawSheet(ctx, props);
            drawParts(ctx, props);
            drawOrigin(ctx, props);
            drawLabels(ctx, props);
            drawDimensions(ctx, props);
            drawSelection(ctx, props);
            drawSegmentLabels(ctx, props);
            drawMarquee(ctx, props);
            drawHandles(ctx, props);
            drawCorners(ctx, props);
            drawGhost(ctx, props);
            drawDraft(ctx, props);
            drawSnap(ctx, props);
            drawRulers(ctx, props);
          }}
        />
      </Layer>
    </Stage>
  );
}
