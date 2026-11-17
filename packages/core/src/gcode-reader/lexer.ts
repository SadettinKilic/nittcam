/**
 * Line lexer of the G-code reader (T018, D-026). Pure, no regular expressions in the hot loop.
 *
 * A line is: optional block delete `/`, or a `%` program marker; then words (a letter and a
 * number, whitespace optional, case-insensitive), `( … )` comments and a `;` comment to the end of
 * the line. Numbers: optional sign, digits with an optional decimal point (`.5`, `5.`, `-0.5`).
 * Exponents (`1e3`), `NaN`, `Inf`, a lone sign or a second point are errors, never parsed silently.
 */

export interface Word {
  /** Upper-case letter. */
  letter: string;
  value: number;
  /** Source text of the word, upper-cased (for messages). */
  raw: string;
}

export interface LexError {
  code: 'EXPONENT_NUMBER' | 'INVALID_NUMBER' | 'UNCLOSED_COMMENT' | 'UNEXPECTED_CHARACTER';
  message: string;
}

export interface LexedLine {
  words: Word[];
  comments: string[];
  blockDelete: boolean;
  percent: boolean;
  error: LexError | null;
}

const C_0 = 48;
const C_9 = 57;
const C_DOT = 46;
const C_PLUS = 43;
const C_MINUS = 45;
const C_SPACE = 32;
const C_TAB = 9;

function isDigit(c: number): boolean {
  return c >= C_0 && c <= C_9;
}

function isLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isSpace(c: number): boolean {
  return c === C_SPACE || c === C_TAB || c === 0x0c || c === 0x0b || c === 0xa0 || c === 0xfeff;
}

/** The letter and the run of word-like characters after it, for error messages (`XNAN`). */
function rawToken(s: string, start: number): string {
  let end = start + 1;
  while (end < s.length) {
    const c = s.charCodeAt(end);
    if (isDigit(c) || isLetter(c) || c === C_DOT || c === C_PLUS || c === C_MINUS) end++;
    else break;
  }
  return s.slice(start, end).toUpperCase();
}

export function lexLine(s: string): LexedLine {
  const out: LexedLine = {
    words: [],
    comments: [],
    blockDelete: false,
    percent: false,
    error: null,
  };
  const n = s.length;
  let i = 0;
  while (i < n && isSpace(s.charCodeAt(i))) i++;
  if (i < n && s[i] === '/') {
    out.blockDelete = true;
    i++;
  } else if (i < n && s[i] === '%') {
    out.percent = true;
    i++;
  }

  while (i < n) {
    const c = s.charCodeAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === 40 /* ( */) {
      const close = s.indexOf(')', i + 1);
      if (close < 0) {
        out.error = { code: 'UNCLOSED_COMMENT', message: 'Comment "(" is not closed on its line' };
        return out;
      }
      out.comments.push(s.slice(i + 1, close).trim());
      i = close + 1;
      continue;
    }
    if (c === 59 /* ; */) {
      out.comments.push(s.slice(i + 1).trim());
      return out;
    }
    if (!isLetter(c)) {
      out.error = {
        code: 'UNEXPECTED_CHARACTER',
        message: `Unexpected character "${s[i] ?? ''}" (macros, expressions and checksums are not supported)`,
      };
      return out;
    }

    const start = i;
    const letter = (s[i] ?? '').toUpperCase();
    i++;
    while (i < n && isSpace(s.charCodeAt(i))) i++;
    const numStart = i;
    if (i < n && (s.charCodeAt(i) === C_PLUS || s.charCodeAt(i) === C_MINUS)) i++;
    let digits = 0;
    while (i < n && isDigit(s.charCodeAt(i))) {
      i++;
      digits++;
    }
    if (i < n && s.charCodeAt(i) === C_DOT) {
      i++;
      while (i < n && isDigit(s.charCodeAt(i))) {
        i++;
        digits++;
      }
    }
    if (digits === 0) {
      out.error = {
        code: 'INVALID_NUMBER',
        message: `Word "${rawToken(s, start)}" has no valid number`,
      };
      return out;
    }
    const next = i < n ? s.charCodeAt(i) : -1;
    if (next === 101 || next === 69 /* e E */) {
      const a = i + 1 < n ? s.charCodeAt(i + 1) : -1;
      const b = i + 2 < n ? s.charCodeAt(i + 2) : -1;
      if (isDigit(a) || ((a === C_PLUS || a === C_MINUS) && isDigit(b))) {
        out.error = {
          code: 'EXPONENT_NUMBER',
          message: `Word "${rawToken(s, start)}" uses exponent notation (not allowed, §7.2 rule 8)`,
        };
        return out;
      }
    }
    if (next === C_DOT) {
      out.error = {
        code: 'INVALID_NUMBER',
        message: `Word "${rawToken(s, start)}" has more than one decimal point`,
      };
      return out;
    }
    const text = s.slice(numStart, i);
    const value = Number(text);
    if (!Number.isFinite(value)) {
      out.error = {
        code: 'INVALID_NUMBER',
        message: `Word "${rawToken(s, start)}" is not a finite number`,
      };
      return out;
    }
    out.words.push({ letter, value: value === 0 ? 0 : value, raw: letter + text });
  }
  return out;
}
