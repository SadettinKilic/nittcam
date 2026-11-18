'use client';

import { IconButton, Input, cn, formatMeasure } from '@nittcam/ui';
import { Check, X } from 'lucide-react';
import type { Messages } from '../../lib/messages';
import type { DrawField } from '../../lib/editor/draw-tool';
import type { Pt } from '../../lib/editor/viewport';

type T = Messages['editor']['draw'];

export interface DynamicInputProps {
  t: T;
  fields: readonly DrawField[];
  /** Typed text per field ('' = not typed: the live value shows). */
  values: readonly string[];
  active: number;
  live: Partial<Record<DrawField, number>>;
  /** Screen position of the cursor inside the canvas (floating chip). */
  at: Pt | null;
  /** Phones: a one-row bar docked at the bottom of the canvas with numeric inputs. */
  docked: boolean;
  canvas: { w: number; h: number };
  onChange: (index: number, value: string) => void;
  onFocusField: (index: number) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function show(field: DrawField, v: number | undefined): string {
  if (v === undefined) return '—';
  return field === 'angle'
    ? `${formatMeasure(v, { decimals: 1 })}°`
    : formatMeasure(v, { decimals: 1 });
}

/**
 * Dynamic input chip of the drawing tools (D-039): one mono chip at the cursor showing the live
 * values; digits typed on the keyboard fill the active field (the board's key handler), Tab
 * switches fields, Enter commits, Esc cancels. On phones it docks above the keyboard as a one-row
 * bar with `inputmode="decimal"` fields.
 */
export function DynamicInput(p: DynamicInputProps) {
  if (p.fields.length === 0) return null;
  if (p.docked) {
    return (
      <div
        role="group"
        aria-label={p.t.chip}
        data-testid="editor-dynamic-input"
        data-docked="true"
        className="pointer-events-auto absolute inset-x-2 bottom-2 z-20 flex items-center gap-1.5 rounded-lg border border-border bg-surface/95 p-1.5 shadow-sm backdrop-blur-sm"
      >
        {p.fields.map((f, i) => (
          <label key={f} className="flex min-w-0 flex-1 items-center gap-1 font-mono text-xs">
            <span className="shrink-0 text-fg-muted">{p.t.fields[f]}</span>
            <Input
              inputSize="sm"
              inputMode="decimal"
              enterKeyHint="done"
              className="min-w-0 flex-1 font-mono tabular-nums"
              data-testid={`editor-input-${f}`}
              value={p.values[i] ?? ''}
              placeholder={show(f, p.live[f])}
              onFocus={() => p.onFocusField(i)}
              onChange={(e) => p.onChange(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  p.onCommit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  p.onCancel();
                }
              }}
            />
          </label>
        ))}
        <IconButton size="sm" variant="primary" aria-label={p.t.apply} onClick={p.onCommit}>
          <Check aria-hidden />
        </IconButton>
        <IconButton size="sm" variant="ghost" aria-label={p.t.cancel} onClick={p.onCancel}>
          <X aria-hidden />
        </IconButton>
      </div>
    );
  }
  if (!p.at) return null;
  // Below-right of the cursor, kept inside the canvas.
  const x = Math.min(p.at.x + 16, Math.max(0, p.canvas.w - 220));
  const y = Math.min(p.at.y + 18, Math.max(0, p.canvas.h - 32));
  return (
    <div
      role="status"
      aria-label={p.t.chip}
      data-testid="editor-dynamic-input"
      className="pointer-events-none absolute z-20 flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 font-mono text-2xs text-accent-fg tabular-nums shadow-sm"
      style={{ left: x, top: y }}
    >
      {p.fields.map((f, i) => {
        const typed = p.values[i] ?? '';
        const active = i === p.active;
        return (
          <span key={f} className="flex items-center gap-1">
            {i > 0 ? (
              <span aria-hidden className="opacity-60">
                ;
              </span>
            ) : null}
            <span className="opacity-75">{p.t.fields[f]}</span>
            <span
              data-testid={`editor-input-${f}`}
              className={cn(
                'min-w-[3ch] rounded-sm px-0.5',
                active && 'bg-accent-fg/20 ring-1 ring-accent-fg/60',
              )}
            >
              {typed !== '' ? typed : show(f, p.live[f])}
              {active && typed !== '' ? (
                <span aria-hidden className="motion-safe:animate-pulse">
                  ▏
                </span>
              ) : null}
            </span>
          </span>
        );
      })}
    </div>
  );
}
