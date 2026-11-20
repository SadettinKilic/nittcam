'use client';

import { parseCutListNumber } from '@nittcam/core';
import { cn, fieldBase, fieldFocus } from '@nittcam/ui';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

/** Native inputs and selects of the wizard, in the @nittcam/ui field look (T109). */
export const inputClass = cn(fieldBase, fieldFocus, 'h-control-md px-3');

/** Numbers in inputs: Turkish decimal comma, no grouping. */
export function formatInput(v: number): string {
  return String(v).replace('.', ',');
}

/**
 * A millimetre input that runs its command on Enter or blur (one undo step per edit), like the
 * cut-list cells (D-018). Esc drops the typed text. Accepts a decimal comma.
 */
export function NumberField({
  label,
  value,
  onCommit,
  errors,
  testId,
  min = 0,
  list,
  unit = null,
  bounds,
  inUse,
}: {
  label: string;
  value: number;
  /** Runs the command; false when it was rejected. */
  onCommit: (value: number) => boolean;
  errors: { number: string; positive: string; rejected: string };
  testId?: string | undefined;
  /** Values must be greater than this. */
  min?: number;
  list?: string | undefined;
  /** Unit suffix inside the field; null for none. */
  unit?: string | null;
  /**
   * T293: the accepted range, said in the error ("En az 3 mm", "1–17 mm arası"): a value outside
   * it (or not whole when `integer`) is refused before the command runs.
   */
  bounds?:
    | {
        min: number;
        max?: number;
        integer?: boolean;
        message: string;
        /** B44: said instead of `message` for a value above `max` ("çok yüksek"). */
        highMessage?: string;
      }
    | undefined;
  /** B44: shown with a refused value, so the value still in use is visible ("kullanılan: 4"). */
  inUse?: string | undefined;
}) {
  const id = useId();
  const [text, setTextState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);

  function setText(v: string | null) {
    pending.current = v;
    setTextState(v);
  }

  function commit(): boolean {
    const typed = pending.current;
    if (typed === null) return true;
    const n = parseCutListNumber(typed, 'comma');
    if (n === null) {
      setError(errors.number);
      return false;
    }
    if (n <= min) {
      setError(errors.positive);
      return false;
    }
    if (
      bounds &&
      (n < bounds.min - 1e-9 ||
        (bounds.max !== undefined && n > bounds.max + 1e-9) ||
        (bounds.integer && !Number.isInteger(n)))
    ) {
      const high = bounds.max !== undefined && n > bounds.max + 1e-9;
      setError(high && bounds.highMessage ? bounds.highMessage : bounds.message);
      return false;
    }
    if (n === value || onCommit(n)) {
      setText(null);
      setError(null);
      return true;
    }
    setError(bounds?.message ?? errors.rejected);
    return false;
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setText(null);
      setError(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          list={list}
          data-testid={testId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(inputClass, 'text-right tabular-nums', unit && 'pr-10')}
          value={text ?? formatInput(value)}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={onKeyDown}
        />
        {unit ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-fg-subtle"
          >
            {unit}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-danger-text">
          {error}
          {inUse ? (
            <span className="block font-normal text-fg-muted" data-testid="field-in-use">
              {inUse}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
