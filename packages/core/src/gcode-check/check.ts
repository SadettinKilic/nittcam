/**
 * Automatic G-code checks (spec §6.5, §7.2 rules 1–10; T019, D-027): the gate that decides whether
 * a generated file may be downloaded (rule 9). The text is read by the independent reader (T018,
 * strict mode) and the read program is judged; nothing from the post processor is used. Pure.
 */
import { readGcode, type GcodeEvent, type GcodeReadResult } from '../gcode-reader';
import { derive, type Derived } from './derive';
import { deepCuts, partHoldRule, type DeepCut } from './hold';
import { cutLoops, expectedLoopCount, matchLayout, matchModel, type CutLoop } from './match';
import { toSheetMoves, type SheetMove } from './path';
import { pocketMoveRule, pocketNotCutRule } from './pocket';
import { vGrooveMissingRule, vGrooveMoveRule } from './vgroove';
import {
  activeTools,
  floorRule,
  rampRule,
  backFaceHeaderRule,
  unverifiedMaterialHeaderRule,
  headerRule,
  modalRule,
  motionRules,
  readerFindings,
  toolRules,
  type Push,
} from './rules';
import type {
  ExpectedPart,
  GcodeCheckContext,
  GcodeCheckFile,
  GcodeCheckFilesContext,
  GcodeCheckFilesResult,
  GcodeCheckResult,
  GcodeCheckRule,
  GcodeCheckSummary,
  GcodeCheckViolation,
} from './types';

/** Reader codes never reported (known M codes of the reader). */
const READER_KNOWN_M = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30]);

function summarize(
  violations: readonly GcodeCheckViolation[],
  extra: Pick<GcodeCheckSummary, 'moves' | 'matchedOperations' | 'partsCut' | 'partsExpected'>,
): GcodeCheckSummary {
  const byRule: Partial<Record<GcodeCheckRule, number>> = {};
  for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
  return {
    errors: violations.filter((v) => v.severity === 'error').length,
    warnings: violations.filter((v) => v.severity === 'warning').length,
    byRule,
    ...extra,
  };
}

function collector(): { violations: GcodeCheckViolation[]; push: Push } {
  const violations: GcodeCheckViolation[] = [];
  const seen = new Set<string>();
  const push: Push = (rule, code, line, message, severity = 'error') => {
    // One report per rule and code: the first occurrence (later ones follow from it).
    const key = `${rule}/${code}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ rule, code, severity, line, message });
  };
  return { violations, push };
}

interface Analysis {
  violations: GcodeCheckViolation[];
  push: Push;
  consumed: number;
  matched: boolean;
  loops: CutLoop[];
  moves: number;
  /** The read path and events (sheet frame), for the layout-level pocket rule (T325). */
  sm: SheetMove[];
  events: readonly GcodeEvent[];
  /** B62 fix r1: the active tool of every read move (null = unknown). */
  tools: (number | null)[];
  /** T354: fold-line samples covered by V-bit cuts at depth, per groove key. */
  grooves: Map<string, Set<number>>;
}

function read(text: string, d: Derived): GcodeReadResult {
  const extra = d.vacuum
    ? [d.vacuum.on, d.vacuum.off].filter((c) => c >= 0 && !READER_KNOWN_M.has(c))
    : [];
  return readGcode(text, {
    strict: true,
    dwellUnit: d.ctx.post?.dwell?.unit ?? 's',
    extraMCodes: extra,
  });
}

/** All rules on one file. `prefix`: the file may end early at an operation boundary (split). */
function analyse(
  text: string,
  d: Derived,
  prefix: boolean,
  expected: readonly ExpectedPart[] | null | undefined = null,
): Analysis {
  const { violations, push } = collector();
  const r = read(text, d);
  readerFindings(r, push);
  headerRule(text, d, push);
  backFaceHeaderRule(text, d, push);
  unverifiedMaterialHeaderRule(text, d, push);
  modalRule(r, d, push);
  const sm = toSheetMoves(r.moves, d.frame, r.events);
  // B62 fix r1: the active tool comes from this file's own operations (a split or per-tool file
  // consumes a prefix of the remaining ones); a silent first match finds them.
  const pre = matchModel(sm, d.ops, d, prefix, () => undefined);
  const fileOps = pre.ok ? d.ops.slice(0, pre.consumed) : d.ops;
  motionRules(r, sm, d, push, fileOps);
  const tools = activeTools(r, sm, d, fileOps);
  floorRule(sm, d, push);
  rampRule(sm, d, push);
  const m = matchModel(sm, d.ops, d, prefix, push);
  const rawLines = text.split(/\r\n|\r|\n/);
  toolRules(r, rawLines, m.ok ? d.ops.slice(0, m.consumed) : d.ops, d, push);
  const loops = cutLoops(sm, d, push);
  // T354: rule 17 (depth floor from stock + traits, V-bit only, fold-line coverage).
  const grooves = vGrooveMoveRule(sm, expected, d, push, tools);
  return {
    grooves,
    violations,
    push,
    consumed: m.consumed,
    matched: m.ok,
    loops,
    moves: r.moves.length,
    sm,
    events: r.events,
    tools,
  };
}

function inputFailure(violations: GcodeCheckViolation[]): GcodeCheckResult {
  return {
    ok: false,
    violations,
    summary: summarize(violations, {
      moves: 0,
      matchedOperations: 0,
      partsCut: 0,
      partsExpected: null,
    }),
  };
}

function finish(
  a: Analysis,
  layout: readonly ExpectedPart[] | null | undefined,
  d: Derived,
): GcodeCheckResult {
  if (layout) {
    matchLayout(a.loops, layout, d, a.push);
    // T338 (D-129): tabs that hold, from the read material
    partHoldRule(layout, deepCuts(a.sm, a.tools, d), d, a.push);
    pocketNotCutRule(layout, pocketMoveRule(a.sm, a.events, layout, d, a.push, a.tools), a.push);
    vGrooveMissingRule(layout, a.grooves, d, a.push);
  }
  const ok = !a.violations.some((v) => v.severity === 'error');
  return {
    ok,
    violations: a.violations,
    summary: summarize(a.violations, {
      moves: a.moves,
      matchedOperations: a.consumed,
      partsCut: a.loops.length,
      partsExpected: layout ? expectedLoopCount(layout) : null,
    }),
  };
}

/**
 * Checks one G-code program against its context: §7.2 rules 1–10, the tool changes, the read
 * path against the toolpath model (every expected operation, in order) and, when `layout` is
 * given, the parts cut against the layout. `ok` is false on any error-severity violation.
 */
export function checkGcode(text: string, context: GcodeCheckContext): GcodeCheckResult {
  const dr = derive(context);
  if (!dr.ok) return inputFailure(dr.violations);
  if (typeof text !== 'string') {
    return inputFailure([
      {
        rule: 'INPUT',
        code: 'TEXT_MISSING',
        severity: 'error',
        line: 0,
        message: 'No G-code text.',
      },
    ]);
  }
  return finish(analyse(text, dr.d, false, context.layout), context.layout, dr.d);
}

/**
 * Checks every file of an export. Files of one sheet are taken in order and consume that sheet's
 * operations one after the other (a split program or one file per tool); the last file of a sheet
 * must finish them, and the layout is checked over all files of the sheet together.
 */
export function checkGcodeFiles(
  files: readonly GcodeCheckFile[],
  context: GcodeCheckFilesContext,
): GcodeCheckFilesResult {
  const out: GcodeCheckFilesResult['files'] = [];
  const all: GcodeCheckViolation[] = [];
  const sheets = [...new Set(files.map((f) => f.sheet))];
  const expectedSheets = new Set(context.toolpath?.operations.map((o) => o.sheet) ?? []);
  // B62 fix r1 (audit): a sheet of the expected layout with parts needs a program too, so a
  // toolpath that silently drops a whole sheet cannot pass.
  for (const [s, parts] of context.layout ?? []) if (parts.length > 0) expectedSheets.add(s);
  for (const s of expectedSheets) {
    if (!sheets.includes(s)) {
      all.push({
        rule: 'LAYOUT',
        code: 'SHEET_MISSING',
        severity: 'error',
        line: 0,
        message: `No program for sheet ${s}.`,
      });
    }
  }
  if (files.length === 0) {
    all.push({
      rule: 'INPUT',
      code: 'NO_FILES',
      severity: 'error',
      line: 0,
      message: 'No files to check.',
    });
  }
  for (const sheet of sheets) {
    const group = files.filter((f) => f.sheet === sheet);
    const sheetOps = context.toolpath?.operations.filter((o) => o.sheet === sheet) ?? [];
    let cursor = 0;
    const loops: CutLoop[] = [];
    const sheetLayout = context.layout?.get(sheet);
    const pocketsReached = new Set<string>();
    const groovesCovered = new Map<string, Set<number>>();
    const deep: DeepCut[] = [];
    let lastResult: { analysis: Analysis; d: Derived; index: number } | null = null;
    group.forEach((file, gi) => {
      const isLast = gi === group.length - 1;
      const own = context.sheetSizes?.get(sheet);
      const ctx: GcodeCheckContext = {
        ...context,
        ...(own
          ? {
              stock: {
                ...context.stock,
                sheetWidth: own.sheetWidth,
                sheetHeight: own.sheetHeight,
              },
            }
          : {}),
        sheet,
        operations: sheetOps.slice(cursor),
        layout: null,
      };
      const dr = derive(ctx);
      if (!dr.ok) {
        const res = inputFailure(dr.violations);
        out.push({ name: file.name, sheet, result: res });
        return;
      }
      const a = analyse(file.content, dr.d, !isLast, sheetLayout);
      for (const [k, set] of a.grooves) {
        const all = groovesCovered.get(k) ?? new Set<number>();
        for (const i of set) all.add(i);
        groovesCovered.set(k, all);
      }
      if (sheetLayout) {
        for (const k of pocketMoveRule(a.sm, a.events, sheetLayout, dr.d, a.push, a.tools)) {
          pocketsReached.add(k);
        }
      }
      cursor += a.consumed;
      loops.push(...a.loops);
      if (sheetLayout) deep.push(...deepCuts(a.sm, a.tools, dr.d));
      out.push({ name: file.name, sheet, result: finish(a, null, dr.d) });
      lastResult = { analysis: a, d: dr.d, index: out.length - 1 };
    });
    const layout = context.layout?.get(sheet);
    const lr = lastResult as { analysis: Analysis; d: Derived; index: number } | null;
    if (layout && lr) {
      const before = lr.analysis.violations.length;
      matchLayout(loops, layout, lr.d, lr.analysis.push);
      partHoldRule(layout, deep, lr.d, lr.analysis.push);
      pocketNotCutRule(layout, pocketsReached, lr.analysis.push);
      vGrooveMissingRule(layout, groovesCovered, lr.d, lr.analysis.push);
      const entry = out[lr.index];
      if (entry && lr.analysis.violations.length > before) {
        entry.result = finish(lr.analysis, null, lr.d);
      }
      if (entry) {
        entry.result.summary.partsExpected = expectedLoopCount(layout);
        entry.result.summary.partsCut = loops.length;
      }
    }
  }
  for (const f of out) for (const v of f.result.violations) all.push({ ...v, file: f.name });
  all.push(...fileNameViolations(files, context.profile.constraints.maxFileNameLength));
  return { ok: !all.some((v) => v.severity === 'error'), violations: all, files: out };
}

/** T021 gate (§7.2 rule 9): a file set may be downloaded only when every check passed. */
export function canDownload(result: GcodeCheckResult | GcodeCheckFilesResult): boolean {
  return result.ok && !result.violations.some((v) => v.severity === 'error');
}

/** Characters every controller reads in a file name (D-025: ASCII only). */
const SAFE_FILE_NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * T322 (usta 1: a 37-character name for a 32-character controller): every file name fits the
 * machine profile's `maxFileNameLength` and uses only ASCII letters, digits, `_`, `-` and `.`;
 * a name the controller cannot open (or opens truncated, colliding with another sheet) blocks the
 * download. Checked here independently of how the generator builds the names.
 */
export function fileNameViolations(
  files: readonly { name: string }[],
  maxLength: number,
): GcodeCheckViolation[] {
  const out: GcodeCheckViolation[] = [];
  for (const f of files) {
    if (f.name.length > maxLength) {
      out.push({
        rule: 'INPUT',
        code: 'FILE_NAME_TOO_LONG',
        severity: 'error',
        line: 0,
        file: f.name,
        message: `File name "${f.name}" has ${f.name.length} characters; the machine reads at most ${maxLength}.`,
      });
    }
    if (!SAFE_FILE_NAME.test(f.name)) {
      out.push({
        rule: 'INPUT',
        code: 'FILE_NAME_CHARS',
        severity: 'error',
        line: 0,
        file: f.name,
        message: `File name "${f.name}" has characters other than A-Z, a-z, 0-9, "_", "-" and ".".`,
      });
    }
  }
  const seen = new Set<string>();
  for (const f of files) {
    const key = f.name.toLowerCase();
    if (seen.has(key)) {
      out.push({
        rule: 'INPUT',
        code: 'FILE_NAME_DUPLICATE',
        severity: 'error',
        line: 0,
        file: f.name,
        message: `File name "${f.name}" is used twice.`,
      });
    }
    seen.add(key);
  }
  return out;
}
