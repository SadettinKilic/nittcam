import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Part } from '../schema';
import { cutListToCsv } from './export';
import { cutListToParts, parseCutList } from './parse';

/** B7 tester (T120): CSV export edge cases beyond the dev round-trip property. */

function rect(id: string, name: string, over: Partial<Extract<Part, { kind: 'rect' }>> = {}): Part {
  return {
    id,
    name,
    qty: 1,
    grain: { mode: 'free', angle: 0 },
    kind: 'rect',
    params: { w: 600, h: 400, r: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
    ...over,
  };
}

function names(text: string) {
  const r = parseCutList(text);
  expect(r.rows.flatMap((x) => x.errors)).toEqual([]);
  return cutListToParts(
    r.rows,
    r.rows.map((_, i) => `n${i}`),
    'mm',
  ).map((p) => [p.name, p.note ?? '']);
}

describe('cutListToCsv edge cases (B7 tester)', () => {
  it('names and notes with a line break, a tab, quotes and Turkish letters survive the round trip', () => {
    const parts = [
      rect('a', 'Üst\nkapak', { note: 'iki\tsekme' }),
      rect('b', 'Çekmece "ön"', { note: 'ĞÜŞİÖÇ ğüşıöç' }),
      rect('c', ' Boşluklu ', { note: 'a;b' }),
    ];
    const got = names(cutListToCsv(parts).text);
    expect(got[1]).toEqual(['Çekmece "ön"', 'ĞÜŞİÖÇ ğüşıöç']);
    expect(got[2]?.[1]).toBe('a;b');
    // A line break or tab in a name may be normalised to a space, but the row must not split.
    expect(got).toHaveLength(3);
  });

  it('small parts (< 100 mm) export with an mm header, so re-import does not ask for the unit', () => {
    const text = cutListToCsv([rect('a', 'Kama', { params: { w: 40, h: 25.5, r: 0 } })]).text;
    expect(parseCutList(text).unitAmbiguous).toBe(false);
  });

  it('an empty list exports only the header and the BOM', () => {
    const csv = cutListToCsv([]);
    expect(csv.rows).toBe(0);
    expect(csv.text.split('\r\n').filter(Boolean)).toHaveLength(1);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
  });

  // BUG (B7 tester): names and notes starting with = + @ are written raw, Excel runs them as a
  // formula on open (OWASP CSV injection, spec §8.6). Flip to it() once the export escapes them.
  it('cells that Excel reads as a formula (= + - @) are not written raw (CSV injection)', () => {
    const text = cutListToCsv([
      rect('a', '=HYPERLINK("http://x","tıkla")'),
      rect('b', '@SUM(1)', { note: '+1+1' }),
    ]).text;
    const cells = text
      .split('\r\n')
      .slice(1)
      .filter(Boolean)
      .flatMap((l) => l.split(';'));
    for (const c of cells) expect(c.replace(/^"/, '')).not.toMatch(/^[=+@]/);
  });

  // Round 2: injection variants and the escape / unescape round trip.
  const FORMULA = ['=1+1', '+1', '-2+3', '@SUM(A1)', "'=1", "''+x", "=cmd|' /C calc'!A0"];

  /** The text each cell of the data rows starts with (quotes removed). */
  function cellStarts(text: string): string[] {
    const crlf = String.fromCharCode(13, 10);
    const body = text.replace(String.fromCharCode(0xfeff), '').split(crlf).slice(1).join(crlf);
    const out: string[] = [];
    let i = 0;
    while (i < body.length) {
      if (body[i] === '"') {
        let j = i + 1;
        while (j < body.length && !(body[j] === '"' && body[j + 1] !== '"'))
          j += body[j] === '"' ? 2 : 1;
        out.push(body.slice(i + 1, j));
        i = j + 2;
      } else {
        const m = /^[^;\r\n]*/.exec(body.slice(i))?.[0] ?? '';
        out.push(m);
        i += m.length + 1;
        if (body[i - 1] === '\r') i++;
      }
    }
    return out;
  }

  it('every formula start (= + - @ tab CR, after apostrophes too) is escaped in name and note', () => {
    const all = [...FORMULA, '\t=1', '\r=1'];
    const text = cutListToCsv(all.map((f, i) => rect(`r${i}`, f, { note: f }))).text;
    const starts = cellStarts(text);
    expect(starts.length).toBeGreaterThan(all.length * 2);
    for (const c of starts) expect(c, JSON.stringify(c)).not.toMatch(/^[=+\-@\t\r]/);
  });

  it('formula-like names and notes come back unchanged after export → import', () => {
    const parts = FORMULA.map((f, i) => rect(`r${i}`, f, { note: f }));
    expect(names(cutListToCsv(parts).text)).toEqual(parts.map((x) => [x.name, x.note]));
  });

  it('plain text and a plain leading apostrophe are written and read unchanged', () => {
    const parts = [
      rect('a', "'Ali'nin rafı"),
      rect('b', '12 raf'),
      rect('c', 'a=b', { note: 'x-1' }),
    ];
    const text = cutListToCsv(parts).text;
    expect(text).not.toContain("''Ali");
    expect(names(text)).toEqual([
      ["'Ali'nin rafı", ''],
      ['12 raf', ''],
      ['a=b', 'x-1'],
    ]);
  });

  it('property: a name / note with a formula start round-trips and is never written raw', () => {
    const txt = fc
      .tuple(fc.constantFrom('=', '+', '-', '@', "'=", "''-"), fc.string({ maxLength: 12 }))
      .map(([a, b]) => (a + [...b].filter((ch) => ch.charCodeAt(0) >= 32).join('')).trimEnd());
    fc.assert(
      fc.property(txt, txt, (name, note) => {
        const csv = cutListToCsv([rect('a', name, { note })]).text;
        for (const c of cellStarts(csv)) expect(c).not.toMatch(/^[=+\-@]/);
        expect(names(csv)).toEqual([[name, note]]);
      }),
      { numRuns: 300 },
    );
  });
});
