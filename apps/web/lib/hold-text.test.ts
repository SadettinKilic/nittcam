import { describe, expect, it } from 'vitest';
import { issueMessage } from '../app/makineler/issues';
import { codeText } from '../components/simulation/violations';
import { holdTextValues } from './hold-text';
import { getMessages } from './messages';

const m = getMessages();

describe('MB4 texts from the traits', () => {
  it('wood keeps 3 / 1 / 0,2 mm; ACM and aluminium name their own bounds', () => {
    const mdf = codeText(m.simulation, 'TABS_TOO_SMALL', holdTextValues('mdf'));
    expect(mdf).toContain('genişlik en az 3 mm, yükseklik 1 mm ile kalınlık − 1 mm arası');
    const acm = codeText(m.simulation, 'TABS_TOO_SMALL', holdTextValues('acm'));
    expect(acm).toContain('yükseklik 0,5 mm ile kalınlık − 0,5 mm arası');
    const skin = codeText(
      m.simulation,
      'SMALL_PART_SKIN_OUT_OF_BOUNDS',
      holdTextValues('aluminium'),
    );
    expect(skin).toContain('kalınlık 0,1 mm ile kalınlık − 0,3 mm arası');
    expect(codeText(m.simulation, 'SMALL_PART_NOT_HELD', holdTextValues('mdf'))).toContain(
      'en az 2 köprüsü',
    );
    expect(codeText(m.simulation, 'TABS_NOT_HELD', holdTextValues('mdf'))).not.toContain('{');
  });

  it('profile issue texts carry their values (coolant M code, family limits)', () => {
    const t = m.machines.errors;
    expect(
      issueMessage(
        {
          path: 'coolant.on',
          code: 'custom',
          message: '',
          key: 'mCodeConflict',
          values: { code: 'M7' },
        },
        t,
      ),
    ).toContain('(M7)');
    expect(
      issueMessage(
        {
          path: 'materials[0].feed',
          code: 'custom',
          message: '',
          key: 'chipLoadOutsideBand',
          values: { value: 0.139, min: 0.04, max: 0.1 },
        },
        t,
      ),
    ).toContain('0,139 mm/diş; bu malzemede 0,04–0,1 mm/diş');
  });
});
