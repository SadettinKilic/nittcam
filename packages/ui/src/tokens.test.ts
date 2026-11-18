/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Contrast guard for the design tokens (T100, spec §3.7 "AA kontrast her iki temada").
// Parses tokens.css, resolves var() chains for light (@theme) and dark (.dark), and checks the
// documented text/background pairs.

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function block(selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`block ${selector} not found`);
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (depth > 0 && i < css.length) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  const body = css.slice(start, i - 1).replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  for (const [, name = '', value = ''] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

const light = block(/@theme static\s*\{/);
const dark = { ...light, ...block(/\n\.dark\s*\{/) };

function resolve(vars: Record<string, string>, name: string, seen = 0): string {
  const v = vars[name];
  if (v === undefined) throw new Error(`unknown token ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(v)?.[1];
  if (ref) {
    if (seen > 10) throw new Error(`var cycle at ${name}`);
    return resolve(vars, ref, seen + 1);
  }
  return v;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const SURFACES = ['bg', 'surface', 'surface-subtle', 'surface-raised', 'surface-hover'];

/** [text, background] pairs that must reach 4.5:1. */
const TEXT_PAIRS: Array<[string, string]> = [
  ...SURFACES.flatMap((s) =>
    ['fg', 'fg-muted', 'fg-subtle', 'accent-text'].map((t): [string, string] => [t, s]),
  ),
  ['fg', 'surface-active'],
  ['fg-muted', 'surface-active'],
  ['accent-fg', 'accent'],
  ['accent-fg', 'accent-hover'],
  ['accent-text', 'accent-subtle'],
  ['fg', 'accent-subtle'],
  ['danger-fg', 'danger-hover'],
  // ErrorState (T105): title and text on the danger tint
  ['fg', 'danger-subtle'],
  ['fg-muted', 'danger-subtle'],
  ...['success', 'warning', 'danger', 'info'].flatMap((k): Array<[string, string]> => [
    [`${k}-fg`, k],
    [`${k}-text`, 'surface'],
    [`${k}-text`, 'bg'],
    [`${k}-text`, `${k}-subtle`],
  ]),
];

/** Non-text UI pairs (focus ring, solid controls) that must reach 3:1 (WCAG 1.4.11). */
const UI_PAIRS: Array<[string, string]> = [
  ['focus', 'surface'],
  ['focus', 'bg'],
  ['accent', 'surface'],
  ['danger', 'surface'],
];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('tokens contrast (%s)', (_theme, vars) => {
  it.each(TEXT_PAIRS)('%s on %s ≥ 4.5:1', (fg, bg) => {
    const ratio = contrast(resolve(vars, `--color-${fg}`), resolve(vars, `--color-${bg}`));
    expect(ratio, `${fg}/${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
  it.each(UI_PAIRS)('%s against %s ≥ 3:1', (fg, bg) => {
    const ratio = contrast(resolve(vars, `--color-${fg}`), resolve(vars, `--color-${bg}`));
    expect(ratio, `${fg}/${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
  });
});

describe('token file shape', () => {
  it('defines every semantic role in light and overrides it in dark', () => {
    const roles = [
      'bg',
      'surface',
      'surface-subtle',
      'surface-raised',
      'border',
      'border-strong',
      'fg',
      'fg-muted',
      'accent',
      'accent-fg',
      'focus',
      'success',
      'warning',
      'danger',
      'info',
    ];
    const darkOnly = block(/\n\.dark\s*\{/);
    for (const r of roles) {
      expect(light[`--color-${r}`], `light ${r}`).toBeDefined();
      expect(darkOnly[`--color-${r}`], `dark ${r}`).toBeDefined();
    }
  });

  it('has radius, spacing, shadow, type and motion tokens', () => {
    for (const t of ['--radius-md', '--spacing', '--shadow-md', '--text-sm', '--font-sans']) {
      expect(light[t], t).toBeDefined();
    }
    expect(css).toMatch(/--duration-fast:/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('switches the Tailwind default palette off', () => {
    expect(css).toContain('--color-*: initial;');
  });
});

describe('density scope (T195)', () => {
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  };
  const value = (src: string, name: string) =>
    new RegExp(`${name}:\\s*([^;]+);`).exec(src)?.[1]?.trim();

  it('comfortable defaults: 40 px controls and rows, 16 px panel padding', () => {
    expect(value(css, '--spacing-control-md')).toBe('2.5rem');
    expect(value(css, '--spacing-row')).toBe('2.5rem');
    expect(value(css, '--spacing-panel')).toBe('1rem');
  });

  it('compact: 32 px controls, 36 px rows, 12 px panel padding', () => {
    const compact = block("[data-density='compact']");
    expect(value(compact, '--spacing-control-md')).toBe('2rem');
    expect(value(compact, '--spacing-row')).toBe('2.25rem');
    expect(value(compact, '--spacing-panel')).toBe('0.75rem');
  });

  it('mono family is the self-hosted font with generic fallbacks only', () => {
    const mono = value(css, '--font-mono') ?? '';
    expect(mono.startsWith('var(--font-jetbrains-mono)')).toBe(true);
    expect(mono).not.toMatch(/consolas|courier/i);
  });
});
