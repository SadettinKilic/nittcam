// Turkish number parsing and formatting for measurement inputs (T101, spec §3.7, ui-conventions).
// Pure: no Intl, so results are identical on every machine.

export type NumberParseError = 'empty' | 'invalid' | 'min' | 'max';
export type NumberParseResult =
  { ok: true; value: number } | { ok: false; error: NumberParseError };

export interface NumberBounds {
  min?: number | undefined;
  max?: number | undefined;
}

const GROUPED = /^\d{1,3}(\.\d{3})+$/; // 1.200 / 12.345.678
const DIGITS = /^\d+$/;
// Whitespace incl. NBSP (U+00A0) and narrow NBSP (U+202F), built from code points.
const SPACES = new RegExp(`[\\s${String.fromCharCode(0xa0, 0x202f)}]`, 'g');

/**
 * Parses Turkish user input: comma is the decimal separator, dot groups thousands
 * ("12,5" → 12.5, "1.200,5" → 1200.5, "1.200" → 1200). Without a comma a single dot that is not
 * a thousands group is read as a decimal point ("12.5" → 12.5) for numpad users. Spaces
 * (including NBSP) are ignored. A leading minus is allowed; anything else is invalid.
 */
export function parseNumberTr(input: string, bounds: NumberBounds = {}): NumberParseResult {
  let s = input.replace(SPACES, '');
  if (s === '') return { ok: false, error: 'empty' };
  let sign = 1;
  if (s.startsWith('-') || s.startsWith('−')) {
    sign = -1;
    s = s.slice(1);
  }
  const value = parseUnsigned(s);
  if (value === null) return { ok: false, error: 'invalid' };
  const v = sign * value;
  const result = Object.is(v, -0) ? 0 : v;
  if (bounds.min !== undefined && result < bounds.min) return { ok: false, error: 'min' };
  if (bounds.max !== undefined && result > bounds.max) return { ok: false, error: 'max' };
  return { ok: true, value: result };
}

function parseUnsigned(s: string): number | null {
  const parts = s.split(',');
  if (parts.length > 2) return null;
  const [intPart = '', frac] = parts;
  if (frac !== undefined) {
    // "12,5", "1.200,5", ",5"
    if (!DIGITS.test(frac)) return null;
    const int = intPart === '' ? '0' : normaliseInt(intPart);
    if (int === null) return null;
    return Number(`${int}.${frac}`);
  }
  const int = normaliseInt(intPart);
  if (int !== null) return Number(int);
  // "12.5": one dot that is not a thousands group → decimal point.
  const dot = /^(\d*)\.(\d+)$/.exec(intPart);
  if (dot) return Number(`${dot[1] || '0'}.${dot[2] ?? ''}`);
  return null;
}

function normaliseInt(s: string): string | null {
  if (DIGITS.test(s)) return s;
  if (GROUPED.test(s)) return s.replace(/\./g, '');
  return null;
}

export interface FormatOptions {
  /** Maximum decimals (trailing zeros are dropped). Default 3. */
  maxDecimals?: number;
  /** Group thousands with a dot. Default true. */
  group?: boolean;
}

/** Formats a number the Turkish way: 1200.5 → "1.200,5". */
export function formatNumberTr(value: number, opts: FormatOptions = {}): string {
  const { maxDecimals = 3, group = true } = opts;
  if (!Number.isFinite(value)) return '';
  const fixed = Math.abs(value).toFixed(maxDecimals);
  const [int = '0', frac = ''] = fixed.split('.');
  const trimmed = frac.replace(/0+$/, '');
  const intOut = group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : int;
  const negative = value < 0 && (Number(int) !== 0 || trimmed !== '');
  return `${negative ? '-' : ''}${intOut}${trimmed ? `,${trimmed}` : ''}`;
}

/** Adds `delta`, rounds away binary noise (0.1 + 0.2), then clamps to the bounds. */
export function stepNumber(value: number, delta: number, bounds: NumberBounds = {}): number {
  let next = Math.round((value + delta) * 1e6) / 1e6;
  if (bounds.min !== undefined) next = Math.max(bounds.min, next);
  if (bounds.max !== undefined) next = Math.min(bounds.max, next);
  return next;
}
