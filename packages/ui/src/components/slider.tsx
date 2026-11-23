'use client';

import { Slider as SliderPrimitive } from 'radix-ui';
import type { KeyboardEvent } from 'react';
import { cn } from '../lib/cn';
import { focusRing } from '../lib/styles';

/** Thumb size in px; marks use Radix's in-bounds offset so they line up with the thumb. */
const THUMB = 16;

/** Left position of `v` on the track, matching where Radix draws the thumb centre. */
function at(v: number, min: number, max: number): string {
  const pct = max > min ? ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100 : 0;
  const offset = (THUMB / 2) * (1 - pct / 50);
  return `calc(${pct}% + ${offset}px)`;
}

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** Arrow-key and drag step. */
  step: number;
  /** PageUp / PageDown step (default 10 × step). */
  pageStep?: number;
  /** Live value while dragging or stepping. */
  onValueChange: (value: number) => void;
  /** Final value (pointer up, each key press). */
  onValueCommit: (value: number) => void;
  /** Accessible name of the thumb. */
  label: string;
  /** Screen-reader value, e.g. "18.000 devir/dk". */
  valueText: string;
  /** A marked value with a small tick and a label above the track (e.g. the recommended value). */
  mark?: { value: number; label: string } | undefined;
  /** A soft band on the track (e.g. the recommended range). */
  band?: readonly [number, number] | undefined;
  /** `warning` colours the thumb when the value is outside the band. */
  tone?: 'default' | 'warning';
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * T307: a single-value slider (Radix) in the token look: neutral track, an optional calm band and
 * a marked value, keyboard operable (arrows = step, PgUp/PgDn = `pageStep`, Home/End = ends).
 */
export function Slider({
  value,
  min,
  max,
  step,
  pageStep,
  onValueChange,
  onValueCommit,
  label,
  valueText,
  mark,
  band,
  tone = 'default',
  disabled = false,
  className,
  'data-testid': testId,
}: SliderProps) {
  const page = pageStep ?? step * 10;
  // Radix pages by 10 × step; a custom page step is applied here and Radix's own is skipped.
  function onKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (disabled || (e.key !== 'PageUp' && e.key !== 'PageDown')) return;
    e.preventDefault();
    const next = Math.min(max, Math.max(min, value + (e.key === 'PageUp' ? page : -page)));
    if (next === value) return;
    onValueChange(next);
    onValueCommit(next);
  }
  // Keep the mark label inside the track box.
  const markPct = mark && max > min ? ((mark.value - min) / (max - min)) * 100 : 0;
  const labelPct = Math.min(80, Math.max(20, markPct));
  return (
    <div className={cn('relative flex flex-col', mark && 'pt-4', className)} data-testid={testId}>
      {mark ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 -translate-x-1/2 text-2xs whitespace-nowrap text-fg-muted"
          style={{ left: `${labelPct}%` }}
          data-testid={testId ? `${testId}-mark` : undefined}
        >
          {mark.label}
        </span>
      ) : null}
      <SliderPrimitive.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => {
          if (v[0] !== undefined) onValueChange(v[0]);
        }}
        onValueCommit={(v) => {
          if (v[0] !== undefined) onValueCommit(v[0]);
        }}
        onKeyDown={onKeyDown}
        className="relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-50"
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-surface-active">
          {band ? (
            <span
              aria-hidden
              className="absolute inset-y-0 rounded-full bg-success-border/70"
              style={{
                left: at(band[0], min, max),
                right: `calc(100% - ${at(band[1], min, max)})`,
              }}
            />
          ) : null}
        </SliderPrimitive.Track>
        {mark ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 h-5 w-0.5 -translate-x-1/2 rounded-full bg-fg-muted"
            style={{ left: at(mark.value, min, max) }}
          />
        ) : null}
        <SliderPrimitive.Thumb
          aria-label={label}
          aria-valuetext={valueText}
          className={cn(
            focusRing,
            'block size-4 rounded-full border-2 bg-surface shadow-xs transition-colors duration-(--duration-fast)',
            'hover:bg-surface-hover data-disabled:cursor-not-allowed',
            tone === 'warning' ? 'border-warning' : 'border-accent',
          )}
        />
      </SliderPrimitive.Root>
    </div>
  );
}
