'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState, type ComponentProps, type KeyboardEvent } from 'react';
import { cn } from '../lib/cn';
import { formatNumberTr, parseNumberTr, stepNumber, type NumberParseError } from '../lib/number';
import { fieldBase } from '../lib/styles';
import { useFieldControlProps } from './form-field';

export interface NumberInputProps extends Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step' | 'size'
> {
  /** Current value in data units (mm); null = empty. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Reports the parse state while typing (null = valid); show the text through FormField. */
  onValidityChange?: (error: NumberParseError | null) => void;
  min?: number;
  max?: number;
  /** Arrow-key / stepper step. Shift+arrow steps ×10. Default 1. */
  step?: number;
  /** Unit suffix shown inside the field, e.g. "mm". */
  unit?: string;
  /** Decimals kept when formatting. Default 2. */
  maxDecimals?: number;
  /** Empty counts as an error ('empty'). */
  required?: boolean;
  /** Force the invalid look (e.g. a server-side error). */
  invalid?: boolean;
  inputSize?: 'sm' | 'md' | 'lg';
  /** aria-labels of the stepper buttons; the buttons are hidden when omitted. */
  incrementLabel?: string;
  decrementLabel?: string;
}

const heights = { sm: 'h-control-sm', md: 'h-control-md', lg: 'h-control-lg' };

/**
 * Measurement input: Turkish decimal comma, dot thousands, unit suffix, min/max, arrow-key and
 * stepper steps, invalid state. Text stays as typed while focused and is reformatted on blur.
 */
export function NumberInput({
  value,
  onValueChange,
  onValidityChange,
  min,
  max,
  step = 1,
  unit,
  maxDecimals = 2,
  required = false,
  invalid = false,
  inputSize = 'md',
  incrementLabel,
  decrementLabel,
  className,
  disabled,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}: NumberInputProps) {
  const fmt = (v: number | null) => (v === null ? '' : formatNumberTr(v, { maxDecimals }));
  const [text, setText] = useState(() => fmt(value));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<NumberParseError | null>(null);
  const [shown, setShown] = useState(value);
  // Follow outside changes of `value` unless the user is typing (derived state, no effect).
  if (!editing && value !== shown) {
    setShown(value);
    setText(fmt(value));
    setError(null);
  }
  const field = useFieldControlProps(props);
  const bounds = { min, max };

  function report(next: NumberParseError | null) {
    setError(next);
    if (next !== error) onValidityChange?.(next);
  }

  function commit(next: number | null) {
    setShown(next);
    onValueChange(next);
  }

  function handleText(t: string) {
    setText(t);
    const r = parseNumberTr(t, bounds);
    if (r.ok) {
      report(null);
      commit(r.value);
    } else if (r.error === 'empty' && !required) {
      report(null);
      commit(null);
    } else {
      report(r.error);
    }
  }

  function stepBy(direction: 1 | -1, big: boolean) {
    const parsed = parseNumberTr(text);
    const base = parsed.ok ? parsed.value : (value ?? min ?? 0);
    const next = stepNumber(base, direction * step * (big ? 10 : 1), bounds);
    setText(fmt(next));
    report(null);
    commit(next);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented || disabled) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      stepBy(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
    }
  }

  const isInvalid = invalid || error !== null || field['aria-invalid'] === true;
  const showStepper = incrementLabel !== undefined && decrementLabel !== undefined;

  return (
    <div
      className={cn(
        fieldBase,
        'group/num flex items-stretch overflow-hidden',
        'focus-within:border-focus focus-within:ring-3 focus-within:ring-focus/25',
        isInvalid && 'border-danger focus-within:border-danger focus-within:ring-danger/25',
        disabled && 'cursor-not-allowed bg-surface-subtle text-fg-disabled shadow-none',
        heights[inputSize],
        className,
      )}
    >
      <input
        {...props}
        {...field}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        role="spinbutton"
        aria-valuenow={value ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={isInvalid || undefined}
        disabled={disabled}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        onFocus={(e) => {
          setEditing(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setEditing(false);
          const r = parseNumberTr(text, bounds);
          if (r.ok) setText(fmt(r.value));
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'numeric min-w-0 flex-1 bg-transparent px-3 text-right outline-none',
          'placeholder:text-fg-subtle disabled:cursor-not-allowed',
          inputSize === 'lg' && 'text-base',
        )}
      />
      {unit ? (
        <span
          aria-hidden
          className="flex items-center pr-3 text-sm text-fg-subtle select-none group-focus-within/num:text-fg-muted"
        >
          {unit}
        </span>
      ) : null}
      {showStepper ? (
        <div className="flex w-7 flex-col border-l border-border">
          <button
            type="button"
            tabIndex={-1}
            aria-label={incrementLabel}
            disabled={disabled || (max !== undefined && value !== null && value >= max)}
            onClick={() => stepBy(1, false)}
            className="flex flex-1 items-center justify-center text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40"
          >
            <ChevronUp className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label={decrementLabel}
            disabled={disabled || (min !== undefined && value !== null && value <= min)}
            onClick={() => stepBy(-1, false)}
            className="flex flex-1 items-center justify-center border-t border-border text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40"
          >
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
