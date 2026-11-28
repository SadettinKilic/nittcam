/**
 * Simulation pipeline (spec §6.5, T020, D-028): `exportNc` (toolpath → G-code → automatic checks)
 * → the independent reader → playback steps in the sheet frame. Only a program that passed every
 * check is simulated; otherwise the export result (violations) is returned for the UI. Pure.
 */
import { exportNc, type ExportNcOptions, type ExportNcResult } from '../export';
import { checkFrame, type CheckFrame } from '../gcode-check';
import { readGcode, type GcodeReadResult } from '../gcode-reader';
import { machineFeedLimits, type MachineProfile } from '../machine';
import { parsePostConfig, type PostProfileVersion } from '../post';
import type { Project } from '../schema';
import { defaultSheet, sheetSizeOf } from '../schema';
import { buildToolpath } from '../toolpath';
import { buildSimSheet } from './build';
import type { SimMachineFrame, SimSheet, SimSummary } from './types';

/** Default rapid feed of the time estimate when the profile has none, mm/min (D-025). */
export const SIM_DEFAULT_RAPID_FEED = 10_000;

/** M codes the reader models itself; other vacuum codes are passed as `extraMCodes` (D-027). */
const READER_KNOWN_M = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30]);

export interface SimulateResult {
  /** True when the export passed and every file was read without errors. */
  ok: boolean;
  /** The export result without its file contents (they are in `sheets[].files`). */
  export: Omit<ExportNcResult, 'files'> & { fileNames: string[] };
  /** Reader errors of a file that passed the checks (should never happen; never simulated). */
  readErrors: { file: string; line: number; code: string; message: string }[];
  /** One entry per sheet with a program, in sheet order. Empty unless `ok`. */
  sheets: SimSheet[];
  summary: SimSummary | null;
  machine: SimMachineFrame | null;
}

function mNumber(code: string): number | null {
  const m = /^M(\d{1,3})$/i.exec(code.trim());
  return m ? Number(m[1]) : null;
}

/** Reader options the checks use (strict; dwell unit of the post; vacuum codes). */
function readerOptions(profile: MachineProfile, post: unknown) {
  const cfg = parsePostConfig(post);
  const dwellUnit = cfg.ok ? cfg.config.dwell.unit : 's';
  const vacuumOn = cfg.ok ? cfg.config.vacuum.enabled : true;
  const extra: number[] = [];
  if (vacuumOn && profile.holdDown.type === 'vacuum') {
    for (const c of [profile.holdDown.vacuumOn, profile.holdDown.vacuumOff]) {
      const n = mNumber(c);
      if (n !== null && !READER_KNOWN_M.has(n)) extra.push(n);
    }
  }
  return { strict: true, dwellUnit, extraMCodes: extra, snapshots: false } as const;
}

/** Table, travel and program zero of the profile, drawn in the sheet frame. */
export function simMachineFrame(profile: MachineProfile, frame: CheckFrame): SimMachineFrame {
  // Physical (right, back) of a point = sheet point + (sheetX, sheetY); program zero is physical 0.
  const zero = { x: -frame.sheetX, y: -frame.sheetY };
  const rect = (w: number, d: number) => {
    const x2 = zero.x + frame.intoX * w;
    const y2 = zero.y + frame.intoY * d;
    return {
      x: Math.min(zero.x, x2),
      y: Math.min(zero.y, y2),
      width: Math.abs(x2 - zero.x),
      height: Math.abs(y2 - zero.y),
    };
  };
  return {
    zero,
    xSign: frame.sx,
    ySign: frame.sy,
    table: rect(profile.table.width, profile.table.depth),
    envelope: rect(profile.workEnvelope.x, profile.workEnvelope.y),
  };
}

export function simulateProject(
  project: Project,
  profileVersion: PostProfileVersion,
  post: unknown,
  options: ExportNcOptions = {},
): SimulateResult {
  const profile = profileVersion.profile;
  const exported = exportNc(project, profileVersion, post, options);
  const { files, ...rest } = exported;
  const base = {
    export: { ...rest, fileNames: files.map((f) => f.name) },
    readErrors: [] as SimulateResult['readErrors'],
  };
  if (!exported.ok) return { ok: false, ...base, sheets: [], summary: null, machine: null };

  const stock = {
    thickness: project.stock.thickness,
    sheetWidth: defaultSheet(project).width,
    sheetHeight: defaultSheet(project).height,
  };
  const frame = checkFrame(profile, stock);
  // Each sheet is played back in its own frame: a right/back origin moves with the sheet size (T164).
  const frameOf = (sheet: number) => {
    if (!project.layout.sheets[sheet]?.size) return frame;
    const own = sheetSizeOf(project, sheet);
    return checkFrame(profile, { ...stock, sheetWidth: own.width, sheetHeight: own.height });
  };
  const opts = readerOptions(profile, post);
  const rapidFeed = profile.rapidFeed ?? SIM_DEFAULT_RAPID_FEED;
  const limits = machineFeedLimits(profile);
  const toolDiameters: Record<number, number> = {};
  for (const tool of profile.tools) toolDiameters[tool.number] = tool.diameter;
  const vBits: Record<number, { angleDeg: number; tipDiameter: number }> = {};
  for (const tool of profile.tools) {
    if (tool.type === 'vBit' && tool.angleDeg !== undefined) {
      vBits[tool.number] = { angleDeg: tool.angleDeg, tipDiameter: tool.tipDiameter ?? 0 };
    }
  }

  const bySheet = new Map<number, { name: string; content: string; read: GcodeReadResult }[]>();
  for (const f of files) {
    const read = readGcode(f.content, opts);
    for (const e of read.errors) {
      base.readErrors.push({ file: f.name, line: e.line, code: e.code, message: e.message });
    }
    const list = bySheet.get(f.sheet) ?? [];
    list.push({ name: f.name, content: f.content, read });
    bySheet.set(f.sheet, list);
  }
  if (base.readErrors.length > 0) {
    return { ok: false, ...base, sheets: [], summary: null, machine: null };
  }

  const sheets = [...bySheet.keys()]
    .sort((a, b) => a - b)
    .map((sheet) => {
      const own = frameOf(sheet);
      const sim = buildSimSheet({
        sheet,
        files: bySheet.get(sheet) ?? [],
        frame: own,
        rapidFeed,
        feedCap: { feed: limits.feed.max, plunge: limits.plungeFeed.max },
        toolDiameters,
        vBits,
      });
      return own === frame ? sim : { ...sim, machine: simMachineFrame(profile, own) };
    });

  // Pass and tab counts come from the toolpath the program was generated from (deterministic).
  const tp = buildToolpath(project, profile, options.toolpath ?? {});
  let passes = 0;
  let tabs = 0;
  for (const op of tp.toolpath.operations) {
    passes += op.passDepths.length;
    tabs += op.tabs.length;
  }

  const summary: SimSummary = {
    seconds: 0,
    cutLength: 0,
    rapidLength: 0,
    toolChanges: 0,
    dwellSeconds: 0,
    moves: 0,
    passes,
    tabs,
    files: files.length,
    sheets: sheets.length,
    rapidFeed,
  };
  for (const s of sheets) {
    summary.seconds += s.totals.seconds;
    summary.cutLength += s.totals.cutLength;
    summary.rapidLength += s.totals.rapidLength;
    summary.toolChanges += s.totals.toolChanges;
    summary.dwellSeconds += s.totals.dwellSeconds;
    summary.moves += s.totals.moves;
  }
  return { ok: true, ...base, sheets, summary, machine: simMachineFrame(profile, frame) };
}
