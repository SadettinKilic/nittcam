import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { formatNumberTr } from '../lib/number';

export interface MeasureProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** One value, or several joined with " × " (e.g. sheet width × height). */
  value: number | readonly number[];
  /** Unit after the value in `fg-muted` (mm, mm/dk, dev/dk, %). Omit for a bare count. */
  unit?: string;
  /** Maximum decimals, trailing zeros dropped (default 1). */
  maxDecimals?: number;
  /** Fixed decimals (keeps trailing zeros, e.g. "18,0"). Wins over `maxDecimals`. */
  decimals?: number;
  /** Self-hosted mono family (coordinates, read-outs); default is Inter tabular figures. */
  mono?: boolean;
  /** Shown instead when a value is missing or not finite. */
  empty?: string;
}

/** Turkish number text: 1220.5 → "1.220,5"; fixed decimals keep zeros ("18,0"). */
export function formatMeasure(
  value: number,
  opts: { maxDecimals?: number | undefined; decimals?: number | undefined } = {},
): string {
  if (!Number.isFinite(value)) return '';
  if (opts.decimals === undefined)
    return formatNumberTr(value, { maxDecimals: opts.maxDecimals ?? 1 });
  const text = formatNumberTr(value, { maxDecimals: opts.decimals });
  if (opts.decimals === 0) return text;
  const [int, frac = ''] = text.split(',');
  return `${int},${frac.padEnd(opts.decimals, '0')}`;
}

/**
 * A measurement (T195): value(s) + unit with Turkish formatting and tabular figures, so
 * columns line up; the unit is quieter than the number. Replaces hand-built "1.220 × 2.440 mm".
 */
export function Measure({
  value,
  unit,
  maxDecimals,
  decimals,
  mono = false,
  empty = '—',
  className,
  ...rest
}: MeasureProps) {
  const values = typeof value === 'number' ? [value] : value;
  const ok = values.length > 0 && values.every(Number.isFinite);
  const text = ok
    ? values.map((v) => formatMeasure(v, { maxDecimals, decimals })).join(' × ')
    : empty;
  return (
    <span
      data-measure=""
      className={cn('numeric whitespace-nowrap', mono && 'font-mono', className)}
      {...rest}
    >
      {text}
      {ok && unit ? ' ' : null}
      {ok && unit ? <span className="font-normal text-fg-muted">{unit}</span> : null}
    </span>
  );
}
