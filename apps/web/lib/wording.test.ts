import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';

/** Every string value of a nested message object, with its key path. */
function values(o: unknown, path = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[path, o]];
  if (o && typeof o === 'object') {
    return Object.entries(o).flatMap(([k, v]) => values(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe('UI wording (T194a)', () => {
  it('says "dışa aktarma", never the English "export", in Turkish text', () => {
    const offenders = values(tr).filter(([, v]) => /export/i.test(v));
    expect(offenders).toEqual([]);
  });

  it('names new projects "Adsız proje" (no date-time string)', () => {
    expect(tr.wizard.defaultName).toBe('Adsız proje');
  });
});
