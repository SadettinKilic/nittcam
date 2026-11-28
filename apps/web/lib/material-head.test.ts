import { describe, expect, it } from 'vitest';
import { getMessages } from './messages';
import { materialHeadName } from './material-head';
import { materialText } from './server/pdf/project-pdf';

const m = getMessages();
const name = (material: string, props?: Parameters<typeof materialHeadName>[3]) =>
  materialHeadName(m.materials, m.materialHead, material, props);

describe('material header names (T350)', () => {
  it('aluminium with an alloy, ACM as composite panel, wood unchanged', () => {
    expect(name('aluminium', { alloy: '5754' })).toBe('Alüminyum 5754');
    expect(name('aluminium')).toBe(m.materials.aluminium);
    expect(name('acm', { colorCode: 'RAL 9006' })).toBe('Kompozit panel');
    expect(name('mdf')).toBe('MDF');
    expect(name('oak-veneer')).toBe('oak-veneer (tanınmayan malzeme)');
  });

  it('PDF header text', () => {
    expect(materialText('aluminium', 3, { alloy: '5754' })).toBe('Alüminyum 5754, 3 mm');
    expect(materialText('acm', 4)).toBe('Kompozit panel, 4 mm');
    expect(materialText('mdf', 18)).toBe('MDF, 18 mm');
  });
});
