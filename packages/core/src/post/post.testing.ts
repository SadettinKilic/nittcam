/**
 * Post processor test helpers (T017): sample inputs and a tiny G-code reader written
 * independently of the generator (it only splits words). Not exported from the package.
 */
import genericPost from '../../../machines/generic/v1/post.json';
import mach3Post from '../../../machines/mach3/v1/post.json';
import { defaultMachineProfile, type MachineProfile, type VerificationState } from '../machine';
import { buildToolpath, type Operation, type Toolpath } from '../toolpath';
import { projectOf } from '../toolpath/toolpath.testing';
import { parsePostConfig, type PostConfig } from './config';
import { generateGcode } from './generate';
import type { GenerateOptions, PostMeta, PostResult } from './types';

export function config(id: 'generic' | 'mach3'): PostConfig {
  const r = parsePostConfig(id === 'generic' ? genericPost : mach3Post);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return structuredClone(r.config);
}

/** Example profile bound to `generic 1.0.0` with an auto changer (T2 8 mm, MDF 18). */
export function profileFor(id: 'generic' | 'mach3' = 'generic'): MachineProfile {
  const p = defaultMachineProfile();
  p.post = { id, version: '1.0.0' };
  p.toolChanger =
    id === 'generic'
      ? { type: 'auto', capacity: 8, lengthCompensation: false }
      : { type: 'manual', capacity: 1, lengthCompensation: false };
  return p;
}

export const SHEET = { width: 2440, height: 1220 };

export function metaFor(thickness = 18): PostMeta {
  return {
    projectName: 'Deneme işi',
    revision: 2,
    fileStem: 'deneme',
    stock: { material: 'mdf', thickness, sheetWidth: SHEET.width, sheetHeight: SHEET.height },
  };
}

/** Three placed parts (a rounded one for arcs), built by the real toolpath builder. */
export function sampleToolpath(profile: MachineProfile = profileFor()): Toolpath {
  const project = projectOf({
    parts: [
      { id: 'a', w: 300, h: 200, r: 10 },
      { id: 'b', w: 400, h: 250 },
      { id: 'c', w: 500, h: 300, r: 5 },
    ],
    sheet: SHEET,
    placements: [
      [
        { partId: 'a', index: 0, x: 100, y: 100, rot: 0 },
        { partId: 'b', index: 0, x: 500, y: 100, rot: 0 },
        { partId: 'c', index: 0, x: 1000, y: 100, rot: 0 },
      ],
    ],
  });
  const r = buildToolpath(project, profile);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.toolpath;
}

export function run(
  o: {
    toolpath?: Toolpath;
    profile?: MachineProfile;
    config?: unknown;
    meta?: PostMeta;
    verification?: VerificationState;
    options?: GenerateOptions;
  } = {},
): PostResult {
  const profile = o.profile ?? profileFor();
  return generateGcode(
    o.toolpath ?? sampleToolpath(profile),
    { profile, version: 1, verification: o.verification ?? 'draft' },
    o.config ?? config('generic'),
    o.meta ?? metaFor(),
    o.options ?? {},
  );
}

/** Mutable copy of the first operation's moves (for crafting bad toolpaths). */
export function firstOp(tp: Toolpath): Operation {
  const op = tp.operations[0];
  if (!op) throw new Error('no operation');
  return op;
}

// ---------- independent reader ----------

export interface Block {
  line: string;
  words: Map<string, string>;
  codes: string[];
}

/** Program blocks (comments, `%` and N words removed). */
export function readBlocks(content: string): Block[] {
  return content
    .split(/\r?\n/)
    .filter((l) => l !== '' && !l.startsWith('(') && !l.startsWith(';') && l !== '%')
    .map((l) => {
      const line = l.replace(/^N\d+ /, '');
      const words = new Map<string, string>();
      const codes: string[] = [];
      for (const w of line.split(' ')) {
        const k = w[0] ?? '';
        if (k === 'G' || k === 'M') codes.push(w);
        else words.set(k, w.slice(1));
      }
      return { line, words, codes };
    });
}

export interface ReadMove {
  kind: 'rapid' | 'linear' | 'cw' | 'ccw';
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  i?: number;
  j?: number;
  feed: number | null;
  /** F written on this block. */
  feedWritten: boolean;
  index: number;
}

/** Walks the blocks with modal X/Y/Z/F/motion (NaN = unknown). */
export function readMoves(content: string): ReadMove[] {
  let x = NaN;
  let y = NaN;
  let z = NaN;
  let f: number | null = null;
  let motion: ReadMove['kind'] | null = null;
  const out: ReadMove[] = [];
  readBlocks(content).forEach((b, index) => {
    for (const c of b.codes) {
      if (c === 'G0' || c === 'G00') motion = 'rapid';
      if (c === 'G1' || c === 'G01') motion = 'linear';
      if (c === 'G2' || c === 'G02') motion = 'cw';
      if (c === 'G3' || c === 'G03') motion = 'ccw';
    }
    const hasAxis = b.words.has('X') || b.words.has('Y') || b.words.has('Z');
    const fw = b.words.get('F');
    if (fw !== undefined) f = Number(fw);
    if (!hasAxis || motion === null) return;
    if (b.codes.some((c) => !/^G0?[0-3]$/.test(c))) return;
    const from = { x, y, z };
    x = b.words.has('X') ? Number(b.words.get('X')) : x;
    y = b.words.has('Y') ? Number(b.words.get('Y')) : y;
    z = b.words.has('Z') ? Number(b.words.get('Z')) : z;
    const m: ReadMove = {
      kind: motion,
      from,
      to: { x, y, z },
      feed: f,
      feedWritten: fw !== undefined,
      index,
    };
    if (b.words.has('I')) m.i = Number(b.words.get('I'));
    if (b.words.has('J')) m.j = Number(b.words.get('J'));
    out.push(m);
  });
  return out;
}
