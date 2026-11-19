/**
 * Cut-list text parser (spec §4.1): rows copied from Excel or a CSV file → typed part rows with
 * per-cell errors. Pure: no I/O, clock or randomness. Nothing is converted silently: an unclear
 * unit (mm/cm) is only flagged (`unitAmbiguous`) and the caller asks the user.
 * Messages are English; the UI translates by `code`.
 */
import { MAX_IMPORT_ROWS } from '../commands/part';
import { EPS } from '../geometry/constants';

/**
 * What a source column holds. `ignore` = not imported.
 * Edge band: `edge` = one thickness for all four edges; `edgeTop/Bottom/Left/Right` = one named
 * edge; `edgeLong1/2`, `edgeShort1/2` = the workshop long/short convention (U1, U2, K1, K2),
 * mapped to edges by the part's orientation (`longShortEdges`, D-024).
 */
export type CutListField =
  | 'name'
  | 'w'
  | 'h'
  | 'qty'
  | 'grain'
  | 'grainAngle'
  | 'edge'
  | 'edgeTop'
  | 'edgeBottom'
  | 'edgeLeft'
  | 'edgeRight'
  | 'edgeLong1'
  | 'edgeLong2'
  | 'edgeShort1'
  | 'edgeShort2'
  | 'note'
  | 'ignore';

export const CUT_LIST_FIELDS: readonly CutListField[] = [
  'name',
  'w',
  'h',
  'qty',
  'grain',
  'edge',
  'edgeTop',
  'edgeBottom',
  'edgeLeft',
  'edgeRight',
  'edgeLong1',
  'edgeLong2',
  'edgeShort1',
  'edgeShort2',
  'grainAngle',
  'note',
  'ignore',
];

/** One edge of a rectangle part (D-010 `edgeBand` keys). */
export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';

/** Edge band thickness per edge in mm; 0 = none. Same shape as the part's `edgeBand`. */
export type EdgeBandValues = Record<EdgeSide, number>;

/** Per-edge fields that name one edge directly. */
export const EXPLICIT_EDGE_FIELDS = {
  edgeTop: 'top',
  edgeBottom: 'bottom',
  edgeLeft: 'left',
  edgeRight: 'right',
} as const satisfies Record<string, EdgeSide>;

export type ExplicitEdgeField = keyof typeof EXPLICIT_EDGE_FIELDS;
export type LongShortField = 'edgeLong1' | 'edgeLong2' | 'edgeShort1' | 'edgeShort2';

export const LONG_SHORT_FIELDS: readonly LongShortField[] = [
  'edgeLong1',
  'edgeLong2',
  'edgeShort1',
  'edgeShort2',
];

/**
 * Long/short edge convention → edges (D-024). Long edges are parallel to the longer dimension;
 * a square (w == h) counts w as the long side.
 * - w ≥ h: long edges are top and bottom: U1 → bottom, U2 → top, K1 → left, K2 → right.
 * - w < h: long edges are left and right: U1 → left, U2 → right, K1 → bottom, K2 → top.
 */
export function longShortEdges(w: number, h: number): Record<LongShortField, EdgeSide> {
  return w >= h
    ? { edgeLong1: 'bottom', edgeLong2: 'top', edgeShort1: 'left', edgeShort2: 'right' }
    : { edgeLong1: 'left', edgeLong2: 'right', edgeShort1: 'bottom', edgeShort2: 'top' };
}

/** True for the fields that set one edge (named or long/short), not the single `edge` column. */
export function isPerEdgeField(field: CutListField): boolean {
  return field in EXPLICIT_EDGE_FIELDS || (LONG_SHORT_FIELDS as readonly string[]).includes(field);
}

export type CutListDelimiter = '\t' | ';' | ',';
/** Decimal separator of the numbers in the table; the other one (or a space) groups thousands. */
export type DecimalSeparator = 'comma' | 'dot';
export type LengthUnit = 'mm' | 'cm';

export interface ParseCutListOptions {
  /** Force a delimiter; detected otherwise (tab, then semicolon, then comma). */
  delimiter?: CutListDelimiter | undefined;
  /** Force whether the first row is a header; detected otherwise. */
  hasHeader?: boolean | undefined;
  /** Manual column mapping (one field per source column), e.g. from the preview dropdowns. */
  columns?: readonly CutListField[] | undefined;
  /** Force the decimal separator; detected otherwise (Turkish comma when nothing tells). */
  decimal?: DecimalSeparator | undefined;
}

export interface CutListMapping {
  /** One field per source column. A field other than `ignore` appears at most once. */
  fields: CutListField[];
  /** Where the mapping came from. */
  source: 'header' | 'position' | 'manual';
  /** `low` = a guess the user should check (e.g. width/height missing or columns left over). */
  confidence: 'high' | 'low';
}

export type CutListErrorCode =
  | 'MISSING_COLUMN'
  | 'REQUIRED'
  | 'INVALID_NUMBER'
  | 'NOT_POSITIVE'
  | 'TOO_SMALL'
  | 'INVALID_QTY'
  | 'INVALID_GRAIN'
  | 'INVALID_GRAIN_ANGLE'
  | 'INVALID_EDGE_BAND';

export interface CutListCellError {
  /** Source column index; `null` when the problem is a missing column. */
  col: number | null;
  /** The field the error is about. */
  field: Exclude<CutListField, 'ignore'>;
  code: CutListErrorCode;
  message: string;
}

/** Parsed values of one row. A size is `null` when it is missing or invalid (see `errors`). */
export interface CutListRowValues {
  name: string;
  w: number | null;
  h: number | null;
  qty: number | null;
  grainLock: boolean;
  /** Grain angle in degrees [0, 180) from a "Damar açısı" column (T120); `null` = none. */
  grainAngle: number | null;
  /** Edge band thickness per edge in mm; 0 = none (D-024). */
  edgeBand: EdgeBandValues;
  /** Workshop note (T118 "Not" column); empty = none. */
  note: string;
}

export interface CutListRow {
  /** 1-based line in the pasted text where the row starts. */
  line: number;
  /** Trimmed source cells (padded to the column count). */
  cells: string[];
  values: CutListRowValues;
  errors: CutListCellError[];
}

export type CutListWarningCode =
  | 'EMPTY'
  | 'NO_DELIMITER'
  | 'MISSING_WIDTH_COLUMN'
  | 'MISSING_HEIGHT_COLUMN'
  | 'DUPLICATE_COLUMN'
  | 'THOUSANDS_ASSUMED'
  | 'MIXED_DECIMALS'
  | 'TOO_MANY_ROWS'
  | 'EDGE_BAND_CONFLICT'
  | 'EDGE_BAND_MIXED';

export interface CutListWarning {
  code: CutListWarningCode;
  message: string;
}

export interface CutListParseResult {
  /** `null` when no delimiter was found (every row is one cell). */
  delimiter: CutListDelimiter | null;
  decimal: DecimalSeparator;
  hasHeader: boolean;
  /** Header cells when `hasHeader`, else `null`. */
  header: string[] | null;
  columnCount: number;
  columns: CutListMapping;
  rows: CutListRow[];
  /** Unit named in the width/height header ("En (cm)"), if any. */
  headerUnit: LengthUnit | null;
  /** True when the sizes may be centimetres: ask the user; never convert silently. */
  unitAmbiguous: boolean;
  warnings: CutListWarning[];
}

// ---------------------------------------------------------------------------
// Splitting (quote-aware, RFC 4180 style; quoted cells may hold delimiters and newlines)
// ---------------------------------------------------------------------------

interface RawRecord {
  line: number;
  cells: string[];
}

function splitRecords(text: string, delimiter: string): RawRecord[] {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      cell = '';
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n') {
      cells.push(cell);
      records.push({ line: recordLine, cells });
      cells = [];
      cell = '';
      line += 1;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) {
    cells.push(cell);
    records.push({ line: recordLine, cells });
  }
  return records
    .map((r) => ({ line: r.line, cells: r.cells.map((c) => c.trim()) }))
    .filter((r) => r.cells.some((c) => c !== ''));
}

const DELIMITERS: readonly CutListDelimiter[] = ['\t', ';', ','];

/**
 * First delimiter in priority order (tab, semicolon, comma) that splits the rows consistently
 * (at least 80 % of the rows have the same column count > 1). Failing that, the first one that
 * splits at least half of the rows. A semicolon or tab inside a comma-CSV cell that is not quoted
 * can still win on a single row; the preview lets the user pick the delimiter.
 */
function detectDelimiter(text: string): CutListDelimiter | null {
  const stats = DELIMITERS.map((d) => {
    const records = splitRecords(text, d);
    const counts = new Map<number, number>();
    for (const r of records) counts.set(r.cells.length, (counts.get(r.cells.length) ?? 0) + 1);
    let modal = 0;
    for (const [len, n] of counts) if (len > 1 && n > modal) modal = n;
    const multi = records.filter((r) => r.cells.length > 1).length;
    return { d, total: records.length, modal, multi };
  });
  const consistent = stats.find((s) => s.total > 0 && s.modal * 5 >= s.total * 4);
  if (consistent) return consistent.d;
  return stats.find((s) => s.total > 0 && s.multi * 2 >= s.total)?.d ?? null;
}

// ---------------------------------------------------------------------------
// Numbers (Turkish decimal comma, thousands dots when unambiguous)
// ---------------------------------------------------------------------------

const RE_INT = /^-?\d+$/;
const RE_COMMA_DEC = /^-?\d*,\d+$/;
const RE_DOT_DEC = /^-?\d*\.\d+$/;
const RE_ONE_GROUP_DOT = /^-?\d{1,3}\.\d{3}$/;
const RE_ONE_GROUP_COMMA = /^-?\d{1,3},\d{3}$/;
const RE_TR_GROUPED_DEC = /^-?\d{1,3}(\.\d{3})+,\d+$/;
const RE_EN_GROUPED_DEC = /^-?\d{1,3}(,\d{3})+\.\d+$/;
const RE_DOT_GROUPS = /^-?\d{1,3}(\.\d{3}){2,}$/;
const RE_COMMA_GROUPS = /^-?\d{1,3}(,\d{3}){2,}$/;
const RE_SPACE_GROUPS = /^-?\d{1,3}([ \u00a0\u202f]\d{3})+([.,]\d+)?$/;

function unspace(raw: string): string | null {
  const s = raw.trim();
  if (!/[ \u00a0\u202f]/.test(s)) return s;
  return RE_SPACE_GROUPS.test(s) ? s.replace(/[ \u00a0\u202f]/g, '') : null;
}

/**
 * Removes the `'` that the CSV export puts before text a spreadsheet would read as a formula
 * (spec §8.6). A plain leading apostrophe ("'Ali") is kept.
 */
export function unescapeCsvText(text: string): string {
  return /^'+[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
}

/** Reads a number cell with the table's decimal separator; `null` when it is not a number. */
export function parseCutListNumber(raw: string, decimal: DecimalSeparator): number | null {
  const s = unspace(raw);
  if (s === null || s === '') return null;
  let normal: string;
  if (RE_INT.test(s)) normal = s;
  else if (RE_TR_GROUPED_DEC.test(s)) normal = s.replace(/\./g, '').replace(',', '.');
  else if (RE_EN_GROUPED_DEC.test(s)) normal = s.replace(/,/g, '');
  else if (RE_DOT_GROUPS.test(s)) normal = s.replace(/\./g, '');
  else if (RE_COMMA_GROUPS.test(s)) normal = s.replace(/,/g, '');
  else if (RE_COMMA_DEC.test(s)) {
    normal =
      decimal === 'dot' && RE_ONE_GROUP_COMMA.test(s) ? s.replace(',', '') : s.replace(',', '.');
  } else if (RE_DOT_DEC.test(s)) {
    normal = decimal === 'comma' && RE_ONE_GROUP_DOT.test(s) ? s.replace('.', '') : s;
  } else return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

interface DecimalEvidence {
  decimal: DecimalSeparator;
  mixed: boolean;
  thousandsAssumed: boolean;
}

function detectDecimal(cells: readonly string[]): DecimalEvidence {
  let comma = 0;
  let dot = 0;
  let ambiguousDot = 0;
  for (const raw of cells) {
    const s = unspace(raw);
    if (s === null) continue;
    if (RE_TR_GROUPED_DEC.test(s) || (RE_COMMA_DEC.test(s) && !RE_ONE_GROUP_COMMA.test(s))) {
      comma += 1;
    } else if (RE_EN_GROUPED_DEC.test(s) || (RE_DOT_DEC.test(s) && !RE_ONE_GROUP_DOT.test(s))) {
      dot += 1;
    } else if (RE_ONE_GROUP_DOT.test(s)) {
      ambiguousDot += 1;
    }
  }
  if (comma > 0 && dot > 0) {
    return { decimal: comma >= dot ? 'comma' : 'dot', mixed: true, thousandsAssumed: false };
  }
  if (dot > 0) return { decimal: 'dot', mixed: false, thousandsAssumed: false };
  // Comma evidence, or nothing at all: the Turkish convention (decimal comma, thousands dot).
  return { decimal: 'comma', mixed: false, thousandsAssumed: comma === 0 && ambiguousDot > 0 };
}

// ---------------------------------------------------------------------------
// Header names (Turkish and English)
// ---------------------------------------------------------------------------

/** Lower-cases with Turkish rules and folds Turkish letters to ASCII. */
function fold(text: string): string {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u');
}

/** "Üst", "Üst bant", "Üst kenar", "Üst kenar bandı", "Top", "Top band", "Top edge", ... */
function edgeNames(words: readonly string[]): string[] {
  return words.flatMap((w) => [
    w,
    `${w}bant`,
    `${w}bandi`,
    `${w}kenar`,
    `${w}kenarbandi`,
    `${w}band`,
    `${w}edge`,
    `${w}edgeband`,
  ]);
}

const HEADER_NAMES: Record<Exclude<CutListField, 'ignore'>, readonly string[]> = {
  name: [
    'ad',
    'adi',
    'isim',
    'parca',
    'parcaadi',
    'parcaismi',
    'name',
    'part',
    'partname',
    'aciklama',
    'description',
    'tanim',
  ],
  w: ['en', 'eni', 'genislik', 'width', 'w'],
  h: ['boy', 'boyu', 'yukseklik', 'height', 'length', 'uzunluk', 'h', 'l'],
  qty: ['adet', 'adt', 'qty', 'quantity', 'miktar', 'sayi', 'count', 'pcs'],
  grain: [
    'damar',
    'damaryonu',
    'damarkilidi',
    'damarkilit',
    'grain',
    'grainlock',
    'desen',
    'desenyonu',
  ],
  grainAngle: ['damaraci', 'damaracisi', 'graininangle', 'grainangle', 'damaraciderece'],
  note: ['not', 'notlar', 'note', 'notes', 'malzemenotu', 'malzeme', 'material', 'remark'],
  edge: ['bant', 'kenarbandi', 'kenarbant', 'bantkalinligi', 'edge', 'edgeband', 'band'],
  edgeTop: edgeNames(['ust', 'top']),
  edgeBottom: edgeNames(['alt', 'bottom']),
  edgeLeft: edgeNames(['sol', 'left']),
  edgeRight: edgeNames(['sag', 'right']),
  edgeLong1: ['uzun1', 'u1', 'uzunkenar1', 'uzunbant1', 'long1', 'longedge1'],
  edgeLong2: ['uzun2', 'u2', 'uzunkenar2', 'uzunbant2', 'long2', 'longedge2'],
  edgeShort1: ['kisa1', 'k1', 'kisakenar1', 'kisabant1', 'short1', 'shortedge1'],
  edgeShort2: ['kisa2', 'k2', 'kisakenar2', 'kisabant2', 'short2', 'shortedge2'],
};

const HEADER_LOOKUP = new Map<string, Exclude<CutListField, 'ignore'>>(
  (Object.entries(HEADER_NAMES) as [Exclude<CutListField, 'ignore'>, readonly string[]][]).flatMap(
    ([field, names]) => names.map((n) => [n, field] as const),
  ),
);

function headerUnitOf(cell: string): LengthUnit | null {
  const m = /(?:^|[^a-z])(mm|cm)(?:[^a-z]|$)/.exec(fold(cell));
  return m ? (m[1] as LengthUnit) : null;
}

/** The field a header cell names, or `null`. "En (mm)", "Parça adı", "QTY" all work. */
export function headerField(cell: string): Exclude<CutListField, 'ignore'> | null {
  const key = fold(cell)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/(?:^|[^a-z])(mm|cm)(?=[^a-z]|$)/g, ' ')
    .replace(/[^a-z0-9]/g, '');
  return HEADER_LOOKUP.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// Grain and edge band cells
// ---------------------------------------------------------------------------

const GRAIN_TRUE = new Set([
  '1',
  'evet',
  'e',
  'var',
  'x',
  'v',
  '✓',
  '✔',
  'yes',
  'y',
  'true',
  'kilitli',
  'kilit',
]);
const GRAIN_FALSE = new Set(['', '0', 'hayir', 'h', 'yok', 'no', 'n', 'false', '-']);

function parseGrain(cell: string): boolean | null {
  const k = fold(cell.trim());
  if (GRAIN_TRUE.has(k)) return true;
  if (GRAIN_FALSE.has(k)) return false;
  return null;
}

const EDGE_NONE = new Set(['', '-', '–', 'yok', 'no', 'none', 'hayir']);
/** Per-edge cells (D-024): only these unambiguous "no band" marks besides numbers. */
const PER_EDGE_NONE = new Set(['', '-', '–', 'yok']);

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

function dedupe(fields: CutListField[]): { fields: CutListField[]; duplicate: boolean } {
  const used = new Set<CutListField>();
  let duplicate = false;
  const out = fields.map((f) => {
    if (f === 'ignore') return f;
    if (used.has(f)) {
      duplicate = true;
      return 'ignore';
    }
    used.add(f);
    return f;
  });
  return { fields: out, duplicate };
}

function guessByPosition(
  rows: readonly RawRecord[],
  columnCount: number,
  decimal: DecimalSeparator,
): { fields: CutListField[]; confidence: 'high' | 'low' } {
  type Kind = 'empty' | 'number' | 'integer' | 'grain' | 'text';
  const kinds: Kind[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    const values = rows.map((r) => r.cells[c] ?? '').filter((v) => v !== '');
    if (values.length === 0) {
      kinds.push('empty');
      continue;
    }
    const numbers = values.map((v) => parseCutListNumber(v, decimal));
    const numeric = numbers.filter((n) => n !== null).length;
    if (numeric * 5 >= values.length * 4) {
      kinds.push(numbers.every((n) => n === null || Number.isInteger(n)) ? 'integer' : 'number');
    } else if (values.every((v) => parseGrain(v) !== null)) {
      kinds.push('grain');
    } else {
      kinds.push('text');
    }
  }
  const fields: CutListField[] = kinds.map(() => 'ignore');
  const nameCol = kinds.findIndex((k) => k === 'text');
  if (nameCol >= 0) fields[nameCol] = 'name';
  const numericCols = kinds.flatMap((k, i) => (k === 'number' || k === 'integer' ? [i] : []));
  const [wCol, hCol, qtyCol, ...rest] = numericCols;
  if (wCol !== undefined) fields[wCol] = 'w';
  if (hCol !== undefined) fields[hCol] = 'h';
  let leftover = rest.length;
  if (qtyCol !== undefined) {
    if (kinds[qtyCol] === 'integer') fields[qtyCol] = 'qty';
    else leftover += 1;
  }
  const grainCol = kinds.findIndex((k) => k === 'grain');
  if (grainCol >= 0) fields[grainCol] = 'grain';
  const otherText = kinds.filter((k, i) => k === 'text' && i !== nameCol).length;
  // The expected shape is (name?, w, h, qty?): sizes in order, nothing left over.
  const ordered = nameCol < 0 || wCol === undefined || nameCol < wCol;
  const confidence =
    wCol !== undefined && hCol !== undefined && leftover === 0 && otherText === 0 && ordered
      ? 'high'
      : 'low';
  return { fields, confidence };
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const MESSAGES: Record<CutListErrorCode, string> = {
  MISSING_COLUMN: 'no column is mapped to this field',
  REQUIRED: 'value is required',
  INVALID_NUMBER: 'not a number',
  NOT_POSITIVE: 'must be greater than zero',
  TOO_SMALL: `must be at least ${EPS} mm, the smallest part size`,
  INVALID_QTY: 'quantity must be a whole number of at least 1',
  INVALID_GRAIN: 'grain lock must be yes/no (evet/hayır, 1/0, x)',
  INVALID_GRAIN_ANGLE: 'grain angle must be degrees from 0 to below 180',
  INVALID_EDGE_BAND: 'edge band must be a thickness in mm (0 or more)',
};

const WARNINGS: Record<CutListWarningCode, string> = {
  EMPTY: 'nothing to import',
  NO_DELIMITER: 'no tab, semicolon or comma found; every row is one cell',
  MISSING_WIDTH_COLUMN: 'no column is mapped to width',
  MISSING_HEIGHT_COLUMN: 'no column is mapped to height',
  DUPLICATE_COLUMN: 'a field was mapped to more than one column; only the first is used',
  THOUSANDS_ASSUMED: 'numbers like 1.220 were read with a thousands dot (1220)',
  MIXED_DECIMALS: 'both decimal commas and decimal dots were found',
  TOO_MANY_ROWS: `more than ${MAX_IMPORT_ROWS} valid rows; import them in parts`,
  EDGE_BAND_CONFLICT:
    'a single edge band column and per-edge columns are both mapped; the per-edge columns win',
  EDGE_BAND_MIXED:
    'named-edge and long/short edge columns are both mapped; a named edge wins on the same edge',
};

function warning(code: CutListWarningCode): CutListWarning {
  return { code, message: WARNINGS[code] };
}

function error(
  col: number | null,
  field: Exclude<CutListField, 'ignore'>,
  code: CutListErrorCode,
): CutListCellError {
  return { col, field, code, message: MESSAGES[code] };
}

function isHeaderRow(cells: readonly string[], decimal: DecimalSeparator): boolean {
  const known = cells.filter((c) => headerField(c) !== null).length;
  const numbers = cells.filter((c) => parseCutListNumber(c, decimal) !== null).length;
  return known >= 2 || (known >= 1 && numbers === 0);
}

/**
 * Parses pasted cut-list text. Detects the delimiter (tab first, as Excel copies, then
 * semicolon, then comma), quoted cells, the decimal separator, an optional header row
 * (Turkish/English names) and the column mapping; options override each detection.
 * Never converts units: `unitAmbiguous` tells the caller to ask mm or cm.
 */
export function parseCutList(text: string, options: ParseCutListOptions = {}): CutListParseResult {
  const warnings: CutListWarning[] = [];
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const records = splitRecords(text, delimiter ?? '\t');
  if (records.length > 0 && delimiter === null) warnings.push(warning('NO_DELIMITER'));

  const allCells = records.flatMap((r) => r.cells);
  const evidence = detectDecimal(allCells);
  const decimal = options.decimal ?? evidence.decimal;
  if (options.decimal === undefined) {
    if (evidence.mixed) warnings.push(warning('MIXED_DECIMALS'));
    if (evidence.thousandsAssumed) warnings.push(warning('THOUSANDS_ASSUMED'));
  }

  const first = records[0];
  const hasHeader = first !== undefined && (options.hasHeader ?? isHeaderRow(first.cells, decimal));
  const header = hasHeader && first ? first.cells : null;
  const dataRecords = hasHeader ? records.slice(1) : records;
  const columnCount = records.reduce((m, r) => Math.max(m, r.cells.length), 0);

  let mapping: CutListMapping;
  if (options.columns !== undefined) {
    const raw = Array.from({ length: columnCount }, (_, i) => options.columns?.[i] ?? 'ignore');
    const { fields, duplicate } = dedupe(raw);
    if (duplicate) warnings.push(warning('DUPLICATE_COLUMN'));
    mapping = { fields, source: 'manual', confidence: 'high' };
  } else if (header) {
    const raw = Array.from(
      { length: columnCount },
      (_, i) => headerField(header[i] ?? '') ?? 'ignore',
    );
    const { fields } = dedupe(raw);
    const complete = fields.includes('w') && fields.includes('h');
    mapping = { fields, source: 'header', confidence: complete ? 'high' : 'low' };
  } else {
    const guess = guessByPosition(dataRecords, columnCount, decimal);
    mapping = { fields: guess.fields, source: 'position', confidence: guess.confidence };
  }

  const colOf = (field: CutListField): number | null => {
    const i = mapping.fields.indexOf(field);
    return i < 0 ? null : i;
  };
  const cols = {
    name: colOf('name'),
    w: colOf('w'),
    h: colOf('h'),
    qty: colOf('qty'),
    grain: colOf('grain'),
    edge: colOf('edge'),
    grainAngle: colOf('grainAngle'),
    note: colOf('note'),
  };
  const explicitCols = (Object.keys(EXPLICIT_EDGE_FIELDS) as ExplicitEdgeField[]).flatMap(
    (field) => {
      const col = colOf(field);
      return col === null ? [] : [{ field, side: EXPLICIT_EDGE_FIELDS[field], col }];
    },
  );
  const longShortCols = LONG_SHORT_FIELDS.flatMap((field) => {
    const col = colOf(field);
    return col === null ? [] : [{ field, col }];
  });
  const perEdge = explicitCols.length > 0 || longShortCols.length > 0;
  if (dataRecords.length > 0) {
    if (cols.w === null) warnings.push(warning('MISSING_WIDTH_COLUMN'));
    if (cols.h === null) warnings.push(warning('MISSING_HEIGHT_COLUMN'));
    if (perEdge && cols.edge !== null) warnings.push(warning('EDGE_BAND_CONFLICT'));
    if (explicitCols.length > 0 && longShortCols.length > 0) {
      warnings.push(warning('EDGE_BAND_MIXED'));
    }
  }

  const rows: CutListRow[] = dataRecords.map((record) => {
    const cells = Array.from({ length: columnCount }, (_, i) => record.cells[i] ?? '');
    const errors: CutListCellError[] = [];
    const cell = (col: number | null) => (col === null ? '' : (cells[col] ?? ''));

    const size = (field: 'w' | 'h'): number | null => {
      const col = cols[field];
      if (col === null) {
        errors.push(error(null, field, 'MISSING_COLUMN'));
        return null;
      }
      const raw = cell(col);
      if (raw === '') {
        errors.push(error(col, field, 'REQUIRED'));
        return null;
      }
      const n = parseCutListNumber(raw, decimal);
      if (n === null) {
        errors.push(error(col, field, 'INVALID_NUMBER'));
        return null;
      }
      if (n <= 0) {
        errors.push(error(col, field, 'NOT_POSITIVE'));
        return null;
      }
      // T267: a size below the smallest part size (EPS) is refused, never rounded up silently.
      if (n < EPS) {
        errors.push(error(col, field, 'TOO_SMALL'));
        return null;
      }
      return n;
    };
    const w = size('w');
    const h = size('h');

    let qty: number | null = 1;
    const qtyRaw = cell(cols.qty);
    if (qtyRaw !== '') {
      const n = parseCutListNumber(qtyRaw, decimal);
      if (n === null || !Number.isInteger(n) || n < 1) {
        errors.push(error(cols.qty, 'qty', 'INVALID_QTY'));
        qty = null;
      } else {
        qty = n;
      }
    }

    let grainLock = false;
    if (cols.grain !== null) {
      const g = parseGrain(cell(cols.grain));
      if (g === null) errors.push(error(cols.grain, 'grain', 'INVALID_GRAIN'));
      else grainLock = g;
    }

    let grainAngle: number | null = null;
    const angleRaw = cell(cols.grainAngle);
    if (angleRaw !== '' && angleRaw !== '-') {
      const n = parseCutListNumber(angleRaw.replace(/°$/, ''), decimal);
      if (n === null || n < 0 || n >= 180) {
        errors.push(error(cols.grainAngle, 'grainAngle', 'INVALID_GRAIN_ANGLE'));
      } else {
        grainAngle = n;
      }
    }

    const edgeBand: EdgeBandValues = { top: 0, right: 0, bottom: 0, left: 0 };
    if (!perEdge && cols.edge !== null) {
      // Single column (D-018): one thickness for all four edges; "yok", "-" and empty = none.
      // With per-edge columns mapped it is ignored entirely (EDGE_BAND_CONFLICT, D-024).
      const raw = cell(cols.edge);
      if (!EDGE_NONE.has(fold(raw))) {
        const n = parseCutListNumber(raw, decimal);
        if (n === null || n < 0) errors.push(error(cols.edge, 'edge', 'INVALID_EDGE_BAND'));
        else edgeBand.top = edgeBand.right = edgeBand.bottom = edgeBand.left = n;
      }
    }
    // Per-edge cells (D-024): numbers (mm); empty, "-", "–" and "yok" = 0; else a row error.
    const thickness = (col: number, field: Exclude<CutListField, 'ignore'>): number => {
      const raw = cell(col);
      if (PER_EDGE_NONE.has(fold(raw))) return 0;
      const n = parseCutListNumber(raw, decimal);
      if (n === null || n < 0) {
        errors.push(error(col, field, 'INVALID_EDGE_BAND'));
        return 0;
      }
      return n;
    };
    if (longShortCols.length > 0) {
      // Orientation from the parsed sizes (any unit: the ratio is the same). An invalid size
      // already makes the row invalid, so the fallback orientation never reaches the project.
      const sides = longShortEdges(w ?? 1, h ?? 1);
      for (const { field, col } of longShortCols) edgeBand[sides[field]] = thickness(col, field);
    }
    // Named edges last, so they win over a long/short column that lands on the same edge.
    for (const { field, side, col } of explicitCols) edgeBand[side] = thickness(col, field);

    return {
      line: record.line,
      cells,
      values: {
        name: unescapeCsvText(cell(cols.name)),
        w,
        h,
        qty,
        grainLock,
        grainAngle,
        edgeBand,
        note: unescapeCsvText(cell(cols.note)).slice(0, 200),
      },
      errors,
    };
  });

  if (rows.length === 0) warnings.push(warning('EMPTY'));
  const valid = rows.filter((r) => r.errors.length === 0);
  if (valid.length > MAX_IMPORT_ROWS) warnings.push(warning('TOO_MANY_ROWS'));

  const sizeHeaders = [cols.w, cols.h].flatMap((c) =>
    c !== null && header ? [header[c] ?? ''] : [],
  );
  const units = sizeHeaders.map(headerUnitOf).filter((u): u is LengthUnit => u !== null);
  const headerUnit: LengthUnit | null = units.includes('cm')
    ? 'cm'
    : units.includes('mm')
      ? 'mm'
      : null;
  const sizes = rows
    .flatMap((r) => [r.values.w, r.values.h])
    .filter((v): v is number => v !== null);
  const unitAmbiguous =
    headerUnit === 'cm' || (headerUnit === null && sizes.length > 0 && sizes.every((v) => v < 100));

  return {
    delimiter,
    decimal,
    hasHeader,
    header,
    columnCount,
    columns: mapping,
    rows,
    headerUnit,
    unitAmbiguous,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Rows → importCutList params
// ---------------------------------------------------------------------------

export interface CutListPartInput {
  id: string;
  name: string;
  qty: number;
  grainLock: boolean;
  /** Set when the list had a grain angle column (T120): the exact grain, not the lock alias. */
  grain?: { mode: 'free' | 'fixed'; angle: number };
  params: { w: number; h: number; r: number };
  edgeBand: { top: number; right: number; bottom: number; left: number };
  note?: string;
}

/** Sizes in `unit` → mm, rounded to 1 µm so 39.6 cm gives exactly 396 mm. */
export function toMillimetres(value: number, unit: LengthUnit): number {
  return unit === 'cm' ? Math.round(value * 10 * 1000) / 1000 : value;
}

/**
 * Builds `importCutList` params from the rows without errors. The caller supplies one id per
 * valid row (core has no randomness) and the unit the user confirmed; only width and height
 * are converted (edge band thickness is always in mm).
 */
export function cutListToParts(
  rows: readonly CutListRow[],
  ids: readonly string[],
  unit: LengthUnit,
): CutListPartInput[] {
  const valid = rows.filter((r) => r.errors.length === 0);
  if (ids.length < valid.length) {
    throw new Error(`cutListToParts: ${valid.length} ids needed, ${ids.length} given`);
  }
  return valid.map((row, i) => {
    const { name, w, h, qty, grainLock, grainAngle, edgeBand, note } = row.values;
    if (w === null || h === null || qty === null) throw new Error('cutListToParts: invalid row');
    return {
      id: ids[i] as string,
      name,
      qty,
      grainLock,
      params: { w: toMillimetres(w, unit), h: toMillimetres(h, unit), r: 0 },
      edgeBand: { ...edgeBand },
      ...(grainAngle !== null
        ? { grain: { mode: grainLock ? ('fixed' as const) : ('free' as const), angle: grainAngle } }
        : {}),
      ...(note !== '' ? { note } : {}),
    };
  });
}
