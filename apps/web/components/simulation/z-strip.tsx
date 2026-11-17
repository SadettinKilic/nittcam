'use client';

import type { SimSheet } from '@nittcam/core';
import { useEffect, useMemo, useRef } from 'react';
import type { SimColors, SimText } from './model';

const HEIGHT = 56;

/**
 * Side profile strip (T020): tool Z over time for the whole sheet, the material top as a line and
 * the playhead. Per pixel column the Z range is precomputed once; a click seeks to that time.
 */
export function ZStrip({
  t,
  sim,
  width,
  time,
  colors,
  onSeek,
}: {
  t: SimText;
  sim: SimSheet;
  width: number;
  time: number;
  colors: SimColors;
  onSeek: (time: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const duration = sim.duration;

  const columns = useMemo(() => {
    const w = Math.max(1, Math.floor(width));
    const lo = new Float64Array(w).fill(Infinity);
    const hi = new Float64Array(w).fill(-Infinity);
    if (duration <= 0) return { w, lo, hi, zMax: 1 };
    let zMax = 0;
    for (const s of sim.steps) {
      const a = Math.min(w - 1, Math.floor((s.t0 / duration) * w));
      const b = Math.min(w - 1, Math.floor((s.t1 / duration) * w));
      const z0 = sim.points[3 * s.p0 + 2] ?? 0;
      const z1 = sim.points[3 * s.p1 + 2] ?? 0;
      zMax = Math.max(zMax, z0, z1);
      for (let c = a; c <= b; c += 1) {
        lo[c] = Math.min(lo[c] ?? Infinity, z0, z1, s.zMin);
        hi[c] = Math.max(hi[c] ?? -Infinity, z0, z1);
      }
    }
    return { w, lo, hi, zMax: Math.max(1, zMax) };
  }, [sim, width, duration]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = columns.w;
    el.width = Math.round(w * dpr);
    el.height = Math.round(HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, HEIGHT);
    const pad = 6;
    const zTop = columns.zMax;
    const zBot = Math.min(sim.zBottom, -1);
    const yOf = (z: number) => pad + ((zTop - z) / (zTop - zBot)) * (HEIGHT - 2 * pad);
    // Material: from the material top down to the final depth.
    ctx.fillStyle = colors.waste;
    ctx.fillRect(0, yOf(0), w, yOf(zBot) - yOf(0));
    ctx.strokeStyle = colors.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(yOf(0)) + 0.5);
    ctx.lineTo(w, Math.round(yOf(0)) + 0.5);
    ctx.stroke();
    const playX = duration > 0 ? (time / duration) * w : 0;
    for (let c = 0; c < w; c += 1) {
      const lo = columns.lo[c] ?? Infinity;
      const hi = columns.hi[c] ?? -Infinity;
      if (!Number.isFinite(lo)) continue;
      ctx.fillStyle = lo < 0 ? colors.depthBottom : colors.rapid;
      ctx.globalAlpha = c <= playX ? 1 : 0.3;
      const y0 = yOf(hi);
      ctx.fillRect(c, y0, 1, Math.max(1, yOf(lo) - y0));
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.tool;
    ctx.fillRect(Math.min(w - 2, Math.max(0, playX - 1)), 0, 2, HEIGHT);
  }, [columns, time, duration, colors, sim.zBottom]);

  return (
    <canvas
      ref={canvas}
      data-testid="z-strip"
      role="img"
      aria-label={t.zStrip.label}
      title={t.zStrip.label}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (r.width > 0) onSeek(((e.clientX - r.left) / r.width) * duration);
      }}
      className="block w-full cursor-pointer rounded-md border border-border bg-bg"
      style={{ height: HEIGHT }}
    />
  );
}
