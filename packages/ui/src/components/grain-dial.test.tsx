import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GrainDial } from './grain-dial';

const labels = {
  label: 'Damar açısı',
  valueText: (d: number) => `${d} derece`,
  noGrain: 'Damar yok',
  note: '30° ile 210° aynı damardır',
};

describe('GrainDial', () => {
  it('renders slider semantics with valuetext', () => {
    const html = renderToStaticMarkup(
      <GrainDial value={30} onValueCommit={() => {}} labels={labels} />,
    );
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuenow="30"');
    expect(html).toContain('aria-valuetext="30 derece"');
    expect(html).toContain('rotate(-30 60 60)');
    expect(html).toContain('30°');
    expect(html).toContain('30° ile 210° aynı damardır');
  });

  it('lights both snap ticks at 90°', () => {
    const html = renderToStaticMarkup(
      <GrainDial value={90} onValueCommit={() => {}} labels={labels} controls={false} />,
    );
    expect(html.match(/data-lit="true"/g)).toHaveLength(2);
    expect(html).toContain('data-snapped="true"');
  });

  it('shows the no-grain state without handle or lines', () => {
    const html = renderToStaticMarkup(
      <GrainDial value={null} onValueCommit={() => {}} labels={labels} size="sm" disabled />,
    );
    expect(html).toContain('aria-valuetext="Damar yok"');
    expect(html).not.toContain('data-part="handle"');
    expect(html).not.toContain('data-part="grain-lines"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('width="72"');
  });
});
