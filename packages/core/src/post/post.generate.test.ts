/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Generator behaviour (T017): arcs (I/J correctness, splitting, R, no arcs), determinism, line
 * endings, line numbers, tool-change modes, file names and size limits, input checks, the
 * known-post list and the profile's rapid feed.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import genericPost from '../../../machines/generic/v1/post.json';
import mach3Post from '../../../machines/mach3/v1/post.json';
import { EPS } from '../geometry';
import { buildToolpath, type Operation, type Toolpath } from '../toolpath';
import { projectOf } from '../toolpath/toolpath.testing';
import { KNOWN_POSTS, normalizePostVersion, parsePostConfig } from './config';
import { machineFrame, toMachineXY } from './frame';
import {
  config,
  metaFor,
  profileFor,
  readBlocks,
  readMoves,
  run,
  sampleToolpath,
} from './post.testing';

interface ArcSpec {
  cx: number;
  cy: number;
  r: number;
  a0: number;
  sweep: number;
  dz: number;
}

/** One synthetic operation: approach, plunge to −1, a single arc, retract. */
function arcToolpath(a: ArcSpec): Toolpath {
  const sx = a.cx + a.r * Math.cos(a.a0);
  const sy = a.cy + a.r * Math.sin(a.a0);
  const ex = a.cx + a.r * Math.cos(a.a0 + a.sweep);
  const ey = a.cy + a.r * Math.sin(a.a0 + a.sweep);
  const op: Operation = {
    id: 'arc#0',
    kind: 'outerContour',
    sheet: 0,
    partId: 'arc',
    copy: 0,
    tool: 2,
    toolDiameter: 8,
    rpm: 18000,
    feed: 6000,
    plungeFeed: 1500,
    travel: a.sweep > 0 ? 'ccw' : 'cw',
    passDepths: [-1],
    tabs: [],
    segments: [
      {
        role: 'approach',
        moves: [
          { kind: 'rapid', x: sx, y: sy, z: 20 },
          { kind: 'rapid', x: sx, y: sy, z: 2 },
          { kind: 'plunge', x: sx, y: sy, z: -1, feed: 1500 },
        ],
      },
      {
        role: 'pass',
        pass: 0,
        depth: -1,
        final: true,
        moves: [
          {
            kind: 'arc',
            x: ex,
            y: ey,
            z: -1 - a.dz,
            cx: a.cx,
            cy: a.cy,
            direction: a.sweep > 0 ? 'ccw' : 'cw',
            bulge: Math.tan(a.sweep / 4),
            feed: a.dz > 0 ? 1500 : 6000,
          },
        ],
      },
      { role: 'retract', moves: [{ kind: 'rapid', x: ex, y: ey, z: 20 }] },
    ],
  };
  return {
    units: 'mm',
    frame: 'sheet',
    safeZ: 20,
    clearanceZ: 2,
    targetDepth: -18.5,
    operations: [op],
  };
}

const arcArb = fc.record({
  cx: fc.double({ min: 400, max: 1800, noNaN: true }),
  cy: fc.double({ min: 300, max: 900, noNaN: true }),
  r: fc.double({ min: 0.5, max: 250, noNaN: true }),
  a0: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  sweep: fc
    .double({ min: 0.02, max: 2 * Math.PI - 0.02, noNaN: true })
    .chain((s) => fc.constantFrom(s, -s)),
  dz: fc.constantFrom(0, 0, 0.5),
});

describe('arcs', () => {
  it('centre = start + (I, J) within EPS, for random arcs on natural and mirrored frames', () => {
    fc.assert(
      fc.property(arcArb, fc.boolean(), (a, mirrored) => {
        const p = profileFor();
        if (mirrored) {
          p.origin = {
            corner: 'frontRight',
            xPositive: 'left',
            yPositive: 'back',
            sheetOffset: { x: 0, y: 0 },
          };
        }
        const r = run({ toolpath: arcToolpath(a), profile: p });
        expect(r.errors).toEqual([]);
        const frame = machineFrame(p, metaFor().stock);
        const c = toMachineXY(frame, a.cx, a.cy);
        const arcs = readMoves(r.files[0]!.content).filter(
          (m) => m.kind === 'cw' || m.kind === 'ccw',
        );
        expect(arcs.length).toBeGreaterThan(0);
        // Max 180° per block (generic config): the sweep needs at least this many blocks.
        expect(arcs.length).toBeGreaterThanOrEqual(Math.ceil(Math.abs(a.sweep) / Math.PI - 1e-9));
        for (const m of arcs) {
          const ccx = m.from.x + m.i!;
          const ccy = m.from.y + m.j!;
          expect(Math.hypot(ccx - c.x, ccy - c.y)).toBeLessThanOrEqual(EPS);
          const r0 = Math.hypot(m.from.x - ccx, m.from.y - ccy);
          const r1 = Math.hypot(m.to.x - ccx, m.to.y - ccy);
          // Written start, end and centre are each rounded to 0.0005 per axis: ≤ 2.9e-3 worst case.
          expect(Math.abs(r0 - r1)).toBeLessThanOrEqual(3 * EPS);
          const expectedDir = a.sweep > 0 !== mirrored ? 'ccw' : 'cw';
          expect(m.kind).toBe(expectedDir);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('arcs: false splits into lines within the chord tolerance', () => {
    fc.assert(
      fc.property(arcArb, fc.constantFrom(0.005, 0.01, 0.1), (a, tol) => {
        const cfg = config('generic');
        cfg.arcs.enabled = false;
        cfg.arcs.chordTolerance = tol;
        const r = run({ toolpath: arcToolpath(a), config: cfg });
        expect(r.errors).toEqual([]);
        const moves = readMoves(r.files[0]!.content);
        expect(moves.some((m) => m.kind === 'cw' || m.kind === 'ccw')).toBe(false);
        const cut = moves.filter((m) => m.kind === 'linear' && m.from.z <= -1 + 1e-9);
        for (const m of cut) {
          const d1 = Math.hypot(m.to.x - a.cx, m.to.y - a.cy);
          expect(Math.abs(d1 - a.r)).toBeLessThanOrEqual(EPS);
          const mx = (m.from.x + m.to.x) / 2;
          const my = (m.from.y + m.to.y) / 2;
          expect(a.r - Math.hypot(mx - a.cx, my - a.cy)).toBeLessThanOrEqual(tol + EPS);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('profile without arc support also splits; helical off splits only helical arcs', () => {
    const p = profileFor();
    p.constraints.arcs = false;
    expect(run({ profile: p }).files[0]!.content).not.toMatch(/\bG[23] /);
    const cfg = config('generic');
    cfg.arcs.helical = false;
    const flat = run({
      toolpath: arcToolpath({ cx: 800, cy: 600, r: 50, a0: 0, sweep: 2, dz: 0 }),
      config: cfg,
    });
    expect(flat.files[0]!.content).toMatch(/\nG3 /);
    const hel = run({
      toolpath: arcToolpath({ cx: 800, cy: 600, r: 50, a0: 0, sweep: 2, dz: 0.5 }),
      config: cfg,
    });
    expect(hel.files[0]!.content).not.toMatch(/\nG3 /);
  });

  it('a full circle is split in halves', () => {
    const tp = arcToolpath({ cx: 800, cy: 600, r: 50, a0: 0, sweep: 2 * Math.PI - 1e-7, dz: 0 });
    const arcs = readMoves(run({ toolpath: tp }).files[0]!.content).filter((m) => m.kind === 'ccw');
    expect(arcs).toHaveLength(2);
  });

  it('R mode writes R ≤ 179° per block with the right radius; schema refuses R + full circle', () => {
    const cfg = config('generic');
    cfg.arcs.mode = 'r';
    cfg.arcs.maxSweepDeg = 179;
    const r = run({
      toolpath: arcToolpath({ cx: 800, cy: 600, r: 50, a0: 0, sweep: 4, dz: 0 }),
      config: cfg,
    });
    const blocks = readBlocks(r.files[0]!.content).filter((b) => b.codes.includes('G3'));
    expect(blocks.length).toBe(Math.ceil(4 / ((179 * Math.PI) / 180)));
    for (const b of blocks) {
      expect(b.words.has('I')).toBe(false);
      expect(Number(b.words.get('R'))).toBeCloseTo(50, 3);
    }
    cfg.arcs.fullCircle = true;
    expect(parsePostConfig(cfg).ok).toBe(false);
  });

  it('absolute I/J needs G90.1 and writes the centre', () => {
    const cfg = config('generic');
    cfg.arcs.mode = 'ijAbsolute';
    expect(parsePostConfig(cfg).ok).toBe(false);
    cfg.arcs.distanceModeWord = 'G90.1';
    cfg.modal.words.push('G90.1');
    const r = run({
      toolpath: arcToolpath({ cx: 800, cy: 600, r: 50, a0: 0, sweep: 1, dz: 0 }),
      config: cfg,
    });
    const arc = readBlocks(r.files[0]!.content).find((b) => b.codes.includes('G3'))!;
    expect(arc.words.get('I')).toBe('800.000');
    expect(arc.words.get('J')).toBe('600.000');
  });
});

describe('determinism and text format', () => {
  it('same input → byte-identical output', () => {
    const a = run();
    const b = run();
    expect(a.files).toEqual(b.files);
    expect(a.files[0]!.content).toBe(b.files[0]!.content);
  });

  it('CRLF: every line ends with \\r\\n; LF: no \\r', () => {
    const crlf = run().files[0]!.content;
    expect(crlf.endsWith('\r\n')).toBe(true);
    expect(crlf.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const cfg = config('generic');
    cfg.file.lineEnding = 'lf';
    const lf = run({ config: cfg }).files[0]!.content;
    expect(lf).not.toContain('\r');
    expect(lf.split('\n').length).toBe(crlf.split('\r\n').length);
  });

  it('output is pure ASCII with ASCII-only comments', () => {
    expect(run().files[0]!.content).toMatch(/^[\x20-\x7E\r\n]*$/);
  });

  it('line numbers: N on blocks only, start/increment, wrap at max', () => {
    const cfg = config('generic');
    cfg.lineNumbers = { enabled: true, start: 10, increment: 10, max: 200 };
    const lines = run({ config: cfg })
      .files[0]!.content.split('\r\n')
      .filter((l) => l !== '');
    const blocks = lines.filter((l) => !l.startsWith('('));
    expect(blocks[0]).toBe('N10 G21 G90 G17 G54');
    expect(blocks[1]).toBe('N20 G0 Z20.000');
    expect(lines.filter((l) => l.startsWith('(')).every((l) => !/^N/.test(l))).toBe(true);
    const ns = blocks.map((b) => Number(/^N(\d+) /.exec(b)![1]));
    expect(Math.max(...ns)).toBeLessThanOrEqual(200);
    expect(ns[20]).toBe(10);
  });

  it('modal suppression off writes every axis and motion code', () => {
    const cfg = config('generic');
    cfg.motion.suppressUnchangedAxes = false;
    for (const b of readBlocks(run({ config: cfg }).files[0]!.content)) {
      if (b.codes.some((c) => /^G[0-3]$/.test(c)) && b.words.has('X')) {
        expect(b.words.has('Y') && b.words.has('Z')).toBe(true);
      }
    }
  });

  it('header has project, revision, post, profile version, state; no timestamps', () => {
    const c = run().files[0]!.content;
    expect(c).toContain('(PROJE: Deneme isi)');
    expect(c).toContain('(REVIZYON: 2)');
    expect(c).toContain('(POST: generic 1.0.0 Genel duz G-code - DOGRULANMADI)');
    expect(c).toContain('(PROFIL: Genel duz G-code router surum 1)');
    expect(c).toContain('(DOGRULAMA: TASLAK - ORNEK PROFIL)');
    expect(c).toContain('(NittCam ile uretildi)');
    expect(c).not.toMatch(/20\d\d-\d\d-\d\d|\d\d:\d\d/);
  });
});

describe('tool change modes', () => {
  it('auto writes T2 M6 then returns to safe Z', () => {
    const lines = readBlocks(run().files[0]!.content).map((b) => b.line);
    const i = lines.indexOf('T2 M6');
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe('G0 Z20.000');
  });

  it('auto with length compensation writes G43 H<tool>', () => {
    const p = profileFor();
    p.toolChanger.lengthCompensation = true;
    const cfg = config('generic');
    cfg.toolChange.lengthOffset = true;
    expect(run({ profile: p, config: cfg }).files[0]!.content).toContain('\r\nG43 H2\r\n');
  });

  it('auto post on a machine without changer is refused', () => {
    const p = profileFor();
    p.toolChanger.type = 'manual';
    expect(run({ profile: p }).errors[0]!.code).toBe('TOOL_CHANGE_UNSUPPORTED');
  });

  it('manual (Mach3): no M6; the first tool pauses with a message before the spindle start', () => {
    const lines = run({
      config: config('mach3'),
      profile: profileFor('mach3'),
    }).files[0]!.content.split('\r\n');
    expect(lines).not.toContain('T2 M6');
    const k = lines.indexOf('M0');
    expect(lines.slice(k - 1, k + 4)).toEqual([
      '(TAKIM T2 D8.000 TAKILI MI? DEVAM ICIN CYCLE START)',
      'M0',
      'G0 Z20.0000',
      'M3 S18000',
      'G4 P5.0',
    ]);
    expect(lines.indexOf('M3 S18000')).toBeGreaterThan(k);
  });

  it('manual without pauseForFirstTool: the first tool is a comment only', () => {
    const cfg = config('mach3');
    cfg.toolChange.pauseForFirstTool = false;
    const c = run({ config: cfg, profile: profileFor('mach3') }).files[0]!.content;
    expect(c).not.toMatch(/\r\nM0\r\n/);
    expect(c).toContain('(TAKIM: T2 D8.000)');
  });

  it('manual with a second tool: spindle off, message, M0, safe Z, spindle on + dwell', () => {
    const p = profileFor('mach3');
    p.tools.push({ number: 3, type: 'flatEndMill', diameter: 6, fluteLength: 25, flutes: 2 });
    const tp = sampleToolpath(p);
    tp.operations[1]!.tool = 3;
    tp.operations[1]!.toolDiameter = 6;
    const lines = run({
      toolpath: tp,
      profile: p,
      config: config('mach3'),
    }).files[0]!.content.split('\r\n');
    const k = lines.findIndex((l, i) => l === 'M0' && lines[i - 1]!.includes('T3'));
    expect(lines.slice(k - 2, k + 4)).toEqual([
      'M5',
      '(TAKIM DEGISTIR: T3 D6.000 - Z SIFIRLA - SONRA CYCLE START)',
      'M0',
      'G0 Z20.0000',
      'M3 S18000',
      'G4 P5.0',
    ]);
  });

  it('manual with tool length offset keeps the plain change message (T274)', () => {
    const p = profileFor('mach3');
    p.toolChanger.lengthCompensation = true;
    p.tools.push({ number: 3, type: 'flatEndMill', diameter: 6, fluteLength: 25, flutes: 2 });
    const tp = sampleToolpath(p);
    tp.operations[1]!.tool = 3;
    tp.operations[1]!.toolDiameter = 6;
    const cfg = config('mach3');
    cfg.toolChange.lengthOffset = true;
    const c = run({ toolpath: tp, profile: p, config: cfg }).files[0]!.content;
    expect(c).toContain('(TAKIM DEGISTIR: T3 D6.000, sonra cycle start)');
    expect(c).not.toContain('Z SIFIRLA');
  });

  it('none: one file per tool run', () => {
    const p = profileFor();
    p.toolChanger.type = 'none';
    p.tools.push({ number: 3, type: 'flatEndMill', diameter: 6, fluteLength: 25, flutes: 2 });
    const tp = sampleToolpath(p);
    tp.operations[2]!.tool = 3;
    tp.operations[2]!.toolDiameter = 6;
    const cfg = config('generic');
    cfg.toolChange.mode = 'none';
    const r = run({ toolpath: tp, profile: p, config: cfg });
    expect(r.errors).toEqual([]);
    expect(r.files.map((f) => f.name)).toEqual(['deneme_S1_T2.nc', 'deneme_S1_T3.nc']);
    for (const f of r.files) expect(f.content).not.toContain('M6');
  });
});

describe('files', () => {
  it('names: stem + sheet suffix + extension, within the profile limit', () => {
    expect(run().files[0]!.name).toBe('deneme_S1.nc');
    const p = profileFor();
    p.constraints.maxFileNameLength = 9;
    expect(run({ profile: p }).files[0]!.name).toBe('den_S1.nc');
    const m = run({ config: config('mach3'), profile: profileFor('mach3') });
    expect(m.files[0]!.name).toBe('deneme_S1.tap');
  });

  it('refuses when no name fits', () => {
    const p = profileFor();
    p.constraints.maxFileNameLength = 8;
    p.toolChanger.type = 'none';
    const cfg = config('generic');
    cfg.toolChange.mode = 'none';
    expect(run({ profile: p, config: cfg }).errors[0]!.code).toBe('FILE_NAME_TOO_LONG');
  });

  it('one file per sheet', () => {
    const p = profileFor();
    const project = projectOf({
      parts: [{ id: 'a', w: 300, h: 200, qty: 2 }],
      placements: [
        [{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }],
        [{ partId: 'a', index: 1, x: 100, y: 100, rot: 0 }],
      ],
    });
    const r = run({ toolpath: buildToolpath(project, p).toolpath, profile: p });
    expect(r.files.map((f) => f.name)).toEqual(['deneme_S1.nc', 'deneme_S2.nc']);
    expect(r.files[1]!.content).toContain('(PLAKA 2/2)');
  });

  it('oversize: split at operation boundaries into complete programs, or refuse', () => {
    const whole = run().files[0]!.content.length;
    const cfg = config('generic');
    cfg.file.maxSizeBytes = Math.floor(whole / 2);
    const r = run({ config: cfg });
    expect(r.errors).toEqual([]);
    expect(r.files.length).toBeGreaterThan(1);
    expect(r.warnings.map((w) => w.code)).toContain('FILE_SPLIT');
    r.files.forEach((f, i) => {
      expect(f.name).toBe(`deneme_S1_P${i + 1}.nc`);
      expect(f.content.length).toBeLessThanOrEqual(cfg.file.maxSizeBytes);
      expect(f.content).toContain(`BOLUM ${i + 1}/${r.files.length}`);
      const lines = readBlocks(f.content).map((b) => b.line);
      expect(lines[0]).toBe('G21 G90 G17 G54');
      expect(lines.slice(-4)).toEqual(['G0 Z20.000', 'M5', 'M9', 'M30']);
      expect(lines).toContain('M3 S18000');
    });
    cfg.file.onOversize = 'error';
    expect(run({ config: cfg }).errors[0]!.code).toBe('FILE_TOO_LARGE');
    cfg.file.onOversize = 'split';
    cfg.file.maxSizeBytes = 1024;
    expect(run({ config: cfg }).errors[0]!.code).toBe('FILE_TOO_LARGE');
  });
});

describe('input checks', () => {
  it('post id or version different from the profile is refused', () => {
    expect(run({ config: config('mach3') }).errors[0]!.code).toBe('POST_MISMATCH');
    const p = profileFor();
    p.post.version = '1.1';
    expect(run({ profile: p }).errors[0]!.code).toBe('POST_MISMATCH');
    p.post.version = '1.0';
    expect(run({ profile: p, toolpath: sampleToolpath() }).ok).toBe(true);
    expect(normalizePostVersion('1.0')).toBe('1.0.0');
  });

  it('thickness that does not match the toolpath depth is refused', () => {
    expect(run({ meta: metaFor(19) }).errors[0]!.code).toBe('STOCK_MISMATCH');
  });

  it('invalid config, profile, meta and toolpath are refused', () => {
    expect(run({ config: { id: 'x' } }).errors[0]!.code).toBe('INVALID_POST_CONFIG');
    const p = profileFor();
    expect(run({ profile: { ...p, safeZ: -1 }, toolpath: sampleToolpath() }).errors[0]!.code).toBe(
      'INVALID_PROFILE',
    );
    expect(run({ meta: { ...metaFor(), revision: -1 } }).errors[0]!.code).toBe('INVALID_META');
    const tp = sampleToolpath();
    expect(run({ toolpath: { ...tp, operations: [] } }).errors[0]!.code).toBe('NO_OPERATIONS');
    const t2 = sampleToolpath();
    t2.operations[0]!.tool = 9;
    expect(run({ toolpath: t2 }).errors[0]!.code).toBe('TOOL_NOT_IN_PROFILE');
  });
});

describe('shipped posts', () => {
  it('both configs parse and match KNOWN_POSTS', () => {
    const parsed = [genericPost, mach3Post].map((j) => parsePostConfig(j));
    for (const r of parsed) expect(r.ok, JSON.stringify(r)).toBe(true);
    const list = parsed.map((r) =>
      r.ok ? { id: r.config.id, version: r.config.version, name: r.config.name } : null,
    );
    expect(list).toEqual(KNOWN_POSTS.map((k) => ({ ...k })));
  });

  it('both are marked unverified until field test 1', () => {
    for (const j of [genericPost, mach3Post]) expect(j.status).toBe('unverified');
  });

  it('generic: G21 G90 G17 G54, T M6, M3 S + G4 P seconds, IJ incremental, 3/0 decimals, .nc CRLF', () => {
    const c = config('generic');
    expect(c.modal.words).toEqual(['G21', 'G90', 'G17', 'G54']);
    expect(c.toolChange.mode).toBe('auto');
    expect(c.dwell).toEqual({ word: 'P', unit: 's', decimals: 1 });
    expect(c.arcs.mode).toBe('ijIncremental');
    expect(c.decimals).toEqual({ xy: 3, z: 3, arc: 3, feed: 0 });
    expect([c.file.extension, c.file.lineEnding, c.comments.style]).toEqual([
      'nc',
      'crlf',
      'paren',
    ]);
    expect(c.lineNumbers.enabled).toBe(false);
  });

  it('mach3: G91.1 explicit, M5/M30 at the end, .tap CRLF, dwell in seconds', () => {
    const c = config('mach3');
    expect(c.modal.words).toContain('G91.1');
    expect(c.arcs.distanceModeWord).toBe('G91.1');
    expect(c.program.end).toEqual(['M30']);
    expect(c.spindle.off).toBe('M5');
    expect(c.dwell.unit).toBe('s');
    expect([c.file.extension, c.file.lineEnding]).toEqual(['tap', 'crlf']);
  });
});

describe('machine profile rapid feed (deferred from T014)', () => {
  it('the toolpath time estimate uses the profile rapidFeed', () => {
    const project = projectOf({
      parts: [{ id: 'a', w: 300, h: 200, qty: 2 }],
      placements: [
        [
          { partId: 'a', index: 0, x: 100, y: 100, rot: 0 },
          { partId: 'a', index: 1, x: 1000, y: 600, rot: 0 },
        ],
      ],
    });
    const slow = profileFor();
    slow.rapidFeed = 2000;
    // B62 fix r1: the ceiling is the rapid rate strictly; this machine declares its own maximum.
    slow.maxFeed = 10000;
    slow.maxPlungeFeed = 5000;
    const fast = profileFor();
    fast.rapidFeed = 20000;
    const a = buildToolpath(project, slow).summary;
    const b = buildToolpath(project, fast).summary;
    expect(a.rapidLength).toBeCloseTo(b.rapidLength, 9);
    expect(a.estimatedSeconds - b.estimatedSeconds).toBeCloseTo(
      (a.rapidLength / 2000 - a.rapidLength / 20000) * 60,
      6,
    );
    const none = profileFor();
    delete none.rapidFeed;
    expect(buildToolpath(project, none).summary.estimatedSeconds).toBeCloseTo(
      buildToolpath(project, { ...fast, rapidFeed: 10000 }).summary.estimatedSeconds,
      9,
    );
  });
});
