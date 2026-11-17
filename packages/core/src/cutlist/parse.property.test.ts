/**
 * Property tests (T011): random cut lists serialised the way Excel or a CSV export writes them
 * (tab / semicolon / comma, Turkish decimal comma with or without thousands dots, quoted cells,
 * Turkish or English headers in any column order) parse back to the same values.
 * T011b: per-edge band columns (named edges and U1/U2/K1/K2) are part of the round trip; the
 * expected edges are computed here independently of the parser (D-024).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCutList, type CutListField, type CutListRowValues } from './index';

type Field = Exclude<CutListField, 'ignore'>;

interface Format {
  delimiter: '\t' | ';' | ',';
  decimal: 'comma' | 'dot';
  grouping: boolean;
}

const formatArb: fc.Arbitrary<Format> = fc.oneof(
  fc.record({
    delimiter: fc.constant('\t' as const),
    decimal: fc.constant('comma' as const),
    grouping: fc.boolean(),
  }),
  fc.record({
    delimiter: fc.constant(';' as const),
    decimal: fc.constant('comma' as const),
    grouping: fc.boolean(),
  }),
  fc.record({
    delimiter: fc.constant(',' as const),
    decimal: fc.constant('comma' as const),
    grouping: fc.boolean(),
  }),
  fc.record({
    delimiter: fc.constant(',' as const),
    decimal: fc.constant('dot' as const),
    grouping: fc.constant(false),
  }),
);

/** Formats a number the way a Turkish (or English) spreadsheet shows it. */
function formatNumber(value: number, f: Format): string {
  const [int = '0', frac] = String(value).split('.');
  const groupSep = f.decimal === 'comma' ? '.' : ',';
  const grouped = f.grouping ? int.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep) : int;
  if (frac === undefined) return grouped;
  return `${grouped}${f.decimal === 'comma' ? ',' : '.'}${frac}`;
}

/** Quotes a cell when it holds the delimiter, a quote or a line break (as Excel does). */
function quote(cell: string, delimiter: string): string {
  return cell.includes(delimiter) || /["\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

const letter = fc.constantFrom(...'abcçdefgğhıijklmnoöprsştuüvyzABCÇDEFGĞHIİKLMNOÖPRSŞTUÜVYZ');
/**
 * Name characters. A tab or semicolon appears only where a real export would quote it or where
 * it cannot be taken for the delimiter (an unquoted tab in a comma CSV is not something Excel or
 * a CSV writer produces; see detectDelimiter).
 */
function nameCharFor(delimiter: string): fc.Arbitrary<string> {
  const extra = delimiter === ',' ? [] : delimiter === ';' ? [';'] : [';', '\t'];
  return fc.oneof(letter, fc.constantFrom(' ', '0', '7', ',', '"', '\n', '-', '.', ...extra));
}

function nameArbFor(delimiter: string): fc.Arbitrary<string> {
  return fc
    .tuple(letter, fc.array(nameCharFor(delimiter), { maxLength: 12 }))
    .map(([first, rest]) => (first + rest.join('')).trimEnd());
}

const mmArb = fc.integer({ min: 1, max: 300_000 }).map((n) => n / 100);

const bandArb = fc.constantFrom(0, 0.4, 0.8, 1, 2);

type PerEdgeField = Exclude<Field, 'name' | 'w' | 'h' | 'qty' | 'grain' | 'edge'>;
const NAMED_EDGES = {
  edgeTop: 'top',
  edgeBottom: 'bottom',
  edgeLeft: 'left',
  edgeRight: 'right',
} as const;
const LONG_SHORT = ['edgeLong1', 'edgeLong2', 'edgeShort1', 'edgeShort2'] as const;
const PER_EDGE: readonly PerEdgeField[] = [
  ...(Object.keys(NAMED_EDGES) as (keyof typeof NAMED_EDGES)[]),
  ...LONG_SHORT,
];

function rowArbFor(delimiter: string) {
  return fc.record({
    name: nameArbFor(delimiter),
    w: mmArb,
    h: mmArb,
    qty: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
    grainLock: fc.boolean(),
    edgeBand: bandArb,
    // One value per per-edge column; null = empty cell (→ 0).
    edges: fc.record({
      edgeTop: fc.option(bandArb, { nil: null }),
      edgeBottom: fc.option(bandArb, { nil: null }),
      edgeLeft: fc.option(bandArb, { nil: null }),
      edgeRight: fc.option(bandArb, { nil: null }),
      edgeLong1: fc.option(bandArb, { nil: null }),
      edgeLong2: fc.option(bandArb, { nil: null }),
      edgeShort1: fc.option(bandArb, { nil: null }),
      edgeShort2: fc.option(bandArb, { nil: null }),
    }),
  });
}
type GenRow = ReturnType<typeof rowArbFor> extends fc.Arbitrary<infer T> ? T : never;

const GRAIN_WORDS: readonly [string, string][] = [
  ['evet', 'hayır'],
  ['1', '0'],
  ['x', ''],
  ['yes', 'no'],
  ['Var', 'Yok'],
];

const HEADERS: Record<Field, readonly string[]> = {
  name: ['Ad', 'İsim', 'Parça', 'Parça adı', 'Name', 'Part'],
  w: ['En', 'Genişlik', 'Genişlik (mm)', 'Width', 'W'],
  h: ['Boy', 'Yükseklik', 'Boy (mm)', 'Height', 'Length'],
  qty: ['Adet', 'Miktar', 'Qty', 'Quantity'],
  grain: ['Damar', 'Damar yönü', 'Grain'],
  edge: ['Bant', 'Kenar bandı', 'Edge band'],
  edgeTop: ['Üst bant', 'Üst', 'ÜST', 'Top'],
  edgeBottom: ['Alt bant', 'Alt', 'Bottom'],
  edgeLeft: ['Sol bant', 'Sol', 'Left'],
  edgeRight: ['Sağ bant', 'Sağ', 'Sag', 'Right'],
  edgeLong1: ['Uzun1', 'Uzun 1', 'U1'],
  edgeLong2: ['Uzun2', 'Uzun 2', 'U2'],
  edgeShort1: ['Kısa1', 'Kısa 1', 'K1'],
  edgeShort2: ['Kısa2', 'KISA 2', 'K2'],
};

const layoutArb = fc
  .tuple(
    fc.subarray(['name', 'qty', 'grain', 'edge', ...PER_EDGE] as Field[]),
    fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 14, maxLength: 14 }),
  )
  .map(([optional, keys]) => {
    const fields: Field[] = ['w', 'h', ...optional];
    return fields
      .map((f, i) => ({ f, k: keys[i] ?? 0 }))
      .sort((a, b) => a.k - b.k)
      .map(({ f }) => f);
  });

function cellOf(field: Field, row: GenRow, f: Format, grainWords: [string, string]): string {
  switch (field) {
    case 'name':
      return row.name;
    case 'w':
      return formatNumber(row.w, f);
    case 'h':
      return formatNumber(row.h, f);
    case 'qty':
      return row.qty === null ? '' : String(row.qty);
    case 'grain':
      return row.grainLock ? grainWords[0] : grainWords[1];
    case 'edge':
      return formatNumber(row.edgeBand, f);
    default: {
      const v = row.edges[field];
      return v === null ? '' : formatNumber(v, f);
    }
  }
}

function serialise(lines: readonly (readonly string[])[], delimiter: string, eol: string): string {
  return lines.map((cells) => cells.map((c) => quote(c, delimiter)).join(delimiter)).join(eol);
}

function expected(row: GenRow, fields: readonly Field[]): CutListRowValues {
  return {
    name: fields.includes('name') ? row.name : '',
    w: row.w,
    h: row.h,
    qty: fields.includes('qty') ? (row.qty ?? 1) : 1,
    grainLock: fields.includes('grain') ? row.grainLock : false,
    edgeBand: expectedBand(row, fields),
  };
}

/** Independent statement of D-024: per-edge columns win; U/K follow the orientation. */
function expectedBand(row: GenRow, fields: readonly Field[]): CutListRowValues['edgeBand'] {
  const perEdge = fields.some((f) => (PER_EDGE as readonly Field[]).includes(f));
  const single = fields.includes('edge') && !perEdge ? row.edgeBand : 0;
  const out = { top: single, right: single, bottom: single, left: single };
  const landscape = row.w >= row.h; // a square counts w as the long side
  const longShort = {
    edgeLong1: landscape ? 'bottom' : 'left',
    edgeLong2: landscape ? 'top' : 'right',
    edgeShort1: landscape ? 'left' : 'bottom',
    edgeShort2: landscape ? 'right' : 'top',
  } as const;
  for (const f of LONG_SHORT) if (fields.includes(f)) out[longShort[f]] = row.edges[f] ?? 0;
  for (const [f, side] of Object.entries(NAMED_EDGES) as [keyof typeof NAMED_EDGES, 'top'][]) {
    if (fields.includes(f)) out[side] = row.edges[f] ?? 0;
  }
  return out;
}

describe('cut-list round trip (fast-check)', () => {
  it('header (TR/EN, any column order): parse(serialise(rows)) gives the same values', () => {
    fc.assert(
      fc.property(
        formatArb.chain((f) =>
          fc.tuple(
            fc.constant(f),
            fc.array(rowArbFor(f.delimiter), { minLength: 1, maxLength: 12 }),
          ),
        ),
        layoutArb,
        fc.nat(),
        fc.constantFrom('\n', '\r\n'),
        fc.constantFrom(...GRAIN_WORDS),
        ([format, rows], fields, headerSeed, eol, grainWords) => {
          const header = fields.map((f, i) => {
            const names = HEADERS[f];
            return names[(headerSeed + i) % names.length] as string;
          });
          const body = rows.map((r) => fields.map((f) => cellOf(f, r, format, grainWords)));
          const text = serialise([header, ...body], format.delimiter, eol);

          const result = parseCutList(text);
          expect(result.delimiter).toBe(format.delimiter);
          expect(result.hasHeader).toBe(true);
          expect(result.columns.fields).toEqual(fields);
          expect(result.rows.map((r) => r.errors)).toEqual(rows.map(() => []));
          expect(result.rows.map((r) => r.values)).toEqual(rows.map((r) => expected(r, fields)));
          const named = fields.some((f) => f in NAMED_EDGES);
          const ls = fields.some((f) => (LONG_SHORT as readonly Field[]).includes(f));
          const edgeWarnings = result.warnings
            .map((w) => w.code)
            .filter((c) => c.startsWith('EDGE_BAND'));
          expect(edgeWarnings).toEqual([
            ...(fields.includes('edge') && (named || ls) ? ['EDGE_BAND_CONFLICT'] : []),
            ...(named && ls ? ['EDGE_BAND_MIXED'] : []),
          ]);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('no header (name, w, h, qty): position guess gives the same values', () => {
    const plainName = (delimiter: string) =>
      fc
        .tuple(
          fc.array(letter, { minLength: 1, maxLength: 8 }),
          fc.array(nameCharFor(delimiter), { maxLength: 6 }),
        )
        .map(([a, b]) => `P${a.join('')}${b.join('')}`.trimEnd());
    fc.assert(
      fc.property(
        formatArb.chain((f) =>
          fc.tuple(
            fc.constant(f),
            fc.array(
              fc.record({
                name: plainName(f.delimiter),
                w: mmArb,
                h: mmArb,
                qty: fc.integer({ min: 1, max: 50 }),
              }),
              { minLength: 1, maxLength: 12 },
            ),
          ),
        ),
        ([format, rows]) => {
          const body = rows.map((r) => [
            r.name,
            formatNumber(r.w, format),
            formatNumber(r.h, format),
            String(r.qty),
          ]);
          const result = parseCutList(serialise(body, format.delimiter, '\n'));
          expect(result.hasHeader).toBe(false);
          expect(result.columns).toEqual({
            fields: ['name', 'w', 'h', 'qty'],
            source: 'position',
            confidence: 'high',
          });
          expect(result.rows.map((r) => r.values)).toEqual(
            rows.map((r) => ({
              ...r,
              grainLock: false,
              edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
            })),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('the parser never throws and every row has a value object', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const result = parseCutList(text);
        for (const row of result.rows) {
          expect(row.cells).toHaveLength(result.columnCount);
          if (row.errors.length === 0) {
            expect(row.values.w).toBeGreaterThan(0);
            expect(row.values.h).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
