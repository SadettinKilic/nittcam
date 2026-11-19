import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InspectorGroup, InspectorRow, InspectorRows } from './inspector-row';

describe('InspectorRow (T249, D-040)', () => {
  it('renders label left and a one-line mono value right, 32 px high', () => {
    const html = renderToStaticMarkup(
      <InspectorRow label="Ölçü" valueProps={{ 'data-testid': 'size' }}>
        596 × 716 mm
      </InspectorRow>,
    );
    expect(html).toContain('h-8');
    expect(html).toMatch(/<span class="[^"]*text-fg-muted[^"]*">Ölçü<\/span>/);
    expect(html).toMatch(/data-testid="size"/);
    const value = /<span class="([^"]*)" data-testid="size">596 × 716 mm<\/span>/.exec(html)?.[1];
    expect(value).toBeDefined();
    for (const c of ['font-mono', 'truncate', 'whitespace-nowrap', 'text-right', 'min-w-0']) {
      expect(value).toContain(c);
    }
  });

  it('can use the UI font for words', () => {
    const html = renderToStaticMarkup(
      <InspectorRow label="Ad" mono={false}>
        Yan dikme
      </InspectorRow>,
    );
    expect(html).not.toContain('font-mono');
  });

  it('stacks rows with dividers', () => {
    const html = renderToStaticMarkup(
      <InspectorRows data-testid="rows">
        <InspectorRow label="a">1</InspectorRow>
        <InspectorRow label="b">2</InspectorRow>
      </InspectorRows>,
    );
    expect(html).toContain('divide-y');
    expect(html.match(/data-slot="inspector-row"/g)).toHaveLength(2);
  });
});

describe('InspectorGroup (T130)', () => {
  it('renders a heading toggle with aria-expanded and aria-controls, open by default', () => {
    const html = renderToStaticMarkup(
      <InspectorGroup title="Kenar">
        <InspectorRow label="Uzunluk">300 mm</InspectorRow>
      </InspectorGroup>,
    );
    expect(html).toMatch(/<button type="button" aria-expanded="true" aria-controls="([^"]+)"/);
    const id = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain('hidden=""');
  });

  it('starts collapsed with defaultOpen=false (content hidden, still mounted)', () => {
    const html = renderToStaticMarkup(
      <InspectorGroup title="Köşe" defaultOpen={false}>
        <InspectorRow label="X">10 mm</InspectorRow>
      </InspectorGroup>,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
    expect(html).toContain('10 mm');
  });
});
