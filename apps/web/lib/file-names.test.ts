import { describe, expect, it } from 'vitest';
import { asciiStem, documentKind, exportFileName, ncNameOptions } from './file-names';

describe('one file-name pattern (T295)', () => {
  it('`<project>_r<revision>_<kind>.<ext>` for every document kind', () => {
    const kinds = (['dxf-dizilim', 'dxf-parcalar', 'pdf-a4', 'pdf-a3', 'etiket'] as const).map(
      (t) => exportFileName('Mutfak dolabı', 3, documentKind(t), 'x'),
    );
    expect(kinds).toEqual([
      'Mutfak_dolabi_r3_dizilim.x',
      'Mutfak_dolabi_r3_parcalar.x',
      'Mutfak_dolabi_r3_a4.x',
      'Mutfak_dolabi_r3_a3.x',
      'Mutfak_dolabi_r3_etiket.x',
    ]);
  });

  it('ASCII only, no doubled or trailing separator, fallback name', () => {
    expect(asciiStem(' Şişli -- İş / ğüöç! ')).toBe('Sisli_Is_guoc');
    expect(asciiStem('✓✓')).toBe('proje');
    expect(asciiStem(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59));
    expect(exportFileName('Çocuk odası', 1, 'nc', 'zip')).toMatch(/^[A-Za-z0-9_.]+$/);
  });

  it('NC options: same project part, revision in the name, real name in the header', () => {
    expect(ncNameOptions('Mutfak dolabı', 2)).toEqual({
      projectName: 'Mutfak dolabı',
      revision: 2,
      fileStem: 'Mutfak_dolabi',
      revisionInFileName: true,
    });
  });
});
