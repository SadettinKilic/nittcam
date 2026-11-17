'use client';

import { parseCutListNumber } from '@nittcam/core';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

export const inputClass =
  'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-bg';

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
    if (n === value || onCommit(n)) {
      setText(null);
      setError(null);
      return true;
    }
    setError(errors.rejected);
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
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        list={list}
        data-testid={testId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClass} text-right tabular-nums`}
        value={text ?? formatInput(value)}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
