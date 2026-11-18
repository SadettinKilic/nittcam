import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BRAND_MARK, Logo, LogoMark } from './logo';

/** All absolute coordinates of a path made of M/V/L/A commands (enough for the mark). */
function points(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLVHA])([^MLVHA]*)/g)) {
    const n = (args ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const at = (i: number) => n[i] ?? Number.NaN;
    if (cmd === 'V') y = at(0);
    else if (cmd === 'H') x = at(0);
    else if (cmd === 'A') [x, y] = [at(5), at(6)];
    else [x, y] = [at(0), at(1)];
    out.push([x, y]);
  }
  return out;
}

describe('BRAND_MARK geometry', () => {
  const half = BRAND_MARK.stroke / 2;
  const inside = ([x, y]: [number, number], pad: number) =>
    x - pad >= 0 && y - pad >= 0 && x + pad <= BRAND_MARK.viewBox && y + pad <= BRAND_MARK.viewBox;

  it('keeps every stroke and the tool dot inside the tile with clear space', () => {
    const all = [...points(BRAND_MARK.leadIn), ...points(BRAND_MARK.path)];
    for (const p of all) expect(inside(p, half + 2), `${p}`).toBe(true);
    const { cx, cy, r } = BRAND_MARK.dot;
    expect(inside([cx, cy], r + 2)).toBe(true);
  });

  it('draws an N: two vertical legs joined by one diagonal, lead-in ends on the first leg', () => {
    const pts = points(BRAND_MARK.path);
    expect(pts).toHaveLength(4);
    type P = [number, number];
    const [start, top1, bottom2, top2] = pts as [P, P, P, P];
    const [[sx, sy], [t1x], [b2x, b2y], [t2x]] = [start, top1, bottom2, top2];
    expect(sx).toBe(t1x); // first leg vertical
    expect(b2x).toBe(t2x); // second leg vertical
    expect(sy).toBe(b2y); // diagonal ends at the baseline
    expect(points(BRAND_MARK.leadIn).at(-1)).toEqual(start);
    expect(BRAND_MARK.dot.cx).toBe(t2x); // the tool stops at the end of the cut
  });
});

describe('LogoMark', () => {
  it('is decorative without a title and named with one', () => {
    expect(renderToStaticMarkup(<LogoMark />)).toContain('aria-hidden="true"');
    const named = renderToStaticMarkup(<LogoMark title="NittCam" />);
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="NittCam"');
  });

  it('uses token classes only, never raw colours', () => {
    for (const variant of ['tile', 'plain', 'mono'] as const) {
      const html = renderToStaticMarkup(<LogoMark variant={variant} />);
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
    expect(renderToStaticMarkup(<LogoMark variant="tile" />)).toContain('fill-accent');
    expect(renderToStaticMarkup(<LogoMark variant="plain" />)).toContain('fill-accent-text');
    expect(renderToStaticMarkup(<LogoMark variant="mono" />)).not.toContain('accent');
  });

  it('renders at the requested size', () => {
    expect(renderToStaticMarkup(<LogoMark size={20} />)).toContain('width="20"');
  });
});

describe('Logo', () => {
  it('shows the wordmark with "Cam" in the accent text colour', () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain('Nitt<span class="text-accent-text">Cam</span>');
  });

  it('mark-only variant has no wordmark', () => {
    expect(renderToStaticMarkup(<Logo variant="mark" />)).not.toContain('Nitt');
  });

  it('mono tone drops the accent', () => {
    expect(renderToStaticMarkup(<Logo tone="mono" />)).not.toContain('accent');
  });
});
