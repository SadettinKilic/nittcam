/**
 * Random end-to-end scenarios for the checks (T019): profile (4 corners, axis signs, 2 Z
 * references, offsets), random rectangular parts nested by the real engine, toolpath options,
 * both posts, optional second tool, split files and the "none" tool-change mode. Not exported.
 */
import fc from 'fast-check';
import { defaultMachineProfile, type MachineProfile } from '../machine';
import { nestProject } from '../nesting';
import { generateGcode, type PostFile, type PostResult } from '../post';
import type { Project } from '../schema';
import { buildToolpath, type Toolpath, type ToolpathOptions } from '../toolpath';
import { projectOf } from '../toolpath/toolpath.testing';
import { postConfig, type PostId } from './check.testing';
import { expectedLayouts } from './layout';
import type { GcodeCheckFilesContext } from './types';

export const CORNERS = ['frontLeft', 'frontRight', 'backLeft', 'backRight'] as const;
const NATURAL = {
  frontLeft: { x: 'right', y: 'back' },
  frontRight: { x: 'left', y: 'back' },
  backLeft: { x: 'right', y: 'front' },
  backRight: { x: 'left', y: 'front' },
} as const;

export interface Scenario {
  post: PostId;
  corner: (typeof CORNERS)[number];
  away: boolean;
  zRef: 'table' | 'materialTop';
  offset: { x: number; y: number };
  warmup: number;
  safeZ: number;
  clearance: number;
  spoil: number;
  thickness: number;
  toolDia: number;
  feed: number;
  plunge: number;
  stepDown: number;
  lead: 'arc' | 'line' | 'none';
  plunge2: NonNullable<ToolpathOptions['plunge']>;
  direction: 'climb' | 'conventional';
  tabs: boolean;
  twoTools: boolean;
  files: 'normal' | 'split' | 'none';
  arcs: boolean;
  sheet: { width: number; height: number };
  parts: { id: string; w: number; h: number; r: number; qty: number }[];
}

const partArb = (i: number) =>
  fc
    .record({
      w: fc.double({ min: 60, max: 700, noNaN: true }),
      h: fc.double({ min: 60, max: 450, noNaN: true }),
      rFrac: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.5, noNaN: true })),
      qty: fc.integer({ min: 1, max: 2 }),
    })
    .map(({ w, h, rFrac, qty }) => ({ id: `p${i}`, w, h, r: (rFrac * Math.min(w, h)) / 2, qty }));

export const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  post: fc.constantFrom<PostId>('generic', 'mach3'),
  corner: fc.constantFrom(...CORNERS),
  away: fc.oneof(fc.constant(false), fc.constant(false), fc.boolean()),
  zRef: fc.constantFrom('table' as const, 'materialTop' as const),
  offset: fc.record({
    x: fc.double({ min: 0, max: 200, noNaN: true }),
    y: fc.double({ min: 0, max: 200, noNaN: true }),
  }),
  warmup: fc.oneof(fc.constant(0), fc.constant(5), fc.double({ min: 0.05, max: 30, noNaN: true })),
  safeZ: fc.double({ min: 8, max: 60, noNaN: true }),
  clearance: fc.double({ min: 1, max: 6, noNaN: true }),
  spoil: fc.double({ min: 0, max: 2, noNaN: true }),
  thickness: fc.double({ min: 3, max: 30, noNaN: true }),
  toolDia: fc.constantFrom(3, 6, 8, 12),
  feed: fc.double({ min: 1000, max: 15000, noNaN: true }),
  plunge: fc.double({ min: 200, max: 1000, noNaN: true }),
  stepDown: fc.double({ min: 1.5, max: 20, noNaN: true }),
  lead: fc.constantFrom('arc' as const, 'line' as const, 'none' as const),
  plunge2: fc.oneof(
    fc.constant({ type: 'straight' as const }),
    fc
      .double({ min: 2, max: 25, noNaN: true })
      .map((angleDeg) => ({ type: 'ramp' as const, angleDeg })),
  ),
  direction: fc.constantFrom('climb' as const, 'conventional' as const),
  tabs: fc.boolean(),
  twoTools: fc.boolean(),
  files: fc.constantFrom('normal' as const, 'normal' as const, 'split' as const, 'none' as const),
  arcs: fc.oneof(fc.constant(true), fc.constant(true), fc.constant(false)),
  sheet: fc.record({
    width: fc.double({ min: 800, max: 2440, noNaN: true }),
    height: fc.double({ min: 500, max: 1220, noNaN: true }),
  }),
  parts: fc
    .integer({ min: 1, max: 4 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i)))),
});

export function profileOf(s: Scenario): MachineProfile {
  const p = defaultMachineProfile();
  p.workEnvelope = { x: 3100, y: 2200, z: 150 };
  p.table = { width: 3050, depth: 2150 };
  const nat = NATURAL[s.corner];
  p.origin = {
    corner: s.corner,
    xPositive: s.away ? (nat.x === 'right' ? 'left' : 'right') : nat.x,
    yPositive: s.away ? (nat.y === 'back' ? 'front' : 'back') : nat.y,
    sheetOffset: s.offset,
  };
  p.zZero = { reference: s.zRef, spoilboardAllowance: s.spoil };
  p.safeZ = s.safeZ;
  p.spindle = { ...p.spindle, warmupSeconds: s.warmup };
  p.post = { id: s.post, version: '1.0.0' };
  p.toolChanger =
    s.post === 'generic' && s.files !== 'none'
      ? { type: 'auto', capacity: 8, lengthCompensation: false }
      : { type: 'manual', capacity: 1, lengthCompensation: false };
  p.constraints = { ...p.constraints, arcs: s.arcs };
  p.tools = [
    { number: 3, type: 'flatEndMill', diameter: s.toolDia, fluteLength: 40, flutes: 2 },
    { number: 5, type: 'flatEndMill', diameter: s.toolDia, fluteLength: 40, flutes: 2 },
  ];
  p.materials = [
    {
      material: 'mdf',
      thickness: s.thickness,
      feed: s.feed,
      plungeFeed: s.plunge,
      rpm: 18000,
      stepDown: s.stepDown,
      tool: 3,
    },
  ];
  return p;
}

export interface Built {
  profile: MachineProfile;
  project: Project;
  toolpath: Toolpath;
  post: ReturnType<typeof postConfig>;
  result: PostResult;
  context: GcodeCheckFilesContext;
}

/** The scenario through nesting, toolpath and post; null when it does not produce a program. */
export function buildScenario(s: Scenario): Built | null {
  const profile = profileOf(s);
  const unplaced = projectOf({
    parts: s.parts,
    sheet: s.sheet,
    thickness: s.thickness,
    gap: 4,
    // T331 (D-123): the cutter stays on the sheet only with a margin of at least the tool Ø.
    margin: Math.max(10, s.toolDia),
    leadIn: s.lead === 'line' ? 'line' : 'arc',
    direction: s.direction,
  });
  const nested = nestProject(unplaced, { toolDiameter: s.toolDia });
  if (nested.layout.sheets.length === 0) return null;
  const project: Project = {
    ...unplaced,
    layout: nested.layout,
    cutting: { ...unplaced.cutting, tabs: { ...unplaced.cutting.tabs, auto: s.tabs } },
  };
  const tp = buildToolpath(project, profile, {
    lead: s.lead,
    plunge: s.plunge2,
    direction: s.direction,
    clearance: s.clearance,
  });
  if (!tp.ok) return null;
  const toolpath = structuredClone(tp.toolpath);
  // A second tool (same diameter, so the geometry stays valid) on every other operation.
  if (s.twoTools) toolpath.operations.forEach((op, i) => (op.tool = i % 2 === 1 ? 5 : 3));
  const post = postConfig(s.post);
  if (s.files === 'split') post.file.maxSizeBytes = 4_000;
  if (s.files === 'none') post.toolChange = { ...post.toolChange, mode: 'none' };
  const result = generateGcode(toolpath, { profile, version: 1, verification: 'draft' }, post, {
    projectName: 'Kontrol denemesi',
    revision: 1,
    fileStem: 'kontrol',
    stock: {
      material: 'mdf',
      thickness: s.thickness,
      sheetWidth: s.sheet.width,
      sheetHeight: s.sheet.height,
    },
  });
  const context: GcodeCheckFilesContext = {
    profile,
    verification: 'draft',
    post,
    toolpath,
    stock: { thickness: s.thickness, sheetWidth: s.sheet.width, sheetHeight: s.sheet.height },
    layout: expectedLayouts(project),
  };
  return { profile, project, toolpath, post, result, context };
}

export function fileList(files: readonly PostFile[]) {
  return files.map((f) => ({ name: f.name, content: f.content, sheet: f.sheet }));
}
