'use client';

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  isSnappedGrainAngle,
  normalizeGrainAngle,
  pointerToGrainAngle,
  polarToScreen,
  snapGrainAngle,
  stepGrainAngle,
} from '../lib/angle';
import { cn } from '../lib/cn';
import { formatNumberTr } from '../lib/number';
import { focusRing } from '../lib/styles';
import { Button } from './button';
import { NumberInput } from './number-input';

export interface GrainDialLabels {
  /** Accessible name of the dial, e.g. "Damar açısı". */
  label: string;
  /** aria-valuetext, e.g. (30) → "30 derece". */
  valueText: (deg: number) => string;
  /** Read-out / valuetext when there is no grain, e.g. "Damar yok". */
  noGrain: string;
  /** Accessible name of the typed-degree input, e.g. "Açı (derece)". */
  input?: string;
  /** Visible note under the controls, e.g. "30° ile 210° aynı damardır". */
  note?: string;
  /** Group label of the quick buttons, e.g. "Hızlı açılar". */
  quick?: string;
}

export interface GrainDialProps {
  /** Grain angle in degrees, [0, 180); null = no grain. */
  value: number | null;
  /** Live updates (every drag step). */
  onValueChange?: (angle: number) => void;
  /** Final value: drag end, click, keyboard step, typed value, quick button. One undo step each. */
  onValueCommit: (angle: number) => void;
  labels: GrainDialLabels;
  /** md = 120 px dial with labels; sm = 72 px for popovers and table cells. */
  size?: 'md' | 'sm';
  /** Show the typed input, quick buttons and note next to the dial. Default true. */
  controls?: boolean;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

const QUICK = [0, 45, 90, 135] as const;

const GEOMETRY = {
  md: { box: 120, ring: 44, disc: 38, tick: 4, major: 7, label: 54, grip: 5.5, lines: 6 },
  sm: { box: 72, ring: 32, disc: 27, tick: 3, major: 5, label: 0, grip: 4.5, lines: 5 },
} as const;

/**
 * Grain angle dial (T115, D-034): a disc of grain lines with a diameter handle gripped at both
 * ends (a grain has no direction), ticks every 15°, snap to 45° multiples within ±3° while
 * dragging (Alt disables it), keyboard slider semantics and an optional typed input.
 */
export function GrainDial({
  value,
  onValueChange,
  onValueCommit,
  labels,
  size = 'md',
  controls = true,
  disabled = false,
  className,
  'data-testid': testId,
}: GrainDialProps) {
  const g = GEOMETRY[size];
  const c = g.box / 2;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDragState] = useState<number | null>(null);
  // Mirrors `drag` synchronously: pointerup and lostpointercapture both end a drag.
  const dragRef = useRef<number | null>(null);
  const setDrag = (a: number | null) => {
    dragRef.current = a;
    setDragState(a);
  };
  const clipId = useId();
  const noteId = useId();
  const shown = drag ?? value;
  const has = shown !== null;
  const snapped = has && isSnappedGrainAngle(shown);

  function angleFromEvent(e: ReactPointerEvent<SVGSVGElement>): number | null {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const scale = g.box / rect.width;
    const dx = (e.clientX - rect.left) * scale - c;
    const dy = (e.clientY - rect.top) * scale - c;
    if (Math.hypot(dx, dy) < 3) return null;
    const raw = pointerToGrainAngle(dx, dy);
    if (raw === null) return null;
    return e.altKey ? raw : snapGrainAngle(raw);
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    svgRef.current?.closest<HTMLElement>('[role="slider"]')?.focus();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const a = angleFromEvent(e) ?? value ?? 0;
    setDrag(a);
    onValueChange?.(a);
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current === null) return;
    const a = angleFromEvent(e);
    if (a === null || a === dragRef.current) return;
    setDrag(a);
    onValueChange?.(a);
  }

  function endDrag(commit: boolean) {
    const a = dragRef.current;
    if (a === null) return;
    setDrag(null);
    if (commit) onValueCommit(a);
  }

  function commitStep(next: number) {
    const a = normalizeGrainAngle(next);
    onValueChange?.(a);
    onValueCommit(a);
  }

  // Typed degrees commit on Enter or blur, so one typed value is one undo step.
  const typed = useRef<number | null>(null);
  function commitTyped() {
    const v = typed.current;
    typed.current = null;
    if (v === null) return;
    const a = normalizeGrainAngle(v);
    if (a !== value) commitStep(a);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const big = e.shiftKey ? 15 : 1;
    const base = value ?? 0;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = stepGrainAngle(base, big);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = stepGrainAngle(base, -big);
    else if (e.key === 'PageUp') next = stepGrainAngle(base, 15);
    else if (e.key === 'PageDown') next = stepGrainAngle(base, -15);
    else if (e.key === 'Home') next = 0;
    if (next === null) return;
    e.preventDefault();
    commitStep(next);
  }

  const ticks: { a: number; major: boolean }[] = [];
  for (let a = 0; a < 360; a += 15) ticks.push({ a, major: a % 45 === 0 });

  // Grain lines: horizontal lines across the disc, rotated by the angle (SVG rotates clockwise).
  const lines: number[] = [];
  for (let y = -g.disc; y <= g.disc; y += g.lines) lines.push(y);

  const end1 = has ? polarToScreen(c, c, g.ring, shown) : null;
  const end2 = has ? polarToScreen(c, c, g.ring, shown + 180) : null;
  const readout = has ? `${formatNumberTr(shown, { maxDecimals: 1 })}°` : '—';
  const valueText = has ? labels.valueText(Number(shown.toFixed(1))) : labels.noGrain;

  const dial = (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={labels.label}
      aria-valuemin={0}
      aria-valuemax={179}
      aria-valuenow={has ? shown : undefined}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      aria-describedby={controls && labels.note ? noteId : undefined}
      aria-orientation="horizontal"
      data-testid={testId}
      data-value={has ? shown : ''}
      data-snapped={snapped || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        focusRing,
        'relative shrink-0 touch-none rounded-full select-none',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing',
      )}
      style={{ width: g.box, height: g.box }}
    >
      <svg
        ref={svgRef}
        width={g.box}
        height={g.box}
        viewBox={`0 0 ${g.box} ${g.box}`}
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(true)}
        onLostPointerCapture={() => endDrag(true)}
        className="block"
      >
        <defs>
          <clipPath id={clipId}>
            <circle cx={c} cy={c} r={g.disc} />
          </clipPath>
        </defs>
        <circle cx={c} cy={c} r={g.ring} className="fill-surface stroke-border-strong" />
        <circle cx={c} cy={c} r={g.disc} className="fill-surface-subtle" />
        {has ? (
          <g clipPath={`url(#${clipId})`}>
            <g transform={`rotate(${-shown} ${c} ${c})`} data-part="grain-lines">
              {lines.map((y) => (
                <line
                  key={y}
                  x1={c - g.disc}
                  x2={c + g.disc}
                  y1={c + y}
                  y2={c + y}
                  className="stroke-grain"
                  strokeWidth={1}
                />
              ))}
            </g>
          </g>
        ) : null}
        {ticks.map(({ a, major }) => {
          const p1 = polarToScreen(c, c, g.ring, a);
          const p2 = polarToScreen(c, c, g.ring - (major ? g.major : g.tick), a);
          const lit = snapped && has && Math.abs(normalizeGrainAngle(a) - shown) < 1e-6;
          return (
            <line
              key={a}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              data-lit={lit || undefined}
              className={lit ? 'stroke-accent' : 'stroke-fg-subtle'}
              strokeWidth={lit ? 2 : 1}
            />
          );
        })}
        {g.label > 0
          ? QUICK.map((a) => {
              const p = polarToScreen(c, c, g.label, a);
              return (
                <text
                  key={a}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-fg-muted font-mono"
                  fontSize={9}
                >
                  {a}
                </text>
              );
            })
          : null}
        {end1 && end2 ? (
          <g data-part="handle">
            <line
              x1={end1.x}
              y1={end1.y}
              x2={end2.x}
              y2={end2.y}
              className="stroke-accent"
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle
              cx={end1.x}
              cy={end1.y}
              r={g.grip}
              className="fill-accent stroke-surface"
              strokeWidth={2}
            />
            <circle
              cx={end2.x}
              cy={end2.y}
              r={g.grip}
              className="fill-accent stroke-surface"
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-surface/90 px-1 font-mono leading-tight text-fg shadow-xs tabular-nums',
          size === 'md' ? 'text-xs' : 'text-2xs',
        )}
        data-testid={testId ? `${testId}-readout` : undefined}
      >
        {readout}
      </span>
    </div>
  );

  if (!controls) return <div className={cn('inline-flex', className)}>{dial}</div>;

  return (
    <div className={cn('flex flex-wrap items-start gap-4', className)}>
      {dial}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <NumberInput
          value={value}
          onValueChange={(v) => {
            typed.current = v;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTyped();
          }}
          onBlur={commitTyped}
          min={-360}
          max={360}
          unit="°"
          maxDecimals={1}
          inputSize="sm"
          disabled={disabled}
          aria-label={labels.input ?? labels.label}
          className="w-24"
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <div role="group" aria-label={labels.quick} className="flex flex-wrap gap-1">
          {QUICK.map((a) => (
            <Button
              key={a}
              type="button"
              size="sm"
              variant={has && shown === a ? 'secondary' : 'ghost'}
              aria-pressed={has && shown === a}
              disabled={disabled}
              onClick={() => commitStep(a)}
              className="min-w-11 px-2 font-mono tabular-nums"
              data-testid={testId ? `${testId}-quick-${a}` : undefined}
            >
              {a}°
            </Button>
          ))}
        </div>
        {labels.note ? (
          <p id={noteId} className="text-xs text-fg-muted">
            {labels.note}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface GrainArrowProps {
  /** Grain angle in degrees (CCW from +x); null draws nothing. */
  angle: number | null;
  /** Edge length in px. Default 16. */
  size?: number;
  className?: string;
}

/**
 * Small two-headed arrow along a grain angle (T116): cut-list cells, inspectors. A grain has no
 * direction, so both ends carry a head. Decorative; the angle text sits next to it.
 */
export function GrainArrow({ angle, size = 16, className }: GrainArrowProps) {
  if (angle === null) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      data-angle={normalizeGrainAngle(angle)}
      className={cn('shrink-0', className)}
    >
      <g
        transform={`rotate(${-normalizeGrainAngle(angle)} 8 8)`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 8h12M4.5 5.5 2 8l2.5 2.5M11.5 5.5 14 8l-2.5 2.5" />
      </g>
    </svg>
  );
}
