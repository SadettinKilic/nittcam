import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DOMAIN_ICONS, RouterIcon } from './domain-icons';

describe('domain icons', () => {
  it('has the six CNC icons on the lucide grid', () => {
    expect(Object.keys(DOMAIN_ICONS)).toEqual([
      'router',
      'sheet',
      'grain',
      'nesting',
      'toolpath',
      'airCut',
    ]);
    for (const Icon of Object.values(DOMAIN_ICONS)) {
      const html = renderToStaticMarkup(<Icon />);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('stroke-width="1.5"');
      expect(html).toContain('stroke-linecap="round"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it('keeps every coordinate inside the 24 px box with 2 px padding', () => {
    for (const Icon of Object.values(DOMAIN_ICONS)) {
      const html = renderToStaticMarkup(<Icon />);
      const nums = [...html.matchAll(/ (?:x|y|cx|cy|width|height)="([\d.]+)"/g)].map((m) =>
        Number(m[1]),
      );
      for (const n of nums.filter((n) => n !== 24)) expect(n).toBeLessThanOrEqual(22);
    }
  });

  it('takes size, stroke width and an accessible name like lucide', () => {
    const html = renderToStaticMarkup(
      <RouterIcon size={16} strokeWidth={2} aria-label="Router" className="text-fg" />,
    );
    expect(html).toContain('width="16"');
    expect(html).toContain('stroke-width="2"');
    expect(html).toContain('aria-label="Router"');
    expect(html).not.toContain('aria-hidden');
    expect(renderToStaticMarkup(<RouterIcon size={12} absoluteStrokeWidth />)).toContain(
      'stroke-width="3"',
    );
  });
});
