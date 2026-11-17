/**
 * Text and number formatting for the post processor (spec §7.2 rule 8, §6.4; D-025). Pure.
 */

/** Thrown when a value cannot be written safely (NaN, Infinity, out of range). */
export class PostFormatError extends Error {
  override name = 'PostFormatError';
}

/** Largest magnitude written; anything above is a bug upstream (envelopes are ≤ 10 m). */
export const MAX_ABS_VALUE = 1e7;

/**
 * Fixed-decimal number (rule 8): never exponent notation, NaN, Infinity, `-0.000` or an empty
 * string. Throws `PostFormatError` instead of writing a bad value.
 */
export function formatFixed(value: number, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new PostFormatError(`invalid decimal count ${decimals}`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PostFormatError(`non-finite number ${String(value)}`);
  }
  if (Math.abs(value) > MAX_ABS_VALUE) {
    throw new PostFormatError(`number ${value} out of range`);
  }
  const s = value.toFixed(decimals);
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new PostFormatError(`bad number text ${s}`);
  // "-0.000" (a tiny negative rounded to zero) is written without the sign.
  if (Number(s) === 0) return (0).toFixed(decimals);
  return s;
}

/** Same value rounded up at `decimals` (a dwell must never get shorter by rounding). */
export function formatFixedCeil(value: number, decimals: number): string {
  const f = 10 ** decimals;
  // The small slack keeps 5.0 at 5.0 despite float noise (5.0000000001 → 5.0, not 5.1).
  return formatFixed(Math.ceil(value * f - 1e-9) / f, decimals);
}

const TURKISH: Record<string, string> = {
  ş: 's',
  Ş: 'S',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ü: 'u',
  Ü: 'U',
  ç: 'c',
  Ç: 'C',
  â: 'a',
  Â: 'A',
  î: 'i',
  Î: 'I',
  û: 'u',
  Û: 'U',
};

/** Turkish letters → ASCII (ş→s, ğ→g, ı→i, İ→I, ö→o, ü→u, ç→c and capitals). */
export function transliterateTurkish(text: string): string {
  let out = '';
  for (const ch of text) out += TURKISH[ch] ?? ch;
  return out;
}

export interface CommentFormat {
  style: 'paren' | 'semicolon';
  asciiOnly: boolean;
  maxLength: number;
}

/**
 * Comment text as it may appear inside the delimiters: control characters and line breaks
 * become spaces, parentheses are removed for `( )` comments (a `)` would end the comment early,
 * a nested `(` is an error on many controllers), Turkish letters are transliterated and other
 * non-ASCII characters dropped when `asciiOnly`, spaces collapsed, cut to `maxLength`.
 */
export function sanitizeComment(text: string, format: CommentFormat): string {
  let s = text.replace(/[\u0000-\u001F\u007F]/g, ' ');
  if (format.style === 'paren') s = s.replace(/[()]/g, '');
  if (format.asciiOnly) {
    s = transliterateTurkish(s.normalize('NFC')).replace(/[^\x20-\x7E]/g, '');
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > format.maxLength) s = s.slice(0, format.maxLength).trimEnd();
  return s;
}

/** A full comment block (`(text)` or `; text`); empty text gives null. */
export function formatComment(text: string, format: CommentFormat): string | null {
  const s = sanitizeComment(text, format);
  if (s === '') return null;
  return format.style === 'paren' ? `(${s})` : `; ${s}`;
}

/**
 * File-name stem: Turkish letters transliterated, anything outside `[A-Za-z0-9_-]` becomes `_`,
 * repeats collapsed, `_` trimmed at the ends; empty → `nittcam`.
 */
export function sanitizeFileStem(name: string): string {
  const s = transliterateTurkish(name.normalize('NFC'))
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return s === '' ? 'nittcam' : s;
}

/**
 * `<stem><suffix>.<ext>` within `maxLength` characters: the stem is shortened first, the suffix
 * (sheet/tool/part markers) is kept whole. Null when even a one-character stem does not fit.
 */
export function buildFileName(
  stem: string,
  suffix: string,
  extension: string,
  maxLength: number,
): string | null {
  const tail = `${suffix}.${extension}`;
  const room = maxLength - tail.length;
  if (room < 1) return null;
  let s = sanitizeFileStem(stem)
    .slice(0, room)
    .replace(/[_-]+$/g, '');
  if (s === '') s = 'n';
  return `${s}${tail}`;
}
