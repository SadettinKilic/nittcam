import type { SimFile } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { withPendingRevision } from '../components/simulation/model';

const file = (name: string, revision: number): SimFile => ({
  name,
  lines: [
    '%',
    '(PROJE: Mutfak alt dolap 60)',
    `(REVİZYON: ${revision})`,
    '(POST: mach3 1.0.0 Mach3)',
    'G21 G90',
    `(REVİZYON: ${revision} body text is never touched)`,
  ],
});

describe('withPendingRevision (T262)', () => {
  it('shows the label instead of the stale revision in each file header only', () => {
    const files = [file('Mutfak_alt_dolap_60_S1.tap', 3), file('Mutfak_alt_dolap_60_S2.tap', 3)];
    const out = withPendingRevision(files, 3, 'kaydedilince');
    for (const f of out) {
      expect(f.lines[2]).toBe('(REVİZYON: kaydedilince)');
      expect(f.lines[5]).toBe('(REVİZYON: 3 body text is never touched)');
      expect(f.lines).toHaveLength(6);
    }
    expect(files[0]?.lines[2]).toBe('(REVİZYON: 3)');
  });

  it('matches the whole number only', () => {
    const out = withPendingRevision([file('a.tap', 12)], 1, 'kaydedilince');
    expect(out[0]?.lines[2]).toBe('(REVİZYON: 12)');
  });

  it('leaves a file without the header line as it is', () => {
    const f: SimFile = { name: 'x.tap', lines: ['G0 X0'] };
    expect(withPendingRevision([f], 0, 'kaydedilince')[0]).toBe(f);
  });
});

describe('withPendingRevision on an ASCII-only post (T262)', () => {
  it('keeps the transliterated word', () => {
    const f: SimFile = { name: 'a.tap', lines: ['(PROJE: Mutfak)', '(REVIZYON: 0)'] };
    expect(withPendingRevision([f], 0, 'kaydedilince')[0]?.lines[1]).toBe(
      '(REVIZYON: kaydedilince)',
    );
  });
});
