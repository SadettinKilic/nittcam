/**
 * The one G-code generator (spec §6.4, §7.2, §6.6; T017, D-025). It interprets a declarative
 * `PostConfig`, converts the sheet-frame toolpath to the machine frame (the only place that does)
 * and enforces the ten §7.2 rules itself: a program that would break one is refused with an
 * error, never written. Pure and deterministic: no clock, no randomness; the same input gives
 * byte-identical files.
 */
import { EPS } from '../geometry';
import { machineProfileSchema, VERIFICATION_STAGES, type MachineProfile } from '../machine';
import { operationMoves, type Operation, type Toolpath } from '../toolpath';
import { arcGeometry, arcPieces, chordSegments, splitArc, type ArcGeometry } from './arcs';
import { normalizePostVersion, parsePostConfig, type PostConfig } from './config';
import {
  buildFileName,
  formatComment,
  formatFixed,
  formatFixedCeil,
  formatFixedUp,
  PostFormatError,
  sanitizeComment,
  type CommentFormat,
} from './format';
import {
  envelopeViolation,
  machineArcDirection,
  machineFrame,
  toMachine,
  toMachineXY,
  zEnvelopeViolation,
  type MachineFrame,
  type Point3,
} from './frame';
import type {
  GenerateOptions,
  PostCode,
  PostFile,
  PostIssue,
  PostMeta,
  PostProfileVersion,
  PostResult,
} from './types';

/** Header line of an unverified profile or post (§7.2 rule 10). Transliterated when ASCII-only. */
export const UNVERIFIED_HEADER = 'DOĞRULANMADI, önce air cut';

const VERIFICATION_LABEL: Record<string, string> = {
  draft: 'TASLAK',
  air_cut_approved: 'AIR CUT ONAYLANDI',
  test_cut_approved: 'TEST KESİMİ ONAYLANDI',
  verified: 'DOĞRULANMIŞ',
  reverify_needed: 'YENİDEN DOĞRULAMA GEREKLİ',
};
const CORNER_LABEL: Record<string, string> = {
  frontLeft: 'ön sol',
  frontRight: 'ön sağ',
  backLeft: 'arka sol',
  backRight: 'arka sağ',
};

/** A §7.2 rule (or input) violation found while writing; aborts the file. */
class PostRuleError extends Error {
  override name = 'PostRuleError';
  constructor(
    readonly code: PostCode,
    message: string,
    readonly rule?: number,
    readonly operationId?: string,
  ) {
    super(message);
  }
}

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

interface Ctx {
  cfg: PostConfig;
  profile: MachineProfile;
  frame: MachineFrame;
  toolpath: Toolpath;
  meta: PostMeta;
  profileVersion: number;
  verification: string;
  unverified: boolean;
  arcsOn: boolean;
  lineNumbers: boolean;
  vacuum: { on: string; off: string } | null;
  comment: CommentFormat;
}

interface FilePlan {
  sheet: number;
  sheetIndex: number;
  sheetCount: number;
  tool: number | null;
  ops: Operation[];
}

/** Writes one program; holds the modal state and enforces the rules move by move. */
class Writer {
  readonly lines: string[] = [];
  private n: number;
  // Position in the sheet frame; XY unknown until the first XY move.
  private pos: Point3 = { x: 0, y: 0, z: 0 };
  private xyKnown = false;
  private zKnown = false;
  // Last written words (machine frame text) and their values.
  private wx: string | null = null;
  private wy: string | null = null;
  private wz: string | null = null;
  private motion: string | null = null;
  // The last motion block was a Z-only rapid to safe Z (rule 7 end retract already done).
  private atSafeZOnly = false;
  private feed: string | null = null;
  private forceFeed = true;
  private spindleRpm: number | null = null;
  private ready = false;
  private tool: number | null = null;
  private op: Operation | null = null;

  constructor(private readonly c: Ctx) {
    this.n = c.cfg.lineNumbers.start;
  }

  private fail(code: PostCode, message: string, rule?: number): never {
    throw new PostRuleError(code, message, rule, this.op?.id);
  }

  raw(line: string): void {
    this.lines.push(line);
  }

  comment(text: string): void {
    const line = formatComment(text, this.c.comment);
    if (line !== null) this.lines.push(line);
  }

  block(words: string[]): void {
    let line = words.join(' ');
    if (this.c.lineNumbers) {
      line = `N${this.n} ${line}`;
      this.n += this.c.cfg.lineNumbers.increment;
      if (this.n > this.c.cfg.lineNumbers.max) this.n = this.c.cfg.lineNumbers.start;
    }
    this.lines.push(line);
  }

  private num(v: number, d: number, what: string): string {
    try {
      return formatFixed(v, d);
    } catch (e) {
      if (e instanceof PostFormatError) this.fail('NUMBER_INVALID', `${what}: ${e.message}`, 8);
      throw e;
    }
  }

  /** Z words: rounded toward +Z, never deeper than the model (D-025). */
  private numZ(v: number, d: number): string {
    try {
      return formatFixedUp(v, d);
    } catch (e) {
      if (e instanceof PostFormatError) this.fail('NUMBER_INVALID', `Z: ${e.message}`, 8);
      throw e;
    }
  }

  private checkEnvelope(p: Point3): void {
    const why = envelopeViolation(this.c.frame, p);
    if (why) this.fail('OUT_OF_ENVELOPE', `Outside the work envelope (${why}).`, 6);
  }

  private finite(p: Point3): void {
    if (![p.x, p.y, p.z].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      this.fail('NUMBER_INVALID', 'Toolpath coordinate is not a finite number.', 8);
    }
  }

  /** Motion code word, unless suppressed. */
  private motionWord(code: string, out: string[]): void {
    if (!this.c.cfg.motion.suppressRepeatedCode || this.motion !== code) out.push(code);
    this.motion = code;
  }

  /** Axis words for a machine point; returns false when nothing changed. */
  private axisWords(m: Point3, out: string[], forceXY: boolean): boolean {
    const d = this.c.cfg.decimals;
    const sup = this.c.cfg.motion.suppressUnchangedAxes;
    const xs = this.num(m.x, d.xy, 'X');
    const ys = this.num(m.y, d.xy, 'Y');
    const zs = this.numZ(m.z, d.z);
    let any = false;
    if (forceXY || !sup || xs !== this.wx) {
      out.push(`X${xs}`);
      any = true;
    }
    if (forceXY || !sup || ys !== this.wy) {
      out.push(`Y${ys}`);
      any = true;
    }
    if (!sup || zs !== this.wz) {
      out.push(`Z${zs}`);
      any = true;
    }
    if (!any) return false;
    this.wx = xs;
    this.wy = ys;
    this.wz = zs;
    return true;
  }

  private feedWord(feed: number, out: string[]): void {
    const fs = this.num(feed, this.c.cfg.decimals.feed, 'F');
    if (this.forceFeed || fs !== this.feed) out.push(`F${fs}`);
    this.feed = fs;
    this.forceFeed = false;
  }

  /** Rapid straight up/down to the safe Z at the current XY (always written). */
  safeZ(): void {
    const z = this.c.toolpath.safeZ;
    const why = zEnvelopeViolation(this.c.frame, z);
    if (why) this.fail('OUT_OF_ENVELOPE', `Safe Z outside the work envelope (${why}).`, 6);
    const zm = z + this.c.frame.zOffset;
    const zs = this.numZ(zm, this.c.cfg.decimals.z);
    const words: string[] = [];
    // Always written in full: this is the rule-2 first move and the rule-7 end move.
    words.push(this.c.cfg.motion.rapid, `Z${zs}`);
    this.motion = this.c.cfg.motion.rapid;
    this.block(words);
    this.wz = zs;
    this.pos = { ...this.pos, z };
    this.zKnown = true;
    this.forceFeed = true;
    this.atSafeZOnly = true;
  }

  /** Rule 7: retract to safe Z once at the end, unless the last motion already did exactly that. */
  endSafeZ(): void {
    if (this.atSafeZOnly && this.zKnown && Math.abs(this.pos.z - this.c.toolpath.safeZ) <= EPS)
      return;
    this.safeZ();
  }

  private warmup(): void {
    const s = this.c.profile.spindle.warmupSeconds;
    if (s <= 0) return;
    const d = this.c.cfg.dwell;
    const value = d.unit === 'ms' ? s * 1000 : s;
    let text: string;
    try {
      text = formatFixedCeil(value, d.decimals);
    } catch (e) {
      if (e instanceof PostFormatError) this.fail('NUMBER_INVALID', `dwell: ${e.message}`, 8);
      throw e;
    }
    this.block(['G4', `${d.word}${text}`]);
  }

  private spindleOn(rpm: number): void {
    const sp = this.c.cfg.spindle;
    const s = `S${this.num(rpm, sp.rpmDecimals, 'S')}`;
    this.block(sp.speedPosition === 'after' ? [sp.on, s] : [s, sp.on]);
    this.warmup();
    this.spindleRpm = rpm;
    this.ready = true;
    this.forceFeed = true;
  }

  spindleOff(): void {
    this.block([this.c.cfg.spindle.off]);
    this.spindleRpm = null;
    this.ready = false;
  }

  private toolChange(op: Operation): void {
    const cfg = this.c.cfg;
    const first = this.tool === null;
    if (!this.zKnown || this.pos.z < this.c.toolpath.safeZ - EPS) {
      this.fail('SAFE_Z_INVALID', 'Tool change below safe Z.', 2);
    }
    if (this.spindleRpm !== null) this.spindleOff();
    const label = `T${op.tool} D${this.num(op.toolDiameter, 3, 'D')}`;
    const mode = cfg.toolChange.mode;
    if (mode === 'auto') {
      this.comment(`TAKIM: ${label}`);
      this.block([`T${op.tool}`, 'M6']);
      if (cfg.toolChange.lengthOffset && this.c.profile.toolChanger.lengthCompensation) {
        this.block(['G43', `H${op.tool}`]);
      }
    } else if (mode === 'manual' && !first) {
      this.comment(`TAKIM DEĞİŞTİR: ${label}, sonra cycle start`);
      this.block([cfg.toolChange.manualStop]);
    } else if (mode === 'manual' && cfg.toolChange.pauseForFirstTool) {
      this.comment(`TAKIM ${label} TAKILI MI? DEVAM İÇİN CYCLE START`);
      this.block([cfg.toolChange.manualStop]);
    } else {
      this.comment(`TAKIM: ${label}`);
    }
    this.tool = op.tool;
    const stopped = mode === 'manual' && (!first || cfg.toolChange.pauseForFirstTool);
    if (mode === 'auto' || stopped) {
      // The change macro or the operator may have moved the machine: back to safe Z, XY unknown.
      this.xyKnown = false;
      this.wx = null;
      this.wy = null;
      this.safeZ();
    }
  }

  operation(op: Operation): void {
    this.op = op;
    const profile = this.c.profile;
    if (op.kind !== 'outerContour') {
      this.fail('UNSUPPORTED_OPERATION', `Operation kind ${String(op.kind)} is not supported.`);
    }
    if (!profile.tools.some((t) => t.number === op.tool)) {
      this.fail('TOOL_NOT_IN_PROFILE', `Tool T${op.tool} is not in the machine profile.`);
    }
    if (
      !Number.isFinite(op.rpm) ||
      op.rpm < profile.spindle.minRpm ||
      op.rpm > profile.spindle.maxRpm
    ) {
      this.fail(
        'SPINDLE_INVALID',
        `Spindle speed ${String(op.rpm)} rpm is outside ${profile.spindle.minRpm}–${profile.spindle.maxRpm}.`,
        4,
      );
    }
    for (const [name, v] of [
      ['feed', op.feed],
      ['plunge feed', op.plungeFeed],
    ] as const) {
      if (!Number.isFinite(v) || v <= 0) this.fail('FEED_INVALID', `Invalid ${name} ${v}.`, 5);
    }
    if (op.tool !== this.tool) this.toolChange(op);
    if (this.spindleRpm !== op.rpm) this.spindleOn(op.rpm);
    for (const move of operationMoves(op)) this.move(op, move);
    this.op = null;
  }

  private move(op: Operation, move: ReturnType<typeof operationMoves>[number]): void {
    const tp = this.c.toolpath;
    const end: Point3 = { x: move.x, y: move.y, z: move.z };
    this.finite(end);
    this.checkEnvelope(end);
    const m = toMachine(this.c.frame, end);

    if (move.kind === 'rapid') {
      const xyChange =
        !this.xyKnown || Math.abs(end.x - this.pos.x) > EPS || Math.abs(end.y - this.pos.y) > EPS;
      if (xyChange) {
        if (!this.zKnown || this.pos.z < tp.safeZ - EPS || end.z < tp.safeZ - EPS) {
          this.fail('RAPID_BELOW_SAFE_Z', 'XY rapid below safe Z.', 2);
        }
      }
      if (end.z <= EPS) this.fail('RAPID_INTO_MATERIAL', 'Rapid move into the material.', 3);
      const words: string[] = [];
      this.motionWord(this.c.cfg.motion.rapid, words);
      if (this.axisWords(m, words, false)) {
        this.block(words);
        this.atSafeZOnly =
          !words.some((w) => w.startsWith('X') || w.startsWith('Y')) &&
          Math.abs(end.z - tp.safeZ) <= EPS;
      }
      this.pos = end;
      this.xyKnown = true;
      this.zKnown = true;
      this.forceFeed = true;
      return;
    }

    // Feed moves: spindle running and warmed up, known start, explicit valid feed.
    if (!this.ready || this.spindleRpm !== op.rpm) {
      this.fail('SPINDLE_NOT_READY', 'Cutting move before spindle start and warm-up.', 4);
    }
    if (!this.xyKnown || !this.zKnown) {
      this.fail('FEED_FROM_UNKNOWN_POSITION', 'Feed move from an unknown position.', 2);
    }
    if (!Number.isFinite(move.feed) || move.feed <= 0) {
      this.fail('FEED_INVALID', `Invalid feed ${String(move.feed)}.`, 5);
    }
    if (end.z < this.pos.z - EPS && move.feed > op.plungeFeed + EPS) {
      this.fail(
        'PLUNGE_TOO_FAST',
        `Descending move at ${move.feed} mm/min, plunge feed is ${op.plungeFeed}.`,
        3,
      );
    }

    if (move.kind === 'arc') {
      const g = arcGeometry(this.pos, move);
      if (!g.ok) this.fail('ARC_INVALID', `Arc rejected: ${g.reason}.`, 8);
      this.arcEnvelope(g.arc);
      const helical = Math.abs(end.z - this.pos.z) > EPS;
      const arcs = this.c.cfg.arcs;
      if (!this.c.arcsOn || (helical && !arcs.helical)) {
        const pts = splitArc(g.arc, this.pos, end, chordSegments(g.arc, arcs.chordTolerance));
        for (const p of pts) this.linear(p, move.feed);
      } else {
        const pts = splitArc(
          g.arc,
          this.pos,
          end,
          arcPieces(g.arc, arcs.maxSweepDeg, arcs.fullCircle),
        );
        let a0 = g.arc.a0;
        const step = g.arc.sweep / pts.length;
        for (const p of pts) {
          this.arcBlock(p, { ...g.arc, a0, sweep: step }, move.direction, move.feed);
          a0 += step;
        }
      }
    } else {
      this.linear(end, move.feed);
      // The first cutting move after a plunge states its feed again (D-025).
      if (move.kind === 'plunge') this.forceFeed = true;
    }
  }

  private linear(p: Point3, feed: number): void {
    const m = toMachine(this.c.frame, p);
    const words: string[] = [];
    const motionBefore = this.motion;
    this.motionWord(this.c.cfg.motion.linear, words);
    if (this.axisWords(m, words, false)) {
      this.feedWord(feed, words);
      this.block(words);
      this.atSafeZOnly = false;
    } else {
      this.motion = motionBefore;
    }
    this.pos = p;
  }

  private arcBlock(p: Point3, g: ArcGeometry, direction: 'cw' | 'ccw', feed: number): void {
    const cfg = this.c.cfg;
    const frame = this.c.frame;
    if (this.wx === null || this.wy === null) {
      this.fail('FEED_FROM_UNKNOWN_POSITION', 'Arc from an unknown position.', 2);
    }
    // I/J and R relative to the start as written (what the controller actually holds).
    const sx = Number(this.wx);
    const sy = Number(this.wy);
    const c = toMachineXY(frame, g.cx, g.cy);
    const m = toMachine(frame, p);
    const dir = machineArcDirection(frame, direction);
    const words: string[] = [];
    this.motionWord(dir === 'cw' ? cfg.motion.cw : cfg.motion.ccw, words);
    this.axisWords(m, words, true);
    const d = cfg.decimals.arc;
    if (cfg.arcs.mode === 'r') {
      const r = Math.hypot(sx - c.x, sy - c.y);
      // Sweeps are ≤ 179° in R mode (schema), so R is always positive.
      words.push(`R${this.num(r, d, 'R')}`);
    } else {
      const inc = cfg.arcs.mode === 'ijIncremental';
      words.push(`I${this.num(inc ? c.x - sx : c.x, d, 'I')}`);
      words.push(`J${this.num(inc ? c.y - sy : c.y, d, 'J')}`);
    }
    this.feedWord(feed, words);
    this.block(words);
    this.atSafeZOnly = false;
    this.pos = p;
  }

  /** Rule 6 for the arc's extreme points (quadrant points inside the sweep). */
  private arcEnvelope(g: ArcGeometry): void {
    const lo = Math.min(g.a0, g.a0 + g.sweep);
    const hi = Math.max(g.a0, g.a0 + g.sweep);
    for (let k = Math.ceil(lo / (Math.PI / 2)); k * (Math.PI / 2) <= hi; k++) {
      const a = k * (Math.PI / 2);
      this.checkEnvelope({
        x: g.cx + g.r * Math.cos(a),
        y: g.cy + g.r * Math.sin(a),
        z: this.pos.z,
      });
    }
  }
}

function headerLines(c: Ctx, plan: FilePlan, part: number, parts: number): string[] {
  const { cfg, profile, meta } = c;
  const f3 = (v: number) => formatFixed(v, 3);
  const lines: string[] = [];
  if (c.unverified) lines.push(UNVERIFIED_HEADER);
  lines.push(`PROJE: ${meta.projectName}`);
  lines.push(`REVİZYON: ${meta.revision}`);
  lines.push(
    `POST: ${cfg.id} ${cfg.version} ${cfg.name}${cfg.status === 'unverified' ? ' - DOĞRULANMADI' : ''}`,
  );
  lines.push(`PROFİL: ${profile.identity.name} sürüm ${c.profileVersion}`);
  lines.push(
    `DOĞRULAMA: ${VERIFICATION_LABEL[c.verification] ?? c.verification}${profile.example ? ' - ÖRNEK PROFİL' : ''}`,
  );
  lines.push(
    `PLAKA ${plan.sheetIndex}/${plan.sheetCount}${parts > 1 ? ` - BÖLÜM ${part}/${parts}` : ''}`,
  );
  lines.push(
    `MALZEME: ${meta.stock.material} ${f3(meta.stock.thickness)} mm, plaka ${f3(meta.stock.sheetWidth)} x ${f3(meta.stock.sheetHeight)}`,
  );
  lines.push(
    `ORİJİN: ${CORNER_LABEL[profile.origin.corner] ?? profile.origin.corner}, X+ ${profile.origin.xPositive === 'right' ? 'sağ' : 'sol'}, Y+ ${profile.origin.yPositive === 'back' ? 'arka' : 'ön'}, plaka ofseti ${f3(profile.origin.sheetOffset.x)} / ${f3(profile.origin.sheetOffset.y)}`,
  );
  lines.push(`Z SIFIR: ${profile.zZero.reference === 'table' ? 'tabla yüzeyi' : 'malzeme üstü'}`);
  const tools = [...new Set(plan.ops.map((o) => o.tool))];
  lines.push(
    `TAKIMLAR: ${tools
      .map((t) => {
        const op = plan.ops.find((o) => o.tool === t);
        return `T${t} D${f3(op?.toolDiameter ?? 0)}`;
      })
      .join(', ')}`,
  );
  lines.push('NittCam ile üretildi');
  return lines;
}

function renderProgram(
  c: Ctx,
  plan: FilePlan,
  ops: Operation[],
  part: number,
  parts: number,
): string {
  const w = new Writer(c);
  const cfg = c.cfg;
  for (const l of cfg.program.prefix) w.raw(l);
  for (const l of headerLines(c, { ...plan, ops }, part, parts)) w.comment(l);
  // Rule 1: explicit modal state (schema guarantees G21 G90 G17 G5x and the arc word).
  w.block([...cfg.modal.words]);
  for (const l of cfg.program.start) w.block([l]);
  // Rule 2: the first move is up to safe Z.
  w.safeZ();
  if (c.vacuum) w.block([c.vacuum.on]);
  for (const op of ops) w.operation(op);
  // Rule 7: safe Z (once), spindle off, vacuum off, end code.
  w.endSafeZ();
  w.spindleOff();
  if (c.vacuum) w.block([c.vacuum.off]);
  for (const l of cfg.program.end) w.block([l]);
  for (const l of cfg.program.suffix) w.raw(l);
  const eol = cfg.file.lineEnding === 'crlf' ? '\r\n' : '\n';
  return w.lines.join(eol) + eol;
}

/** Final structural check of a written program (defence in depth for rules 1, 2, 7, 8). */
function verifyProgram(c: Ctx, content: string): string | null {
  const lines = content.split(/\r?\n/).filter((l) => l !== '');
  const strip = (l: string) => l.replace(/^N\d+ /, '');
  const blocks = lines.filter((l) => !l.startsWith('(') && !l.startsWith(';')).map(strip);
  const modal = blocks.find((b) => b.split(' ').includes('G21'));
  if (!modal) return 'modal line missing';
  for (const w of ['G21', 'G90', 'G17']) if (!modal.split(' ').includes(w)) return `${w} missing`;
  const firstMove = blocks.find((b) => /^(G0?[0-3])\b/.test(b));
  if (!firstMove || !/^G0?0 Z-?\d/.test(firstMove)) return 'first move is not a Z rapid';
  if (/[eE][+-]?\d|NaN|Infinity|undefined|null/.test(blocks.join('\n'))) return 'bad number text';
  if (/[A-Z]-0(\.0+)?(?![.\d])/.test(blocks.join(' '))) return 'negative zero written';
  if (/[A-Z](?=\s|$)/.test(blocks.filter((b) => b !== '%').join(' '))) return 'empty word';
  const endIdx = blocks.findIndex((b) => c.cfg.program.end.includes(b));
  if (endIdx < 0) return 'end block missing';
  return null;
}

/**
 * Generates the NC files for a toolpath. One program per sheet (D-023); per tool run as well in
 * "none" tool-change mode; split at operation boundaries when larger than the size limit (or
 * refused, per config). Any error → `ok: false` and no files.
 */
export function generateGcode(
  toolpath: Toolpath,
  machineProfileVersion: PostProfileVersion,
  postConfig: unknown,
  meta: PostMeta,
  options: GenerateOptions = {},
): PostResult {
  const errors: PostIssue[] = [];
  const warnings: PostIssue[] = [];
  const err = (code: PostCode, message: string, rule?: number, extra: Partial<PostIssue> = {}) =>
    errors.push({ code, severity: 'error', message, ...(rule ? { rule } : {}), ...extra });
  const fail = (): PostResult => ({ ok: false, files: [], errors, warnings });

  // --- inputs ---
  const cfgR = parsePostConfig(postConfig);
  if (!cfgR.ok) {
    for (const i of cfgR.issues) {
      const rule = i.path.startsWith('modal')
        ? 1
        : i.path.startsWith('program.end')
          ? 7
          : undefined;
      err('INVALID_POST_CONFIG', `Post config ${i.path}: ${i.message}`, rule);
    }
    return fail();
  }
  const cfg = cfgR.config;
  const profR = machineProfileSchema.safeParse(machineProfileVersion?.profile);
  if (!profR.success) {
    err('INVALID_PROFILE', `Machine profile invalid: ${profR.error.issues[0]?.message ?? ''}`);
    return fail();
  }
  const profile = profR.data;
  const state = machineProfileVersion.verification;
  if (![...VERIFICATION_STAGES, 'reverify_needed'].includes(state)) {
    err('INVALID_PROFILE', `Unknown verification state ${String(state)}.`);
    return fail();
  }
  if (!Number.isInteger(machineProfileVersion.version) || machineProfileVersion.version < 1) {
    err('INVALID_PROFILE', 'Profile version must be a positive integer.');
    return fail();
  }
  if (
    profile.post.id !== cfg.id ||
    normalizePostVersion(profile.post.version) !== normalizePostVersion(cfg.version)
  ) {
    err(
      'POST_MISMATCH',
      `Profile expects post ${profile.post.id} ${profile.post.version}, got ${cfg.id} ${cfg.version}.`,
    );
    return fail();
  }
  const st = meta?.stock;
  const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (
    !meta ||
    typeof meta.projectName !== 'string' ||
    !Number.isInteger(meta.revision) ||
    meta.revision < 0 ||
    !st ||
    typeof st.material !== 'string' ||
    !pos(st.thickness) ||
    !pos(st.sheetWidth) ||
    !pos(st.sheetHeight)
  ) {
    err('INVALID_META', 'Project name, revision or stock size missing or invalid.');
    return fail();
  }
  if (!toolpath || toolpath.units !== 'mm' || toolpath.frame !== 'sheet') {
    err('INVALID_TOOLPATH', 'Toolpath must be in millimetres in the sheet frame.');
    return fail();
  }
  if (!Array.isArray(toolpath.operations) || toolpath.operations.length === 0) {
    err('NO_OPERATIONS', 'Toolpath has no operations.');
    return fail();
  }
  if (
    !Number.isFinite(toolpath.safeZ) ||
    toolpath.safeZ < profile.safeZ - EPS ||
    toolpath.safeZ <= 0
  ) {
    err(
      'SAFE_Z_INVALID',
      `Toolpath safe Z ${toolpath.safeZ} is below the profile's ${profile.safeZ}.`,
      2,
    );
    return fail();
  }
  const expectedTarget = -(st.thickness + profile.zZero.spoilboardAllowance);
  if (!(Math.abs(toolpath.targetDepth - expectedTarget) <= EPS)) {
    err(
      'STOCK_MISMATCH',
      `Toolpath target depth ${toolpath.targetDepth} does not match thickness ${st.thickness} + allowance ${profile.zZero.spoilboardAllowance}.`,
    );
    return fail();
  }
  if (cfg.toolChange.mode === 'auto' && profile.toolChanger.type !== 'auto') {
    err(
      'TOOL_CHANGE_UNSUPPORTED',
      `Post writes T.. M6 but the machine's tool changer is ${profile.toolChanger.type}.`,
    );
    return fail();
  }
  let vacuum: Ctx['vacuum'] = null;
  if (
    cfg.vacuum.enabled &&
    profile.holdDown.type === 'vacuum' &&
    profile.holdDown.vacuumOn !== ''
  ) {
    if (profile.holdDown.vacuumOff === '') {
      err('VACUUM_OFF_MISSING', 'Vacuum on code without an off code.', 7);
      return fail();
    }
    vacuum = { on: profile.holdDown.vacuumOn, off: profile.holdDown.vacuumOff };
  }
  if (profile.spindle.warmupSeconds <= 0) {
    warnings.push({
      code: 'NO_WARMUP',
      severity: 'warning',
      rule: 4,
      message: 'Profile warm-up is 0 s: no dwell after spindle start.',
    });
  }

  const frame = machineFrame(profile, st);
  if (frame.inX !== frame.axX || frame.inY !== frame.axY) {
    warnings.push({
      code: 'AXIS_AWAY_FROM_TABLE',
      severity: 'warning',
      message: 'An axis points away from the table from program zero: coordinates are negative.',
    });
  }

  const ctx: Ctx = {
    cfg,
    profile,
    frame,
    toolpath,
    meta,
    profileVersion: machineProfileVersion.version,
    verification: state,
    unverified: state !== 'verified' || profile.example || cfg.status !== 'verified',
    arcsOn: cfg.arcs.enabled && profile.constraints.arcs,
    lineNumbers: cfg.lineNumbers.enabled || profile.constraints.lineNumbers,
    vacuum,
    comment: cfg.comments,
  };

  // --- plan files: one per sheet (and per tool run in "none" mode) ---
  const sheets = [...new Set(toolpath.operations.map((o) => o.sheet))].sort((a, b) => a - b);
  const plans: FilePlan[] = [];
  sheets.forEach((sheet, si) => {
    const ops = toolpath.operations.filter((o) => o.sheet === sheet);
    if (cfg.toolChange.mode === 'none') {
      let run: Operation[] = [];
      for (const op of ops) {
        if (run.length > 0 && run[0]?.tool !== op.tool) {
          plans.push({
            sheet,
            sheetIndex: si + 1,
            sheetCount: sheets.length,
            tool: run[0]?.tool ?? null,
            ops: run,
          });
          run = [];
        }
        run.push(op);
      }
      if (run.length > 0) {
        plans.push({
          sheet,
          sheetIndex: si + 1,
          sheetCount: sheets.length,
          tool: run[0]?.tool ?? null,
          ops: run,
        });
      }
    } else {
      plans.push({ sheet, sheetIndex: si + 1, sheetCount: sheets.length, tool: null, ops });
    }
  });

  const maxBytes = Math.min(
    cfg.file.maxSizeBytes,
    Math.floor(profile.constraints.maxFileSizeMb * 1024 * 1024),
  );
  const maxName = Math.min(cfg.file.maxNameLength, profile.constraints.maxFileNameLength);
  const stem = meta.fileStem ?? meta.projectName;
  const files: PostFile[] = [];
  const toolRuns = new Map<string, number>();

  for (const plan of plans) {
    try {
      const chunks = splitPlan(ctx, plan, maxBytes);
      if (chunks === null) {
        err('FILE_TOO_LARGE', `Sheet ${plan.sheet} program exceeds ${maxBytes} bytes.`, undefined, {
          sheet: plan.sheet,
        });
        continue;
      }
      if (chunks.length > 1) {
        warnings.push({
          code: 'FILE_SPLIT',
          severity: 'warning',
          message: `Sheet ${plan.sheet} program split into ${chunks.length} files (size limit).`,
          sheet: plan.sheet,
        });
      }
      let suffix = `_S${plan.sheetIndex}`;
      if (plan.tool !== null) {
        const key = `${plan.sheet}/${plan.tool}`;
        const k = (toolRuns.get(key) ?? 0) + 1;
        toolRuns.set(key, k);
        suffix += `_T${plan.tool}${k > 1 ? `_${k}` : ''}`;
      }
      chunks.forEach((content, i) => {
        const name = buildFileName(
          stem,
          chunks.length > 1 ? `${suffix}_P${i + 1}` : suffix,
          cfg.file.extension,
          maxName,
        );
        if (name === null) {
          err('FILE_NAME_TOO_LONG', `No file name fits in ${maxName} characters.`);
          return;
        }
        const bad = verifyProgram(ctx, content);
        if (bad) {
          err('CHECK_FAILED', `Internal program check failed: ${bad}.`);
          return;
        }
        files.push({
          name,
          content,
          sheet: plan.sheet,
          tool: plan.tool,
          part: i + 1,
          parts: chunks.length,
        });
      });
    } catch (e) {
      if (e instanceof PostRuleError) {
        err(e.code, e.message, e.rule, {
          sheet: plan.sheet,
          ...(e.operationId ? { operationId: e.operationId } : {}),
        });
      } else {
        throw e;
      }
    }
  }
  if (new Set(files.map((f) => f.name.toLowerCase())).size !== files.length) {
    err('FILE_NAME_TOO_LONG', 'File names collide after shortening.');
  }
  if (errors.length > 0) return fail();

  // Rule 9 hook: the independent reader checks (T018/T019).
  if (options.check) {
    const found = options.check(files).filter((i) => i.severity === 'error');
    if (found.length > 0) {
      for (const i of found) errors.push({ ...i, code: 'CHECK_FAILED', rule: 9 });
      return fail();
    }
  }
  return { ok: true, files, errors, warnings };
}

/**
 * The program of a plan as one or more files within `maxBytes`, split greedily at operation
 * boundaries (`onOversize: split`). Null when it does not fit and may not be split, or when a
 * single operation alone is too large.
 */
function splitPlan(c: Ctx, plan: FilePlan, maxBytes: number): string[] | null {
  const whole = renderProgram(c, plan, plan.ops, 1, 1);
  if (utf8Length(whole) <= maxBytes) return [whole];
  if (c.cfg.file.onOversize === 'error') return null;
  // Greedy packing; the part count in the header is filled in by a second render.
  const groups: Operation[][] = [];
  let cur: Operation[] = [];
  for (const op of plan.ops) {
    const trial = [...cur, op];
    // A placeholder "part 99/99" keeps the header at least as long as the final one.
    if (utf8Length(renderProgram(c, plan, trial, 99, 99)) <= maxBytes) {
      cur = trial;
      continue;
    }
    if (cur.length === 0) return null;
    groups.push(cur);
    cur = [op];
    if (utf8Length(renderProgram(c, plan, cur, 99, 99)) > maxBytes) return null;
  }
  if (cur.length > 0) groups.push(cur);
  return groups.map((ops, i) => renderProgram(c, plan, ops, i + 1, groups.length));
}

/** Comment text as the config would write it (for tests and the UI preview). */
export function postCommentText(config: PostConfig, text: string): string {
  return sanitizeComment(text, config.comments);
}
