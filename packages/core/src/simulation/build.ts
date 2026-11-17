/**
 * Read G-code → playback steps in the sheet frame (spec §6.5, T020, D-028). Pure.
 *
 * Each read move becomes one step; arcs are sampled into short chords for drawing. Time is an
 * approximation (§6.5 "Süre yaklaşıktır"): a feed move takes length / feed, a rapid length / the
 * profile's rapid feed, a dwell its seconds. Tool changes and operator stops take no time here.
 */
import { checkSheetPoint, type CheckFrame } from '../gcode-check';
import { gcodeMoveLength, sampleGcodeMove, type GcodeReadResult } from '../gcode-reader';
import type { SimContour, SimFile, SimSheet, SimStep } from './types';

/** Chord tolerance of the drawn arcs, mm (far below a screen pixel at any useful zoom). */
export const SIM_CHORD_TOLERANCE = 0.05;

/** Feed assumed for a feed move without a feed (the checks refuse such a program anyway), mm/min. */
const FALLBACK_FEED = 1000;

export interface SimSheetInput {
  sheet: number;
  /** The sheet's files in program order, each with its read result (strict reader). */
  files: readonly { name: string; content: string; read: GcodeReadResult }[];
  frame: CheckFrame;
  /** mm/min, > 0. */
  rapidFeed: number;
  /** Tool diameters of the machine profile by tool number. */
  toolDiameters: Readonly<Record<number, number>>;
}

/** Splits a program into physical lines the way the reader counts them (CRLF, LF and bare CR). */
export function splitGcodeLines(content: string): string[] {
  const lines = content.split(/\r\n|\n|\r/);
  // A final line ending does not start a new line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Tool number named in a comment of a manual tool change prompt, e.g. "(TAKIM T2 D8.000 ...)". */
function promptTool(lines: readonly string[], line: number): number | null {
  // The prompt comment sits on the stop line itself or on one of the two lines before it.
  for (let k = line; k >= Math.max(1, line - 2); k -= 1) {
    const text = lines[k - 1] ?? '';
    const comment = /\(([^)]*)\)|;(.*)$/.exec(text);
    const body = comment ? (comment[1] ?? comment[2] ?? '') : '';
    const m = /\bT(\d{1,3})\b/i.exec(body);
    if (m) return Number(m[1]);
  }
  return null;
}

export function buildSimSheet(input: SimSheetInput): SimSheet {
  const { frame, rapidFeed } = input;
  const files: SimFile[] = [];
  const points: number[] = [];
  const steps: SimStep[] = [];
  const contours: SimContour[] = [];
  const toolDiameters: Record<number, number> = {};
  let t = 0;
  let cutLength = 0;
  let rapidLength = 0;
  let toolChanges = 0;
  let dwellSeconds = 0;
  let zBottom = 0;
  let contour = 0;
  let newContour = true;

  input.files.forEach((f, fileIndex) => {
    const lines = splitGcodeLines(f.content);
    files.push({ name: f.name, lines });
    const { moves, events } = f.read;
    // Events before move k (dwell time, tool changes), keyed by move index.
    const dwellBefore = new Map<number, number>();
    const toolBefore = new Map<number, number | null>();
    for (const e of events) {
      if (e.kind === 'dwell') {
        dwellBefore.set(e.moveIndex, (dwellBefore.get(e.moveIndex) ?? 0) + e.seconds);
        dwellSeconds += e.seconds;
      } else if (e.kind === 'toolChange') {
        toolChanges += 1;
        toolBefore.set(e.moveIndex, e.tool);
      } else if (e.kind === 'pause') {
        // Our manual posts stop with M0 and name the tool in a comment (D-025).
        toolChanges += 1;
        const named = promptTool(lines, e.line);
        if (named !== null) toolBefore.set(e.moveIndex, named);
      }
    }

    let tool: number | null = null;
    let xyKnown = false;
    // Each program starts from wherever the machine is: a new path start point.
    const first = moves[0];
    if (first) {
      const p = checkSheetPoint(frame, first.from);
      points.push(p.x, p.y, p.z);
    }
    newContour = true;
    moves.forEach((m, k) => {
      if (toolBefore.has(k)) tool = toolBefore.get(k) ?? null;
      if (m.tool !== null) tool = m.tool;
      const diameter = tool !== null ? input.toolDiameters[tool] : undefined;
      if (tool !== null && diameter !== undefined) toolDiameters[tool] = diameter;
      const dwell = dwellBefore.get(k) ?? 0;
      const p0 = points.length / 3 - 1;
      const from = checkSheetPoint(frame, m.from);
      let zMin = from.z;
      for (const q of sampleGcodeMove(m, SIM_CHORD_TOLERANCE)) {
        const s = checkSheetPoint(frame, q);
        points.push(s.x, s.y, s.z);
        if (s.z < zMin) zMin = s.z;
      }
      const p1 = points.length / 3 - 1;
      const length = gcodeMoveLength(m);
      const rapid = m.type === 'rapid';
      const feed = rapid ? null : (m.feed ?? FALLBACK_FEED);
      const seconds = (length / (rapid ? rapidFeed : (feed ?? FALLBACK_FEED))) * 60;
      const t0 = t + dwell;
      t = t0 + seconds;
      const known = xyKnown;
      const assumed = m.assumedAxes;
      xyKnown = !assumed.includes('x') && !assumed.includes('y');
      let n = 0;
      if (rapid) {
        rapidLength += length;
        // Every contour of our posts is entered from a rapid (approach) and left by one (retract).
        newContour = true;
      } else {
        cutLength += length;
        if (zMin < zBottom) zBottom = zMin;
        if (newContour) {
          contour += 1;
          newContour = false;
          contours.push({ n: contour, step: steps.length, x: from.x, y: from.y, t: t0 });
        }
        n = contour;
      }
      steps.push({
        kind: rapid ? 'rapid' : 'cut',
        file: fileIndex,
        line: m.line,
        p0,
        p1,
        t0,
        t1: t,
        length,
        feed,
        zMin,
        contour: n,
        known,
        tool,
      });
    });
    // A dwell after the last move still takes time.
    t += dwellBefore.get(moves.length) ?? 0;
  });

  return {
    sheet: input.sheet,
    files,
    points,
    steps,
    contours,
    duration: t,
    totals: {
      seconds: t,
      cutLength,
      rapidLength,
      toolChanges,
      dwellSeconds,
      moves: steps.length,
    },
    zBottom,
    toolDiameters,
  };
}
