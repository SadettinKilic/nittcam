/**
 * Canvas colours from the design tokens (D-032, T110). Konva cannot use CSS classes, so the
 * views read the `--color-*` custom properties of `<html>` and read them again whenever the
 * theme changes (class on `<html>` from next-themes, or the system colour scheme).
 */

/** Reads each token (a CSS custom property name) from a computed style; missing → grey. */
export function readTokenColors<K extends string>(
  tokens: Record<K, string>,
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const [key, token] of Object.entries(tokens) as [K, string][]) {
    out[key] = style.getPropertyValue(token).trim() || '#888888';
  }
  return out;
}

/** Calls `onChange` after every theme switch; returns the unsubscribe function. */
export function onThemeChange(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const html = document.documentElement;
  const mo = new MutationObserver(() => onChange());
  mo.observe(html, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener('change', onChange);
  return () => {
    mo.disconnect();
    mq?.removeEventListener('change', onChange);
  };
}

/** The `--font-mono` stack (T195) from a computed style; missing → generic monospace. */
export function monoFontFamily(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): string {
  return style.getPropertyValue('--font-mono').trim() || 'monospace';
}

let monoCache: string | null = null;

/**
 * Font family for canvas labels and read-outs (dimension labels, coordinates, badges): the
 * self-hosted mono, so Windows never falls back to Consolas/Courier. Read once (it does not
 * change with the theme); `monospace` during server rendering.
 */
export function canvasMonoFont(): string {
  if (monoCache) return monoCache;
  if (typeof window === 'undefined') return 'monospace';
  monoCache = monoFontFamily(getComputedStyle(document.documentElement));
  return monoCache;
}
