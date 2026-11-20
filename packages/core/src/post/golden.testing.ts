/**
 * Golden-file pipeline (T017, D-025): fixture project → rect-only derivative → nesting →
 * toolpath → G-code, for each shipped post. Shared by the byte-for-byte test and the
 * `golden:update` script. Not exported from the package.
 */
import genericPost from '../../../machines/generic/v1/post.json';
import mach3Post from '../../../machines/mach3/v1/post.json';
import { defaultMachineProfile, type MachineProfile } from '../machine';
import { nestProject } from '../nesting';
import { parseProject, type Project } from '../schema';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { buildToolpath } from '../toolpath';
import { cuttingMeta } from '../export/export';
import { generateGcode } from './generate';
import type { PostProfileVersion, PostResult } from './types';

export const GOLDEN_POSTS = [
  { id: 'generic', dir: 'generic/v1', config: genericPost as unknown },
  { id: 'mach3', dir: 'mach3/v1', config: mach3Post as unknown },
] as const;

export const GOLDEN_FIXTURES = [
  { id: 'cabinet-doors', name: 'Mutfak kapakları', revision: 1, json: cabinetDoors as unknown },
  { id: 'shelf-set', name: 'Raf seti', revision: 1, json: shelfSet as unknown },
  { id: 'mixed', name: 'Karışık (dikdörtgen alt küme)', revision: 1, json: mixed as unknown },
] as const;

/**
 * Hole fixtures (T139–T140): built here with fixed placements (no nesting), so the golden file
 * shows exactly the cases listed. MDF 18 mm, example profile (T1 Ø6, T2 Ø8, set tool T2).
 */
export const GOLDEN_HOLE_FIXTURES = [
  {
    id: 'holes-through',
    name: 'Geçme delikler',
    revision: 1,
    /**
     * Panel 400 × 300, two copies (0° and 90°): Ø8 T2 = drill (pecks), Ø35 T2 = helical entry +
     * cleared through pocket, Ø20 T1 = cleared through pocket with the other tool (tool change).
     */
    holes: [
      { id: 'h1', type: 'through', d: 8, cx: 60, cy: 60, tool: 2 },
      { id: 'h2', type: 'through', d: 35, cx: 200, cy: 150, tool: 2 },
      { id: 'h3', type: 'through', d: 20, cx: 340, cy: 240, tool: 1 },
    ],
  },
  {
    id: 'holes-blind',
    name: 'Kör delik ve kanallar',
    revision: 1,
    /**
     * Same panel and copies (T140): Ø35 × 12.5 hinge cup (helical entry + cleared rings), Ø8 × 10
     * blind drill (pecks), Ø60 groove 8 wide × 3 (one ring = tool width), Ø80 groove 14 wide × 4
     * (rings across the width). All T2.
     */
    holes: [
      { id: 'h1', type: 'pocket', d: 35, depth: 12.5, cx: 100, cy: 150, tool: 2 },
      { id: 'h2', type: 'pocket', d: 8, depth: 10, cx: 60, cy: 60, tool: 2 },
      { id: 'h3', type: 'groove', d: 60, grooveWidth: 8, depth: 3, cx: 230, cy: 150, tool: 2 },
      { id: 'h4', type: 'groove', d: 80, grooveWidth: 14, depth: 4, cx: 330, cy: 200, tool: 2 },
    ],
  },
] as const;

/** The panel project of a hole fixture: two copies, the second turned 90°. */
export function holeFixtureProject(holes: readonly unknown[]): Project {
  const parsed = parseProject({
    schemaVersion: 2,
    machine: { machineId: 'golden', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'panel',
        name: 'Panel',
        qty: 2,
        grain: { mode: 'free', angle: 0 },
        kind: 'rect',
        params: { w: 400, h: 300, r: 0 },
        inners: [],
        holes: structuredClone(holes),
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 10, margin: 12 },
    layout: {
      sheets: [
        {
          placements: [
            { partId: 'panel', index: 0, x: 100, y: 100, rot: 0, locked: false },
            { partId: 'panel', index: 1, x: 700, y: 100, rot: 90, locked: false },
          ],
        },
      ],
    },
    cutting: { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' },
  });
  if (!parsed.ok) throw new Error(`hole fixture invalid: ${JSON.stringify(parsed.issues)}`);
  return parsed.project;
}

// ---------------------------------------------------------------------------
// Operation fixtures (T189): true-shape layout, inner contours, arcs, rotated grain, arc tabs
// (D-058), cutting settings (T288), thin skin (T143). Nested by the engine (deterministic).
// ---------------------------------------------------------------------------

type V = { x: number; y: number; bulge: number };
const v = (x: number, y: number, bulge = 0): V => ({ x, y, bulge });

/** Full circle of diameter `d`, bottom-left of its box at the origin; CCW (outline) or CW (inner). */
function circle(d: number, ox = 0, oy = 0, cw = false): V[] {
  const r = d / 2;
  const b = cw ? -1 : 1;
  return [v(ox, oy + r, b), v(ox + d, oy + r, b)];
}

/** Stadium `len` × `w` (two straight sides, two half-circle ends: sweep 180°), CCW. */
function stadium(len: number, w: number): V[] {
  const r = w / 2;
  return [v(r, 0), v(len - r, 0, 1), v(len - r, w), v(r, w, 1)];
}

/** L-shape `w` × `h` with a `leg`-wide leg on each side, CCW. */
function lShape(w: number, h: number, leg: number): V[] {
  return [v(0, 0), v(w, 0), v(w, leg), v(leg, leg), v(leg, h), v(0, h)];
}

/** Axis rectangle inner contour (CW), bottom-left at (x, y). */
function rectInner(x: number, y: number, w: number, h: number): V[] {
  return [v(x, y), v(x, y + h), v(x + w, y + h), v(x + w, y)];
}

interface OpPart {
  id: string;
  name: string;
  qty: number;
  grain?: { mode: 'free' | 'fixed'; angle: number };
  rect?: { w: number; h: number; r: number };
  outline?: V[];
  inners?: V[][];
  holes?: unknown[];
}

interface OpCutting {
  tabs: { auto: boolean; count?: number; width?: number; height?: number };
  skin?: { thickness: number };
  leadIn: 'arc' | 'line';
  direction: 'climb' | 'conventional';
}

const DEFAULT_CUTTING: OpCutting = { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' };

export const GOLDEN_OP_FIXTURES: readonly {
  id: string;
  name: string;
  revision: number;
  parts: OpPart[];
  cutting: OpCutting;
}[] = [
  {
    id: 'true-shape',
    name: 'Serbest biçim dizilim',
    revision: 1,
    /**
     * True-shape layout (T165–T167: freeform parts switch the job to the true-shape engine): two
     * L-shapes, two Ø250 discs, a frame 600 × 400 r30 (corner arcs) with a window and a Ø100
     * round cut-out (inner contours, inner arcs) whose grain is fixed at 90° on a 0° sheet, so it
     * is placed turned (rotated grain). Default cutting settings.
     */
    parts: [
      { id: 'ell', name: 'L parça', qty: 2, outline: lShape(500, 400, 150) },
      { id: 'disc', name: 'Disk', qty: 2, outline: circle(250) },
      {
        id: 'frame',
        name: 'Çerçeve',
        qty: 1,
        grain: { mode: 'fixed', angle: 90 },
        rect: { w: 600, h: 400, r: 30 },
        inners: [rectInner(80, 100, 300, 200), circle(100, 440, 150, true)],
      },
    ],
    cutting: DEFAULT_CUTTING,
  },
  {
    id: 'arc-tabs',
    name: 'Yay üstünde köprü',
    revision: 1,
    /**
     * Tabs on every part (D-058): a Ø300 disc (no straight edge: tabs centred on its arcs), a
     * 450 × 150 stadium (tabs on the straight sides first), a 500 × 300 r40 rounded rectangle
     * (corner arcs never hold a tab) and a small Ø180 disc (small-part rule, ≥ 2 tabs on arcs).
     */
    parts: [
      { id: 'disc', name: 'Disk', qty: 1, outline: circle(300) },
      { id: 'stadium', name: 'Oval', qty: 1, outline: stadium(450, 150) },
      { id: 'rounded', name: 'Yuvarlak köşe', qty: 1, rect: { w: 500, h: 300, r: 40 } },
      { id: 'small-disc', name: 'Küçük disk', qty: 1, outline: circle(180) },
    ],
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
  },
  {
    id: 'cutting-settings',
    name: 'Kesim ayarları',
    revision: 1,
    /**
     * T288 non-default settings: tabs on every part, 3 per part, 8 × 2 mm; straight lead-in;
     * conventional direction. A 600 × 400 panel with a window, a Ø8 through drill and a Ø35 ×
     * 12.5 pocket (holes and pockets under the same settings), and two 300 × 200 shelves.
     */
    parts: [
      {
        id: 'panel',
        name: 'Panel',
        qty: 1,
        rect: { w: 600, h: 400, r: 0 },
        inners: [rectInner(320, 120, 200, 160)],
        holes: [
          { id: 'h1', type: 'through', d: 8, cx: 60, cy: 60, tool: 2 },
          { id: 'h2', type: 'pocket', d: 35, depth: 12.5, cx: 160, cy: 200, tool: 2 },
        ],
      },
      { id: 'shelf', name: 'Raf', qty: 2, rect: { w: 300, h: 200, r: 0 } },
    ],
    cutting: {
      tabs: { auto: true, count: 3, width: 8, height: 2 },
      leadIn: 'line',
      direction: 'conventional',
    },
  },
  {
    id: 'thin-skin',
    name: 'İnce tabaka',
    revision: 1,
    /**
     * Thin skin (T143): small parts (four 150 × 80 strips and a Ø120 disc) keep a 0.5 mm skin
     * instead of tabs; the cleanup pass removes it after every part; the 600 × 400 panel is cut
     * through without tabs (tabs off).
     */
    parts: [
      { id: 'panel', name: 'Panel', qty: 1, rect: { w: 600, h: 400, r: 0 } },
      { id: 'strip', name: 'Çıta', qty: 4, rect: { w: 150, h: 80, r: 0 } },
      { id: 'disc', name: 'Disk', qty: 1, outline: circle(120) },
    ],
    cutting: { tabs: { auto: false }, skin: { thickness: 0.5 }, leadIn: 'arc', direction: 'climb' },
  },
  {
    id: 'tab-bounds-min',
    name: 'Köprü alt sınır',
    revision: 1,
    /**
     * T293 lower bounds exactly: tabs 3 mm wide, 1 mm of material left (the smallest tab that
     * still holds a part on 18 mm), on a 400 × 300 panel and a small 150 × 90 strip.
     */
    parts: [
      { id: 'panel', name: 'Panel', qty: 1, rect: { w: 400, h: 300, r: 0 } },
      { id: 'strip', name: 'Çıta', qty: 1, rect: { w: 150, h: 90, r: 0 } },
    ],
    cutting: { tabs: { auto: true, width: 3, height: 1 }, leadIn: 'arc', direction: 'climb' },
  },
  {
    id: 'tab-bounds-max',
    name: 'Köprü üst sınır',
    revision: 1,
    /** T293 upper height bound: 17 mm left on 18 mm stock (thickness − 1), width 3 mm. */
    parts: [
      { id: 'panel', name: 'Panel', qty: 1, rect: { w: 400, h: 300, r: 0 } },
      { id: 'strip', name: 'Çıta', qty: 1, rect: { w: 150, h: 90, r: 0 } },
    ],
    cutting: { tabs: { auto: true, width: 3, height: 17 }, leadIn: 'arc', direction: 'climb' },
  },
];

/** The nested project of an operation fixture (MDF 18, 2800 × 2070, sheet grain 0°). */
export function opFixtureProject(
  fx: (typeof GOLDEN_OP_FIXTURES)[number],
  toolDiameter: number,
): Project {
  const parsed = parseProject({
    schemaVersion: 2,
    machine: { machineId: 'golden', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: fx.parts.map((p) => ({
      id: p.id,
      name: p.name,
      qty: p.qty,
      grain: p.grain ?? { mode: 'free', angle: 0 },
      ...(p.rect
        ? { kind: 'rect', params: p.rect }
        : { kind: 'freeform', outline: structuredClone(p.outline) }),
      inners: structuredClone(p.inners ?? []),
      holes: structuredClone(p.holes ?? []),
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    })),
    nesting: { mode: 'minWaste', gap: 10, margin: 12 },
    layout: { sheets: [] },
    cutting: structuredClone(fx.cutting),
  });
  if (!parsed.ok) throw new Error(`op fixture ${fx.id} invalid: ${JSON.stringify(parsed.issues)}`);
  const nested = nestProject(parsed.project, { toolDiameter });
  return { ...parsed.project, layout: nested.layout };
}

/** Every golden fixture id with its project (the existing three keep their rect-only derivative). */
export function goldenFixtureProjects(
  toolDiameter: number,
): { id: string; name: string; revision: number; project: Project }[] {
  return [
    ...GOLDEN_OP_FIXTURES.map((fx) => ({
      id: fx.id,
      name: fx.name,
      revision: fx.revision,
      project: opFixtureProject(fx, toolDiameter),
    })),
    ...GOLDEN_FIXTURES.map((fx) => ({
      id: fx.id,
      name: fx.name,
      revision: fx.revision,
      project: goldenProject(fx.json, toolDiameter),
    })),
    ...GOLDEN_HOLE_FIXTURES.map((fx) => ({
      id: fx.id,
      name: fx.name,
      revision: fx.revision,
      project: holeFixtureProject(fx.holes),
    })),
  ];
}

/**
 * Rect-only derivative of a fixture (M1 cuts no holes or inner contours): rect parts only, holes,
 * inners and templates removed, MDF 18 mm (the example profile's parameter set), re-nested.
 */
export function goldenProject(json: unknown, toolDiameter: number): Project {
  const src = structuredClone(json) as {
    stock: { material: string; thickness: number };
    parts: { kind: string; holes: unknown[]; inners: unknown[]; templates: unknown[] }[];
    layout: { sheets: unknown[] };
  };
  src.stock.material = 'mdf';
  src.stock.thickness = 18;
  src.parts = src.parts
    .filter((p) => p.kind === 'rect')
    .map((p) => ({ ...p, holes: [], inners: [], templates: [] }));
  src.layout = { sheets: [] };
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(`golden fixture invalid: ${JSON.stringify(parsed.issues)}`);
  const nested = nestProject(parsed.project, { toolDiameter });
  return { ...parsed.project, layout: nested.layout };
}

/**
 * Example profile bound to a post: generic = auto tool changer, mach3 = manual changer. The
 * travel is enlarged to 3100 × 2200 so the fixtures' 2800 × 2100 sheets fit (rule 6).
 */
export function goldenProfile(postId: 'generic' | 'mach3'): MachineProfile {
  const p = defaultMachineProfile();
  p.workEnvelope = { x: 3100, y: 2200, z: 150 };
  p.table = { width: 3050, depth: 2150 };
  if (postId === 'generic') {
    p.post = { id: 'generic', version: '1.0.0' };
    p.toolChanger = { type: 'auto', capacity: 8, lengthCompensation: false };
  } else {
    p.identity = {
      ...p.identity,
      name: 'Mach3 router örnek',
      controller: { family: 'Mach3', version: '' },
    };
    p.post = { id: 'mach3', version: '1.0.0' };
    p.toolChanger = { type: 'manual', capacity: 1, lengthCompensation: false };
  }
  return p;
}

export interface GoldenCase {
  postId: 'generic' | 'mach3';
  dir: string;
  fixtureId: string;
  result: PostResult;
}

/** Every post × fixture through the full pipeline. */
export function goldenCases(): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (const post of GOLDEN_POSTS) {
    const profile = goldenProfile(post.id);
    const set = profile.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
    const tool = profile.tools.find((t) => t.number === set?.tool);
    if (!tool) throw new Error('golden profile has no MDF 18 tool');
    for (const fx of goldenFixtureProjects(tool.diameter)) {
      const project = fx.project;
      const tp = buildToolpath(project, profile);
      if (!tp.ok) throw new Error(`golden toolpath failed: ${JSON.stringify(tp.errors)}`);
      const version: PostProfileVersion = { profile, version: 1, verification: 'draft' };
      const result = generateGcode(tp.toolpath, version, post.config, {
        projectName: fx.name,
        revision: fx.revision,
        fileStem: fx.id,
        // T288: the same KESİM header line as exportNc (every file, D-091).
        ...cuttingMeta(project, profile),
        stock: {
          material: project.stock.material,
          thickness: project.stock.thickness,
          sheetWidth: project.stock.sheet.width,
          sheetHeight: project.stock.sheet.height,
        },
      });
      out.push({ postId: post.id, dir: post.dir, fixtureId: fx.id, result });
    }
  }
  return out;
}
