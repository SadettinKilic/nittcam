/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T395 (CTO #14 M3): UI texts never show internal task or decision ids ("T358", "D-130").
const DIR = join(dirname(fileURLToPath(import.meta.url)), '../messages');

function strings(v: unknown, path: string, out: [string, string][]): [string, string][] {
  if (typeof v === 'string') out.push([path, v]);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
  return out;
}

describe('translation files carry no task ids (T395)', () => {
  for (const file of ['tr.json', 'tr-error.json']) {
    it(file, () => {
      const all = strings(JSON.parse(readFileSync(join(DIR, file), 'utf8')), '', []);
      expect(all.length).toBeGreaterThan(0);
      const bad = all.filter(([, s]) => /\b(T\d{3}|D-\d{3}|MB\d)\b/.test(s));
      expect(bad).toEqual([]);
    });
  }
});

// T398 (CTO #14 P10): no research hedges in the UI; say what the user should do instead
// ("Başlangıç değeri; deneme kesimiyle ayarlayın").
describe('translation files carry no research hedges (T398)', () => {
  it('tr.json', () => {
    const all = strings(JSON.parse(readFileSync(join(DIR, 'tr.json'), 'utf8')), '', []);
    expect(all.filter(([, s]) => /doğrulanacak/i.test(s))).toEqual([]);
  });
});
