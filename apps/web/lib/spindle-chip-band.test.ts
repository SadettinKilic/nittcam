import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import { SpindleSettings } from '../components/simulation/spindle-settings';
import { spindleSettingsOf } from '@nittcam/core';
import { vGrooveProfile, vGrooveTrayProject } from '../../../packages/core/src/post/golden.testing';

const t = tr.simulation.cutting.spindle;
const errors = { number: 'n', positive: 'p', rejected: 'r' };

function render(feed?: number) {
  const machine = vGrooveProfile('mach3');
  const base = vGrooveTrayProject(8);
  const vbit = spindleSettingsOf(base, machine).find(
    (r) => machine.tools.find((x) => x.number === r.tool)?.type === 'vBit',
  );
  if (!vbit) throw new Error('no V-bit row');
  const project =
    feed === undefined
      ? base
      : { ...base, cutting: { ...base.cutting, feeds: { [String(vbit.tool)]: { feed } } } };
  const html = renderToStaticMarkup(
    createElement(SpindleSettings, { t, errors, project, machine, run: () => true }),
  );
  return { html, tool: vbit.tool };
}

describe('T359: the chip-load band leads the Kesim ayarları row for metal', () => {
  it('in band: the band line first, no fix, no plain chip line', () => {
    const { html, tool } = render();
    const row = html.slice(html.indexOf(`data-testid="sim-spindle-T${tool}"`));
    expect(row.indexOf(`sim-spindle-T${tool}-chipband`)).toBeLessThan(
      row.indexOf(`sim-spindle-T${tool}-input`),
    );
    expect(row).toContain('data-in-band="true"');
    expect(row).toContain('0,020–0,050');
    expect(html).not.toContain(`sim-spindle-T${tool}-chip"`);
    expect(html).not.toContain(`sim-spindle-T${tool}-chipfix`);
  });

  it('out of band (ACM V-bit at F6000): warning with the feed that fixes it', () => {
    const { html, tool } = render(6000);
    expect(html).toContain('data-in-band="false"');
    expect(html).toContain(`sim-spindle-T${tool}-chipfix`);
    expect(html).toMatch(/İlerlemeyi 1\.?800 mm\/dk yapın/);
  });
});
